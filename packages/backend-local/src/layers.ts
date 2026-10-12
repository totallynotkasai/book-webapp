/**
 * `Backend.layers` in the browser (P1-LAY-01, P1-LAY-04, DESIGN.md §8). Lists a Book's Layers
 * (Illustration Packs, then narration Audio Tracks) with whether the signed-in user holds an
 * Entitlement (checked through `@book/domain`, Invariant 15), and opens one: a pack's
 * Illustrations from its built `pack.json`, or a track's Chapters from its `track.json`, with a
 * content token for the Layer's files, read like Book files with `content.read` (Invariant 16).
 */
import {
	audioTrackFileSchema,
	BackendError,
	illustrationPackFileSchema,
	type AudioTrackFile,
	type AudioTrackSummaryDto,
	type Clock,
	type IllustrationPackFile,
	type IllustrationPackSummaryDto,
	type LayersApi,
	type OpenPackDto,
	type OpenTrackDto,
	type SyncMapStatus,
	type UserDto
} from '@book/core';
import { hasEntitlement } from '@book/domain';
import type { z } from 'zod';
import type { ContentModule } from './content';
import type { BackendDatabase } from './db';
import type { AudioTrackRecord, IllustrationPackRecord } from './seed';

/** Below this coverage a Sync Map needs a creator's review (§7.2 step 6). */
const REVIEW_BELOW = 0.9;

export function createLayersApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requireUser: () => UserDto;
	loadFile: (url: string) => Promise<Uint8Array>;
	content: ContentModule;
}): LayersApi {
	const { db, clock } = deps;
	/** Parsed Layer files: static, so loaded once per session. */
	const files = new Map<string, Promise<unknown>>();

	function layerFile<T>(url: string, schema: z.ZodType<T>): Promise<T> {
		let file = files.get(url) as Promise<T> | undefined;
		if (!file) {
			file = (async () => {
				const bytes = await deps.loadFile(url);
				return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
			})();
			file.catch(() => files.delete(url));
			files.set(url, file);
		}
		return file;
	}

	/** The Layer's Product, and whether the user holds it. */
	async function ownership(
		kind: 'illustration_pack' | 'audio_track',
		refId: string,
		userId: string
	) {
		const product = (await db.getAll('products')).find((p) => p.kind === kind && p.refId === refId);
		const entitlements = await db.getAllFromIndex('entitlements', 'userId', userId);
		return {
			productId: product?.id ?? '',
			price: product?.price ?? { amountMinor: 0, currency: 'GBP' },
			entitled: !!product && hasEntitlement(entitlements, userId, product.id, clock.now())
		};
	}

	async function summarisePack(
		pack: IllustrationPackRecord,
		userId: string
	): Promise<IllustrationPackSummaryDto> {
		const creator = await db.get('creators', pack.creatorId);
		return {
			id: pack.id,
			kind: 'illustration_pack',
			bookId: pack.bookId,
			name: pack.name,
			description: pack.description,
			creatorId: pack.creatorId,
			creatorName: creator?.displayName ?? '',
			isOfficial: pack.isOfficial,
			aiUse: pack.aiUse,
			credit: pack.credit,
			illustrationCount: pack.illustrationCount,
			...(await ownership('illustration_pack', pack.id, userId))
		};
	}

	async function summariseTrack(
		track: AudioTrackRecord,
		userId: string
	): Promise<AudioTrackSummaryDto> {
		const creator = await db.get('creators', track.creatorId);
		return {
			id: track.id,
			kind: 'audio_track',
			bookId: track.bookId,
			name: track.name,
			description: track.description,
			narrator: track.narrator,
			creatorId: track.creatorId,
			creatorName: creator?.displayName ?? '',
			isOfficial: track.isOfficial,
			aiUse: track.aiUse,
			credit: track.credit,
			chapterCount: track.chapterCount,
			durationMs: track.durationMs,
			...(await ownership('audio_track', track.id, userId))
		};
	}

	/** Official first, then by name: a stable order for the Layers menu. */
	function byListing<T extends { isOfficial: boolean; name: string }>(a: T, b: T): number {
		return Number(b.isOfficial) - Number(a.isOfficial) || a.name.localeCompare(b.name);
	}

	function requireEntitled(
		summary: { entitled: boolean },
		message: string,
		details: Record<string, string>
	) {
		if (!summary.entitled) throw new BackendError('ENTITLEMENT_REQUIRED', message, details);
	}

	const directoryOf = (url: string) => url.replace(/\/[^/]*$/, '');

	return {
		async list(bookId) {
			const user = deps.requireUser();
			const listed = <T extends { listingState: string }>(records: T[]) =>
				records.filter((r) => r.listingState === 'listed');
			const packs = listed(await db.getAllFromIndex('illustrationPacks', 'bookId', bookId));
			const tracks = listed(await db.getAllFromIndex('audioTracks', 'bookId', bookId));
			return [
				...(await Promise.all(packs.sort(byListing).map((p) => summarisePack(p, user.id)))),
				...(await Promise.all(tracks.sort(byListing).map((t) => summariseTrack(t, user.id))))
			];
		},

		async openPack(packId): Promise<OpenPackDto> {
			const user = deps.requireUser();
			const pack = await db.get('illustrationPacks', packId);
			if (!pack) throw new BackendError('NOT_FOUND', 'That illustration pack isn’t available.');
			const summary = await summarisePack(pack, user.id);
			requireEntitled(summary, 'You don’t have this illustration pack yet.', {
				packId,
				bookId: pack.bookId
			});
			const file: IllustrationPackFile = await layerFile(pack.packUrl, illustrationPackFileSchema);
			const { token, expiresAt } = deps.content.grantLayer(packId, directoryOf(pack.packUrl));
			return {
				pack: summary,
				revisionId: file.revisionId,
				illustrations: file.illustrations,
				contentToken: token,
				expiresAt: new Date(expiresAt).toISOString()
			};
		},

		async openTrack(trackId): Promise<OpenTrackDto> {
			const user = deps.requireUser();
			const track = await db.get('audioTracks', trackId);
			if (!track) throw new BackendError('NOT_FOUND', 'That narration isn’t available.');
			const summary = await summariseTrack(track, user.id);
			requireEntitled(summary, 'You don’t have the narration for this book yet.', {
				trackId,
				bookId: track.bookId
			});
			const file: AudioTrackFile = await layerFile(track.trackUrl, audioTrackFileSchema);
			// Aligned to an older Revision than the one readers open: needs re-aligning (P1-STU-03).
			const current = await db.getAllFromIndex('revisions', 'bookId', track.bookId);
			const stale = current.length > 0 && !current.some((r) => r.id === file.revisionId);
			const { token, expiresAt } = deps.content.grantLayer(trackId, directoryOf(track.trackUrl));
			return {
				track: summary,
				revisionId: file.revisionId,
				chapters: file.chapters.map((chapter) => {
					const status: SyncMapStatus = stale
						? 'stale'
						: chapter.coverage < REVIEW_BELOW
							? 'needs_review'
							: 'ready';
					return {
						chapterId: chapter.chapterId,
						syncMap: chapter.syncMap,
						// SIMULATION: a static file, readable by anyone who knows the path. Phase 2 serves
						// a signed URL that expires with the content token (§10.3, Invariant 16).
						audioUrl: chapter.audio,
						durationMs: chapter.durationMs,
						coverage: chapter.coverage,
						status
					};
				}),
				contentToken: token,
				expiresAt: new Date(expiresAt).toISOString()
			};
		}
	};
}
