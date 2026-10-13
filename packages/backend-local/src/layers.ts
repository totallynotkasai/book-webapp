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
	type IllustrationPreviewDto,
	type LayerSummaryDto,
	type LayersApi,
	type OpenPackDto,
	type OpenTrackDto,
	type UserDto
} from '@book/core';
import { hasEntitlement, hubOrder, ratingSummary, syncMapStatus } from '@book/domain';
import type { z } from 'zod';
import type { ContentModule } from './content';
import type { BackendDatabase } from './db';
import { parseStudioUrl, type StoredFiles } from './files';
import type { AudioTrackRecord, IllustrationPackRecord } from './seed';

export interface LayersModule extends LayersApi {
	/** One pack or narration as the signed-in user sees it, whatever its state; null if unknown. */
	summarise(layerId: string): Promise<LayerSummaryDto | null>;
}

export function createLayersApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requireUser: () => UserDto;
	loadFile: (url: string) => Promise<Uint8Array>;
	content: ContentModule;
	files: StoredFiles;
}): LayersModule {
	const { db, clock } = deps;
	/** Parsed static Layer files, loaded once per session. Studio files change, so aren't kept. */
	const files = new Map<string, Promise<unknown>>();

	function layerFile<T>(url: string, schema: z.ZodType<T>): Promise<T> {
		if (parseStudioUrl(url)) {
			return deps
				.loadFile(url)
				.then((bytes) => schema.parse(JSON.parse(new TextDecoder().decode(bytes))));
		}
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

	/** Endorsement and readers' ratings (P1-COM-02), with this reader's own. */
	async function community(
		layer: IllustrationPackRecord | AudioTrackRecord,
		userId: string
	): Promise<Pick<IllustrationPackSummaryDto, 'endorsed' | 'rating' | 'myRating'>> {
		const ratings = await db.getAllFromIndex('ratings', 'layerId', layer.id);
		return {
			endorsed: layer.endorsed,
			rating: ratingSummary(ratings),
			myRating: ratings.find((r) => r.userId === userId)?.stars ?? null
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
			creatorHandle: creator?.handle ?? '',
			isOfficial: pack.isOfficial,
			aiUse: pack.aiUse ?? 'none',
			credit: pack.credit,
			illustrationCount: pack.illustrationCount,
			...(await ownership('illustration_pack', pack.id, userId)),
			...(await community(pack, userId))
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
			creatorHandle: creator?.handle ?? '',
			isOfficial: track.isOfficial,
			aiUse: track.aiUse ?? 'none',
			credit: track.credit,
			chapterCount: track.chapterCount,
			durationMs: track.durationMs,
			...(await ownership('audio_track', track.id, userId)),
			...(await community(track, userId))
		};
	}

	/** Official first, then endorsed, then by name: for records, before ratings are looked up. */
	function byRecord<T extends { isOfficial: boolean; endorsed: boolean; name: string }>(
		a: T,
		b: T
	): number {
		return (
			Number(b.isOfficial) - Number(a.isOfficial) ||
			Number(b.endorsed) - Number(a.endorsed) ||
			a.name.localeCompare(b.name)
		);
	}

	/** Official first, then community Layers as the hub orders them (endorsed, top-rated). */
	function byListing<
		T extends {
			isOfficial: boolean;
			name: string;
			endorsed: boolean;
			rating: { average: number; count: number } | null;
		}
	>(a: T, b: T): number {
		return Number(b.isOfficial) - Number(a.isOfficial) || hubOrder(a, b);
	}

	function requireEntitled(
		summary: { entitled: boolean },
		message: string,
		details: Record<string, string>
	) {
		if (!summary.entitled) throw new BackendError('ENTITLEMENT_REQUIRED', message, details);
	}

	const directoryOf = (url: string) => url.replace(/\/[^/]*$/, '');

	/** A URL the platform audio player can stream: Studio uploads become object URLs. */
	async function audioUrl(url: string): Promise<string> {
		const stored = parseStudioUrl(url);
		if (!stored) return url;
		const resolved = await deps.files.url({
			store: 'layerFiles',
			id: stored.layerId,
			path: stored.path
		});
		if (!resolved) throw new BackendError('NOT_FOUND', 'This narration’s audio is missing.');
		return resolved;
	}

	return {
		async summarise(layerId) {
			const user = deps.requireUser();
			const pack = await db.get('illustrationPacks', layerId);
			if (pack) return summarisePack(pack, user.id);
			const track = await db.get('audioTracks', layerId);
			return track ? summariseTrack(track, user.id) : null;
		},

		async list(bookId) {
			const user = deps.requireUser();
			const listed = <T extends { listingState: string }>(records: T[]) =>
				records.filter((r) => r.listingState === 'listed');
			const packs = listed(await db.getAllFromIndex('illustrationPacks', 'bookId', bookId));
			const tracks = listed(await db.getAllFromIndex('audioTracks', 'bookId', bookId));
			return [
				...(await Promise.all(packs.map((p) => summarisePack(p, user.id)))).sort(byListing),
				...(await Promise.all(tracks.map((t) => summariseTrack(t, user.id)))).sort(byListing)
			];
		},

		async openPack(packId): Promise<OpenPackDto> {
			const user = deps.requireUser();
			const pack = await db.get('illustrationPacks', packId);
			// Removed by a moderator (§10.6): gone for readers, still there for its creator.
			if (!pack || (pack.listingState === 'removed' && pack.creatorId !== user.creatorId)) {
				throw new BackendError('NOT_FOUND', 'That illustration pack isn’t available.');
			}
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
			if (!track || (track.listingState === 'removed' && track.creatorId !== user.creatorId)) {
				throw new BackendError('NOT_FOUND', 'That narration isn’t available.');
			}
			const summary = await summariseTrack(track, user.id);
			requireEntitled(summary, 'You don’t have the narration for this book yet.', {
				trackId,
				bookId: track.bookId
			});
			const file: AudioTrackFile = await layerFile(track.trackUrl, audioTrackFileSchema);
			// Aligned to an older Revision than the one readers open, or a Chapter whose text changed
			// since: needs re-aligning (P1-STU-03, §7.2).
			const book = await db.get('books', track.bookId);
			const current = book ? await deps.content.currentRevisionId(book) : file.revisionId;
			const stale = new Set(track.staleChapterIds);
			const { token, expiresAt } = deps.content.grantLayer(trackId, directoryOf(track.trackUrl));
			return {
				track: summary,
				revisionId: file.revisionId,
				chapters: await Promise.all(
					file.chapters.map(async (chapter) => ({
						chapterId: chapter.chapterId,
						syncMap: chapter.syncMap,
						// SIMULATION: a static file or an object URL, readable by anyone who has it. Phase 2
						// serves a signed URL that expires with the content token (§10.3, Invariant 16).
						audioUrl: await audioUrl(chapter.audio),
						durationMs: chapter.durationMs,
						coverage: chapter.coverage,
						status: syncMapStatus(
							chapter.coverage,
							file.revisionId !== current || stale.has(chapter.chapterId)
						)
					}))
				),
				contentToken: token,
				expiresAt: new Date(expiresAt).toISOString()
			};
		},
		async previews(bookId) {
			deps.requireUser();
			const packs = (await db.getAllFromIndex('illustrationPacks', 'bookId', bookId))
				.filter((p) => p.listingState === 'listed')
				.sort(byRecord);
			const illustrations: IllustrationPreviewDto[] = [];
			const readable = new Map<string, string>();
			for (const pack of packs) {
				const file: IllustrationPackFile = await layerFile(
					pack.packUrl,
					illustrationPackFileSchema
				);
				// Invariant 6: a store page shows only what the creator marked spoiler-safe.
				for (const ill of file.illustrations.filter((i) => i.spoilerSafe)) {
					const variants = ill.image.variants.map((v) => ({ ...v, path: `${pack.id}/${v.path}` }));
					ill.image.variants.forEach((v, i) =>
						readable.set(variants[i]!.path, `${directoryOf(pack.packUrl)}/${v.path}`)
					);
					illustrations.push({
						id: ill.id,
						packId: pack.id,
						packName: pack.name,
						alt: ill.alt,
						caption: ill.caption,
						credit: ill.credit,
						image: { ...ill.image, variants }
					});
				}
			}
			// One token covers every preview image, from whichever pack, and nothing else.
			const { token, expiresAt } = deps.content.grantLayerFiles(`previews:${bookId}`, readable);
			return { illustrations, contentToken: token, expiresAt: new Date(expiresAt).toISOString() };
		},

		async narrationSample(bookId) {
			const user = deps.requireUser();
			const track = (await db.getAllFromIndex('audioTracks', 'bookId', bookId))
				.filter((t) => t.listingState === 'listed' && t.sample)
				.sort(byRecord)[0];
			if (!track?.sample) return null;
			const file: AudioTrackFile = await layerFile(track.trackUrl, audioTrackFileSchema);
			const chapter = file.chapters[track.sample.chapter];
			if (!chapter) return null;
			return {
				track: await summariseTrack(track, user.id),
				chapterId: chapter.chapterId,
				chapterTitle: track.sample.title,
				// SIMULATION: as in openTrack.
				audioUrl: await audioUrl(chapter.audio),
				startMs: track.sample.startMs,
				durationMs: track.sample.durationMs
			};
		}
	};
}
