/**
 * `Backend.layers` in the browser (P1-LAY-01, DESIGN.md §8). Lists a Book's Illustration Packs
 * with whether the signed-in user holds an Entitlement (checked through `@book/domain`,
 * Invariant 15), and opens one: its Illustrations, from the pack's built `pack.json`, and a
 * content token for its images, read like Book files with `content.read` (Invariant 16).
 */
import {
	BackendError,
	illustrationPackFileSchema,
	type Clock,
	type IllustrationPackFile,
	type LayerSummaryDto,
	type LayersApi,
	type OpenPackDto,
	type UserDto
} from '@book/core';
import { hasEntitlement } from '@book/domain';
import type { ContentModule } from './content';
import type { BackendDatabase } from './db';
import type { IllustrationPackRecord } from './seed';

export function createLayersApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requireUser: () => UserDto;
	loadFile: (url: string) => Promise<Uint8Array>;
	content: ContentModule;
}): LayersApi {
	const { db, clock } = deps;
	/** Parsed pack files: static, so loaded once per session. */
	const files = new Map<string, Promise<IllustrationPackFile>>();

	function packFile(pack: IllustrationPackRecord): Promise<IllustrationPackFile> {
		let file = files.get(pack.id);
		if (!file) {
			file = (async () => {
				const bytes = await deps.loadFile(pack.packUrl);
				return illustrationPackFileSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
			})();
			file.catch(() => files.delete(pack.id));
			files.set(pack.id, file);
		}
		return file;
	}

	async function summarise(pack: IllustrationPackRecord, userId: string): Promise<LayerSummaryDto> {
		const product = (await db.getAll('products')).find(
			(p) => p.kind === 'illustration_pack' && p.refId === pack.id
		);
		const creator = await db.get('creators', pack.creatorId);
		const entitlements = await db.getAllFromIndex('entitlements', 'userId', userId);
		return {
			id: pack.id,
			kind: 'illustration_pack',
			bookId: pack.bookId,
			productId: product?.id ?? '',
			name: pack.name,
			description: pack.description,
			creatorId: pack.creatorId,
			creatorName: creator?.displayName ?? '',
			isOfficial: pack.isOfficial,
			aiUse: pack.aiUse,
			credit: pack.credit,
			illustrationCount: pack.illustrationCount,
			price: product?.price ?? { amountMinor: 0, currency: 'GBP' },
			entitled: !!product && hasEntitlement(entitlements, userId, product.id, clock.now())
		};
	}

	return {
		async list(bookId) {
			const user = deps.requireUser();
			const packs = (await db.getAllFromIndex('illustrationPacks', 'bookId', bookId)).filter(
				(p) => p.listingState === 'listed'
			);
			// Official first, then by name: a stable order for the Layers menu.
			packs.sort(
				(a, b) => Number(b.isOfficial) - Number(a.isOfficial) || a.name.localeCompare(b.name)
			);
			return Promise.all(packs.map((pack) => summarise(pack, user.id)));
		},

		async openPack(packId): Promise<OpenPackDto> {
			const user = deps.requireUser();
			const pack = await db.get('illustrationPacks', packId);
			if (!pack) throw new BackendError('NOT_FOUND', 'That illustration pack isn’t available.');
			const summary = await summarise(pack, user.id);
			if (!summary.entitled) {
				throw new BackendError(
					'ENTITLEMENT_REQUIRED',
					'You don’t have this illustration pack yet.',
					{ packId, bookId: pack.bookId }
				);
			}
			const file = await packFile(pack);
			const baseUrl = pack.packUrl.replace(/\/[^/]*$/, '');
			const { token, expiresAt } = deps.content.grantPack(packId, baseUrl);
			return {
				pack: summary,
				revisionId: file.revisionId,
				illustrations: file.illustrations,
				contentToken: token,
				expiresAt: new Date(expiresAt).toISOString()
			};
		}
	};
}
