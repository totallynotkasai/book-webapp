/**
 * `Backend.studio` in the browser (DESIGN.md §4.7; P1-STU-01 to P1-STU-04, P1-LAY-05): a
 * Creator's Books, Revisions, Illustration Packs, narration Audio Tracks, plans and simulated
 * earnings. Everything is checked here, not only in the UI (§10.6): non-Creators and other
 * Creators' Books get `FORBIDDEN`. Decisions come from `@book/domain`; text work from the
 * pipeline (text-pipeline, in a Web Worker in the app), as the Phase 2 worker will do it.
 *
 * Uploads return at once with the Revision `processing`, and `studio` is emitted when it's
 * `ready` or `failed`, as a Phase 2 upload is processed by a job. Studio files (images, audio,
 * Sync Maps, `pack.json`, `track.json`) live in `layerFiles` under `studio:` URLs, so readers
 * load Studio Layers exactly as they load seeded ones.
 */
import {
	audioTrackFileSchema,
	BackendError,
	draftIllustrationSchema,
	illustrationSchema,
	parseSyncMap,
	revisionPaths,
	wordIndexSchema,
	type Anchor,
	type AudioTrackFile,
	type BackendTopic,
	type ChapterReviewDto,
	type Clock,
	type DraftIllustrationDto,
	type EarningsDto,
	type IllustrationPackFile,
	type ImageUpload,
	type LayerDetailsInput,
	type Money,
	type OpenBookDto,
	type PlanDto,
	type RevisionChangesDto,
	type RevisionManifest,
	type StudioApi,
	type StudioBookDetailDto,
	type StudioBookDto,
	type StudioPackDto,
	type StudioPackSummaryDto,
	type StudioRevisionDto,
	type StudioTrackChapterDto,
	type StudioTrackDto,
	type StudioTrackSummaryDto,
	type CurationDto,
	type ListingState,
	type StudioLayerDto,
	type SyncMap,
	type UserDto
} from '@book/core';
import {
	addSplits,
	coverageOf,
	earlyAccessFreeAt,
	layerPublishProblems,
	mayMakeFor,
	ratingSummary,
	submission,
	lowConfidenceRegions,
	money,
	PLACEHOLDER_SPLITS,
	publishProblems,
	revisionChanges,
	slugFor,
	splitRevenue,
	syncMapProblems,
	syncMapStatus,
	type ChapterWords,
	type EntitlementRecord,
	type Permission,
	type Split
} from '@book/domain';
import { z } from 'zod';
import { newId, serialiser } from './checkout';
import type { ContentModule } from './content';
import type { BackendDatabase, RevisionRecord } from './db';
import { parseStudioUrl, STUDIO_PREFIX, studioUrl, type StoredFiles } from './files';
import { extensionOf, MAX_IMAGE_BYTES, sniffImage } from './images';
import type { StoryModule } from './story';
import type { Pipeline } from './pipeline';
import { paginate } from './paging';
import type {
	AudioTrackRecord,
	BookRecord,
	IllustrationPackRecord,
	PlanRecord,
	ProductRecord
} from './seed';
import type { InboxModule } from './inbox';
import type { ReleasesModule } from './releases';
import type { ModerationModule } from './moderation';
import type { SupportModule } from './support';

/** §10.2 upload limits. */
const MAX_EPUB_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;
/** A new Book's title until its first upload is processed. */
const UNTITLED = 'Untitled book';
/** The currency new Products are priced in. SIMULATION: one currency until Phase 4. */
const CURRENCY = 'GBP';

/** An Illustration Pack being built: its Illustrations, alt text possibly still missing. */
const draftPackSchema = z.object({
	revisionId: z.string().min(1),
	illustrations: z.array(draftIllustrationSchema)
});
type DraftPack = z.infer<typeof draftPackSchema>;

type Creator = UserDto & { creatorId: string };
type RevisionState = StudioRevisionDto['state'];

export interface StudioDeps {
	db: BackendDatabase;
	clock: Clock;
	requirePermission: (permission: Permission) => UserDto;
	pipeline: Pipeline;
	files: StoredFiles;
	content: ContentModule;
	catalogue: {
		summaries(books: BookRecord[]): Promise<import('@book/core').BookSummaryDto[]>;
		coverUrl(book: BookRecord): Promise<string | null>;
	};
	support: Pick<SupportModule, 'planDto' | 'refresh'>;
	moderation: ModerationModule;
	inbox: InboxModule;
	/** Recaps and glossaries (P1-STU-05). */
	story: StoryModule;
	/** Serial release schedules (P1-STU-06). */
	releases: ReleasesModule;
	changed: (...topics: BackendTopic[]) => void;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Audio types from content, not the extension (§10.2). */
function sniffAudio(b: Uint8Array): { type: string; ext: string } | null {
	const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
	if (ascii(4, 8) === 'ftyp') return { type: 'audio/mp4', ext: 'm4a' };
	if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) {
		return { type: 'audio/mpeg', ext: 'mp3' };
	}
	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { type: 'audio/wav', ext: 'wav' };
	if (ascii(0, 4) === 'OggS') return { type: 'audio/ogg', ext: 'ogg' };
	return null;
}

/** Newest upload first; a seeded Book's own Revision (no upload) is the oldest. */
function newestFirst(a: RevisionRecord, b: RevisionRecord): number {
	const time = (r: RevisionRecord) => r.studio?.uploadedAt ?? r.processedAt;
	return time(b).localeCompare(time(a)) || (b.studio?.seq ?? -1) - (a.studio?.seq ?? -1);
}

const validation = (message: string, details?: unknown) =>
	new BackendError('VALIDATION_FAILED', message, details);

export function createStudioApi(deps: StudioDeps): StudioApi {
	const { db, clock, files, content } = deps;
	const once = serialiser();
	/** Per Revision (immutable): each Chapter's WordIds, and each Chapter's Word texts. */
	const chapterWordsCache = new Map<string, Promise<Map<string, number[]>>>();
	const wordTextsCache = new Map<string, Promise<Map<string, string[]>>>();

	// ---- who may do what (§10.6) ----

	function requireCreator(): Creator {
		const user = deps.requirePermission('studio');
		if (!user.creatorId) {
			throw new BackendError('FORBIDDEN', 'Your account has no creator profile yet.');
		}
		return user as Creator;
	}

	/** A suspended Creator can't publish or start anything new (§10.6). */
	async function requireActive(): Promise<Creator> {
		const user = requireCreator();
		if ((await db.get('creators', user.creatorId))?.suspended) {
			throw new BackendError(
				'FORBIDDEN',
				'Your account is suspended. Check your inbox for the reason and how to appeal.'
			);
		}
		return user;
	}

	/**
	 * A Book a Creator may make a Layer for: their own, or another author's listed Book whose
	 * policy allows community work (Invariant 19, P1-COM-01).
	 */
	async function bookForLayer(bookId: string) {
		const user = await requireActive();
		const book = await db.get('books', bookId);
		if (!book) throw new BackendError('NOT_FOUND', 'That book isn’t in the store.');
		if (book.creatorId === user.creatorId) return { user, book, community: false };
		if (book.listingState !== 'listed') {
			throw new BackendError('NOT_FOUND', 'That book isn’t in the store.');
		}
		const may = mayMakeFor(book, user.creatorId);
		if (!may.allowed) throw new BackendError('FORBIDDEN', may.reason);
		return { user, book, community: true };
	}

	async function ownBook(bookId: string): Promise<{ user: Creator; book: BookRecord }> {
		const user = requireCreator();
		const book = await db.get('books', bookId);
		if (!book) throw new BackendError('NOT_FOUND', 'That book isn’t in your Studio.');
		if (book.creatorId !== user.creatorId) {
			throw new BackendError('FORBIDDEN', 'That isn’t one of your books.');
		}
		return { user, book };
	}

	async function ownPack(packId: string) {
		const user = requireCreator();
		const pack = await db.get('illustrationPacks', packId);
		if (!pack || !parseStudioUrl(pack.packUrl)) {
			throw new BackendError('NOT_FOUND', 'That illustration pack isn’t in your Studio.');
		}
		if (pack.creatorId !== user.creatorId) {
			throw new BackendError('FORBIDDEN', 'That isn’t one of your illustration packs.');
		}
		return { user, pack };
	}

	async function ownTrack(trackId: string) {
		const user = requireCreator();
		const track = await db.get('audioTracks', trackId);
		if (!track || !parseStudioUrl(track.trackUrl)) {
			throw new BackendError('NOT_FOUND', 'That narration isn’t in your Studio.');
		}
		if (track.creatorId !== user.creatorId) {
			throw new BackendError('FORBIDDEN', 'That isn’t one of your narrations.');
		}
		return { user, track };
	}

	// ---- Products and Entitlements ----

	async function productOf(kind: ProductRecord['kind'], refId: string) {
		return (await db.getAll('products')).find((p) => p.kind === kind && p.refId === refId);
	}

	/**
	 * A Product for something new, and the Creator's own Entitlement to it (`grant`), so that
	 * previewing their own work goes through the Entitlements module like any reader (Inv. 15).
	 */
	async function createProduct(
		user: Creator,
		product: Omit<ProductRecord, 'status' | 'childProductIds'>
	): Promise<void> {
		const tx = db.transaction(['products', 'entitlements'], 'readwrite');
		await tx.objectStore('products').put({ ...product, status: 'active', childProductIds: [] });
		const grant: EntitlementRecord = {
			id: newId('ent'),
			userId: user.id,
			productId: product.id,
			source: 'grant',
			grantedAt: clock.now().toISOString(),
			revokedAt: null,
			parentId: null
		};
		await tx.objectStore('entitlements').put(grant);
		await tx.done;
	}

	async function setPrice(kind: ProductRecord['kind'], refId: string, price: Money | undefined) {
		if (!price) return;
		const product = await productOf(kind, refId);
		if (product) await db.put('products', { ...product, price });
	}

	// ---- Revisions ----

	function stateOf(record: RevisionRecord, book: BookRecord): RevisionState {
		if (record.studio) return record.studio.state;
		// The seeded Book's own Revision: current until its author publishes one in the Studio.
		return book.currentRevisionId && book.currentRevisionId !== record.id
			? 'superseded'
			: 'published';
	}

	async function manifestOrNull(revisionId: string): Promise<RevisionManifest | null> {
		try {
			return await content.manifestOf(revisionId);
		} catch {
			return null;
		}
	}

	async function revisionDto(record: RevisionRecord, book: BookRecord): Promise<StudioRevisionDto> {
		const state = stateOf(record, book);
		const manifest =
			state === 'processing' || state === 'failed' ? null : await manifestOrNull(record.id);
		// When each Chapter comes out (P1-STU-06), for the version readers have and those to come.
		const releases =
			manifest && (state === 'published' || state === 'ready')
				? await deps.releases.forStudio(book, manifest)
				: null;
		return {
			id: record.id,
			bookId: record.bookId,
			state,
			uploadedAt: record.studio?.uploadedAt ?? record.processedAt,
			publishedAt: record.studio ? record.studio.publishedAt : null,
			aiUse: record.studio ? record.studio.aiUse : book.aiUse,
			report: record.report ?? null,
			failure: record.studio?.failure ?? null,
			changes: record.studio?.changes ?? null,
			chapters: (manifest?.chapters ?? [])
				.filter((c) => c.linear && c.wordCount > 0)
				.map((c) => ({
					chapterId: c.chapterId,
					title: c.title,
					wordCount: c.wordCount,
					release: releases?.get(c.chapterId) ?? {
						state: 'out' as const,
						releaseAt: null,
						scheduledAt: null,
						schedulable: false
					}
				}))
		};
	}

	/** The Book's Revisions, newest first. A seeded Book's own is processed on first look. */
	async function revisionsOf(book: BookRecord): Promise<RevisionRecord[]> {
		if (!book.currentRevisionId && book.epubUrl) await content.currentRevisionId(book);
		const records = await db.getAllFromIndex('revisions', 'bookId', book.id);
		return records.sort(newestFirst);
	}

	/**
	 * The Revision Layers are built on (P1-LAY-05, P1-STU-03): the one readers open now, or for
	 * a Book never published, its newest processed upload.
	 */
	async function workingRevisionId(book: BookRecord): Promise<string> {
		if (book.currentRevisionId || book.epubUrl) return content.currentRevisionId(book);
		const ready = (await revisionsOf(book)).find((r) => r.studio?.state === 'ready');
		if (!ready) throw new BackendError('CONFLICT', 'Upload the book’s text first.');
		return ready.id;
	}

	function chapterWords(revisionId: string): Promise<Map<string, number[]>> {
		let cached = chapterWordsCache.get(revisionId);
		if (!cached) {
			cached = (async () => {
				const manifest = await content.manifestOf(revisionId);
				const words = new Map<string, number[]>();
				for (const chapter of manifest.chapters) {
					const file = await db.get('content', [
						revisionId,
						revisionPaths.wordIndex(chapter.chapterId)
					]);
					const index = file
						? wordIndexSchema.parse(JSON.parse(new TextDecoder().decode(file.bytes)))
						: null;
					words.set(chapter.chapterId, index ? index.words.map((w) => w[0]) : []);
				}
				return words;
			})();
			cached.catch(() => chapterWordsCache.delete(revisionId));
			chapterWordsCache.set(revisionId, cached);
		}
		return cached;
	}

	function wordTexts(revisionId: string): Promise<Map<string, string[]>> {
		let cached = wordTextsCache.get(revisionId);
		if (!cached) {
			cached = (async () => {
				const chapters = await deps.pipeline.words(await files.revisionText(revisionId));
				return new Map(chapters.map((c) => [c.chapterId, c.texts]));
			})();
			cached.catch(() => wordTextsCache.delete(revisionId));
			wordTextsCache.set(revisionId, cached);
		}
		return cached;
	}

	const asChapterWords = (words: Map<string, number[]>): ChapterWords[] =>
		[...words].map(([chapterId, wordIds]) => ({ chapterId, wordIds }));

	/** Narration Chapters a change would make stale (§7.2). */
	async function staleNarrationFor(bookId: string, changed: Set<string>) {
		const out: { trackId: string; trackName: string; chapterId: string }[] = [];
		for (const track of await db.getAllFromIndex('audioTracks', 'bookId', bookId)) {
			if (!parseStudioUrl(track.trackUrl)) continue;
			const file = await trackFile(track);
			for (const chapter of file.chapters) {
				if (changed.has(chapter.chapterId)) {
					out.push({ trackId: track.id, trackName: track.name, chapterId: chapter.chapterId });
				}
			}
		}
		return out;
	}

	/** Processes an upload in the background, as a Phase 2 job would. */
	async function process(bookId: string, revisionId: string, bytes: Uint8Array): Promise<void> {
		const record = (await db.get('revisions', revisionId))!;
		try {
			const book = (await db.get('books', bookId))!;
			const previousId =
				book.currentRevisionId || book.epubUrl ? await content.currentRevisionId(book) : null;
			const result = await deps.pipeline.ingest(bytes, {
				bookId,
				firstWordId: book.nextWordId,
				previous: previousId ? await files.revisionText(previousId) : undefined
			});
			if (result.revisionId !== revisionId) {
				throw new Error('The processed file doesn’t match the upload.');
			}
			let changes: RevisionChangesDto | null = null;
			if (previousId) {
				const before = asChapterWords(await chapterWords(previousId));
				const decoder = new TextDecoder();
				const after = result.manifest.chapters.map((c) => {
					const file = result.files.find((f) => f.path === revisionPaths.wordIndex(c.chapterId));
					const index = file
						? wordIndexSchema.parse(JSON.parse(decoder.decode(file.data)))
						: { words: [] };
					return { chapterId: c.chapterId, wordIds: index.words.map((w) => w[0]) };
				});
				const diff = revisionChanges(before, after);
				changes = {
					previousRevisionId: previousId,
					...diff,
					staleNarration: await staleNarrationFor(
						bookId,
						new Set([...diff.changedChapterIds, ...diff.removedChapterIds])
					)
				};
			}
			await content.saveRevision(bookId, result, {
				...record.studio!,
				state: 'ready',
				changes
			});
			// A new Book takes its title, language and cover from its first upload.
			const latest = (await db.get('books', bookId))!;
			if (latest.title === UNTITLED && !latest.currentRevisionId) {
				const title = result.manifest.title.trim() || UNTITLED;
				const all = await db.getAll('books');
				const slug = slugFor(title, (s) => all.some((b) => b.slug === s && b.id !== bookId));
				await db.put('books', {
					...latest,
					title,
					slug,
					lang: result.manifest.lang,
					coverFile:
						latest.coverFile ??
						(result.manifest.coverPath
							? {
									store: 'content',
									id: revisionId,
									path: revisionPaths.resource(result.manifest.coverPath)
								}
							: null)
				});
			}
		} catch (error) {
			const message =
				// text-pipeline's own failures say what to do; anything else gets a general reason.
				error instanceof Error &&
				error.name === 'IngestError' &&
				(error as { code?: unknown }).code != null
					? error.message
					: 'Something went wrong while processing this file. Try again; if it keeps happening, the file may be damaged.';
			await db.put('revisions', {
				...record,
				studio: { ...record.studio!, state: 'failed', failure: message }
			});
		}
		deps.changed('studio');
	}

	async function detail(book: BookRecord): Promise<StudioBookDetailDto> {
		const [records, product, packs, tracks] = await Promise.all([
			revisionsOf(book),
			productOf('book', book.id),
			db.getAllFromIndex('illustrationPacks', 'bookId', book.id),
			db.getAllFromIndex('audioTracks', 'bookId', book.id)
		]);
		const fresh = (await db.get('books', book.id)) ?? book;
		return {
			id: fresh.id,
			slug: fresh.slug,
			creatorId: fresh.creatorId,
			listingState: fresh.listingState,
			coverUrl: await deps.catalogue.coverUrl(fresh),
			settings: {
				title: fresh.title,
				description: fresh.description,
				price: product?.price ?? money(0, CURRENCY),
				contentRating: fresh.contentRating,
				contentWarnings: fresh.contentWarnings,
				communityPolicy: fresh.communityPolicy,
				communityAi: fresh.communityAi,
				isSerial: fresh.isSerial,
				earlyAccessChapters: fresh.earlyAccess?.chapters ?? 0
			},
			aiUse: fresh.aiUse,
			currentRevisionId:
				fresh.currentRevisionId ??
				records.find((r) => stateOf(r, fresh) === 'published')?.id ??
				null,
			revisions: await Promise.all(records.map((r) => revisionDto(r, fresh))),
			packs: await Promise.all(
				packs
					.filter((p) => p.creatorId === fresh.creatorId && parseStudioUrl(p.packUrl))
					.map(packSummary)
			),
			tracks: await Promise.all(
				tracks
					.filter((t) => t.creatorId === fresh.creatorId && parseStudioUrl(t.trackUrl))
					.map(trackSummary)
			)
		};
	}

	/** Packs and tracks move to a newly published Revision (§6.2): placed again, or stale. */
	async function moveLayers(book: BookRecord, to: string): Promise<void> {
		for (const pack of await db.getAllFromIndex('illustrationPacks', 'bookId', book.id)) {
			if (!parseStudioUrl(pack.packUrl)) continue;
			const draft = await draftOf(pack.id);
			if (draft.revisionId === to) continue;
			const live = draft.illustrations.filter((i) => i.anchorStatus !== 'orphaned');
			const moved = live.length
				? await deps.pipeline.migrate({
						before: await files.revisionText(draft.revisionId),
						after: await files.revisionText(to),
						anchors: live.map((i) => i.anchor),
						progress: []
					})
				: { anchors: [] };
			const placed = new Map(live.map((ill, i) => [ill.id, moved.anchors[i]!]));
			const next: DraftPack = {
				revisionId: to,
				illustrations: draft.illustrations.map((ill) => {
					const m = placed.get(ill.id);
					if (!m || m.status === 'orphaned' || m.anchor.kind !== 'range') {
						return { ...ill, anchorStatus: 'orphaned' };
					}
					return { ...ill, anchor: m.anchor, anchorStatus: m.status };
				})
			};
			await saveDraft(pack, next, { force: true });
		}
		for (const track of await db.getAllFromIndex('audioTracks', 'bookId', book.id)) {
			if (!parseStudioUrl(track.trackUrl)) continue;
			const file = await trackFile(track);
			if (file.revisionId === to) continue;
			const diff = revisionChanges(
				asChapterWords(await chapterWords(file.revisionId)),
				asChapterWords(await chapterWords(to))
			);
			const changed = new Set([...diff.changedChapterIds, ...diff.removedChapterIds]);
			const stale = new Set(track.staleChapterIds);
			for (const chapter of file.chapters) {
				if (changed.has(chapter.chapterId)) {
					stale.add(chapter.chapterId);
					continue;
				}
				// Same Words, same WordIds: the timings still hold on the new Revision.
				const map = await syncMapOf(track.id, chapter.syncMap);
				if (map) await putJson(track.id, chapter.syncMap, { ...map, revisionId: to });
			}
			await putJson(track.id, 'track.json', { ...file, revisionId: to });
			await db.put('audioTracks', { ...track, staleChapterIds: [...stale] });
		}
	}

	// ---- packs (P1-LAY-05) ----

	async function readJson<T>(layerId: string, path: string, schema: z.ZodType<T>): Promise<T> {
		const bytes = await files.read(layerId, path);
		if (!bytes) throw new BackendError('SERVER_ERROR', `The Studio’s ${path} is missing.`);
		return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
	}

	async function putJson(layerId: string, path: string, value: unknown): Promise<void> {
		await files.put(
			layerId,
			path,
			new TextEncoder().encode(JSON.stringify(value)),
			'application/json'
		);
	}

	const draftOf = (packId: string) => readJson(packId, 'draft.json', draftPackSchema);

	function packProblems(pack: IllustrationPackRecord, draft: DraftPack): string[] {
		const live = draft.illustrations.filter((i) => i.anchorStatus !== 'orphaned');
		return layerPublishProblems({
			aiUse: pack.aiUse,
			items: live.length,
			missingAlt: live.filter((i) => !i.alt.trim()).length,
			itemName: { one: 'picture', many: 'pictures' }
		});
	}

	/**
	 * Saves a pack's draft. A listed pack goes live on every save, so a save that would break
	 * the publishing rules is refused (unless `force`, for moving Layers to a new Revision).
	 */
	async function saveDraft(
		pack: IllustrationPackRecord,
		draft: DraftPack,
		options: { force?: boolean } = {}
	): Promise<IllustrationPackRecord> {
		draft.illustrations.sort((a, b) => a.anchor.startOrdinal - b.anchor.startOrdinal);
		const live = draft.illustrations.filter((i) => i.anchorStatus !== 'orphaned');
		if (pack.listingState === 'listed' && !options.force) {
			const problems = packProblems(pack, draft);
			if (problems.length) throw validation(problems.join(' '));
		}
		await putJson(pack.id, 'draft.json', draft);
		const record = { ...pack, illustrationCount: live.length };
		if (record.listingState === 'listed') await writePackFile(record, draft);
		await db.put('illustrationPacks', record);
		return record;
	}

	/** The `pack.json` readers load (§8.2): placed Illustrations only, all with alt text. */
	async function writePackFile(pack: IllustrationPackRecord, draft: DraftPack): Promise<void> {
		const file: IllustrationPackFile = {
			version: 1,
			id: pack.id,
			bookId: pack.bookId,
			revisionId: draft.revisionId,
			creatorId: pack.creatorId,
			name: pack.name,
			description: pack.description,
			isOfficial: pack.isOfficial,
			aiUse: pack.aiUse ?? 'none',
			credit: pack.credit,
			illustrations: draft.illustrations
				.filter((i) => i.anchorStatus !== 'orphaned' && i.alt.trim())
				// The reader-facing schema drops what only the Studio needs (`anchorStatus`).
				.map((illustration) => illustrationSchema.parse(illustration))
		};
		await putJson(pack.id, 'pack.json', file);
	}

	async function packSummary(pack: IllustrationPackRecord): Promise<StudioPackSummaryDto> {
		const [draft, product] = await Promise.all([
			draftOf(pack.id),
			productOf('illustration_pack', pack.id)
		]);
		const live = draft.illustrations.filter((i) => i.anchorStatus !== 'orphaned');
		return {
			id: pack.id,
			bookId: pack.bookId,
			name: pack.name,
			isOfficial: pack.isOfficial,
			listingState: pack.listingState,
			illustrationCount: live.length,
			missingAlt: live.filter((i) => !i.alt.trim()).length,
			orphaned: draft.illustrations.length - live.length,
			aiUse: pack.aiUse,
			price: product?.price ?? money(0, CURRENCY),
			relabelRequired: pack.relabelRequired
		};
	}

	async function packDto(pack: IllustrationPackRecord): Promise<StudioPackDto> {
		const draft = await draftOf(pack.id);
		const { token, expiresAt } = content.grantLayer(pack.id, `${STUDIO_PREFIX}${pack.id}`);
		return {
			...(await packSummary(pack)),
			description: pack.description,
			credit: pack.credit,
			revisionId: draft.revisionId,
			illustrations: draft.illustrations,
			contentToken: token,
			expiresAt: new Date(expiresAt).toISOString()
		};
	}

	/** Stores an image's WebP variants (§7.3), checking each really is an image. */
	async function storeImage(packId: string, illustrationId: string, image: ImageUpload) {
		const variants = [];
		for (const variant of [...image.variants].sort((a, b) => a.width - b.width)) {
			if (variant.file.size > MAX_IMAGE_BYTES) {
				throw new BackendError('UPLOAD_TOO_LARGE', 'Pictures can be up to 25 MB.');
			}
			const bytes = new Uint8Array(await variant.file.arrayBuffer());
			const type = sniffImage(bytes);
			if (!type) throw validation('That file isn’t a picture we can show (use JPEG, PNG or WebP).');
			const path = `images/${illustrationId}-${variant.width}.${extensionOf(type)}`;
			await files.put(packId, path, bytes, type);
			variants.push({ width: variant.width, path });
		}
		return { width: image.width, height: image.height, dominant: image.dominant, variants };
	}

	async function removeImages(packId: string, illustration: DraftIllustrationDto) {
		for (const variant of illustration.image.variants) await files.remove(packId, variant.path);
	}

	function checkAnchor(anchor: Anchor, pack: IllustrationPackRecord, draft: DraftPack) {
		if (anchor.kind !== 'range' || anchor.bookId !== pack.bookId) {
			throw validation('Select a passage of this book.');
		}
		if (anchor.revisionId !== draft.revisionId) {
			throw validation('The book has a newer version: select the passage again.');
		}
		if (anchor.startOrdinal > anchor.endOrdinal) throw validation('The passage is back to front.');
	}

	/** A pack's or track's details changed (its Product's price too). */
	async function withDetails<T extends IllustrationPackRecord | AudioTrackRecord>(
		kind: 'illustration_pack' | 'audio_track',
		record: T,
		details: LayerDetailsInput & { narrator?: string }
	): Promise<T> {
		await setPrice(kind, record.id, details.price);
		return {
			...record,
			...(details.name !== undefined ? { name: details.name } : {}),
			...(details.description !== undefined ? { description: details.description } : {}),
			...(details.credit !== undefined ? { credit: details.credit } : {}),
			// Answering the AI question again settles a moderator's request to relabel (§10.6).
			...(details.aiUse !== undefined ? { aiUse: details.aiUse, relabelRequired: false } : {}),
			...(details.narrator !== undefined && 'narrator' in record
				? { narrator: details.narrator }
				: {})
		};
	}

	// ---- narration (P1-STU-03) ----

	const trackFile = (track: AudioTrackRecord) =>
		readJson(track.id, 'track.json', audioTrackFileSchema);

	async function syncMapOf(trackId: string, path: string): Promise<SyncMap | null> {
		const bytes = await files.read(trackId, path);
		return bytes ? parseSyncMap(JSON.parse(new TextDecoder().decode(bytes))) : null;
	}

	/** A Chapter's status in the Studio: reviewing every region makes a low-coverage map ready. */
	function chapterStatus(
		track: AudioTrackRecord,
		chapter: AudioTrackFile['chapters'][number],
		regions: number
	): StudioTrackChapterDto['status'] {
		const stale = track.staleChapterIds.includes(chapter.chapterId);
		const reviewed = (track.reviewed[chapter.chapterId] ?? []).length;
		return syncMapStatus(regions > 0 && reviewed >= regions ? 1 : chapter.coverage, stale);
	}

	async function trackChapters(track: AudioTrackRecord, file: AudioTrackFile) {
		const manifest = await content.manifestOf(file.revisionId);
		const entries = new Map(file.chapters.map((c) => [c.chapterId, c]));
		return Promise.all(
			manifest.chapters
				.filter((c) => c.linear && c.wordCount > 0)
				.map(async (c): Promise<StudioTrackChapterDto> => {
					const entry = entries.get(c.chapterId);
					if (!entry) {
						return {
							chapterId: c.chapterId,
							title: c.title,
							wordCount: c.wordCount,
							status: 'missing',
							durationMs: null,
							coverage: null,
							regions: 0,
							reviewed: 0
						};
					}
					const map = await syncMapOf(track.id, entry.syncMap);
					const regions = map ? lowConfidenceRegions(map.words).length : 0;
					return {
						chapterId: c.chapterId,
						title: c.title,
						wordCount: c.wordCount,
						status: chapterStatus(track, entry, regions),
						durationMs: entry.durationMs,
						coverage: entry.coverage,
						regions,
						reviewed: (track.reviewed[c.chapterId] ?? []).length
					};
				})
		);
	}

	async function trackSummary(track: AudioTrackRecord): Promise<StudioTrackSummaryDto> {
		const file = await trackFile(track);
		const chapters = await trackChapters(track, file);
		const product = await productOf('audio_track', track.id);
		const count = (status: string) => chapters.filter((c) => c.status === status).length;
		return {
			id: track.id,
			bookId: track.bookId,
			name: track.name,
			narrator: track.narrator,
			isOfficial: track.isOfficial,
			listingState: track.listingState,
			aiUse: track.aiUse,
			price: product?.price ?? money(0, CURRENCY),
			chapterCount: file.chapters.length,
			ready: count('ready'),
			needsReview: count('needs_review'),
			stale: count('stale'),
			relabelRequired: track.relabelRequired
		};
	}

	async function trackDto(track: AudioTrackRecord): Promise<StudioTrackDto> {
		const file = await trackFile(track);
		return {
			...(await trackSummary(track)),
			description: track.description,
			credit: track.credit,
			revisionId: file.revisionId,
			chapters: await trackChapters(track, file)
		};
	}

	async function review(track: AudioTrackRecord, chapterId: string): Promise<ChapterReviewDto> {
		const file = await trackFile(track);
		const entry = file.chapters.find((c) => c.chapterId === chapterId);
		if (!entry) throw new BackendError('NOT_FOUND', 'That chapter has no narration yet.');
		const map = await syncMapOf(track.id, entry.syncMap);
		if (!map) throw new BackendError('NOT_FOUND', 'That chapter’s Sync Map is missing.');
		const ids = (await chapterWords(file.revisionId)).get(chapterId) ?? [];
		const texts = (await wordTexts(file.revisionId)).get(chapterId) ?? [];
		const position = new Map(ids.map((id, i) => [id, i]));
		const reviewed = new Set(track.reviewed[chapterId] ?? []);
		const regions = lowConfidenceRegions(map.words);
		const stored = parseStudioUrl(entry.audio)!;
		const audioUrl = await files.url({
			store: 'layerFiles',
			id: stored.layerId,
			path: stored.path
		});
		if (!audioUrl) throw new BackendError('NOT_FOUND', 'That chapter’s audio is missing.');
		const CONTEXT = 6;
		return {
			trackId: track.id,
			chapterId,
			chapterTitle:
				(await content.manifestOf(file.revisionId)).chapters.find((c) => c.chapterId === chapterId)
					?.title ?? '',
			coverage: entry.coverage,
			status: chapterStatus(track, entry, regions.length) as ChapterReviewDto['status'],
			durationMs: entry.durationMs,
			audioUrl,
			regions: regions.map((region) => {
				// The region's Words in text order, with a few on either side.
				const at = map.words
					.slice(region.from, region.to + 1)
					.map((w) => position.get(w[0]))
					.filter((p): p is number => p !== undefined);
				const first = Math.min(...at);
				const last = Math.max(...at);
				const join = (from: number, to: number) => texts.slice(Math.max(0, from), to).join(' ');
				return {
					index: region.index,
					startMs: region.startMs,
					endMs: region.endMs,
					firstWordId: region.firstWordId,
					lastWordId: region.lastWordId,
					wordCount: region.wordCount,
					before: Number.isFinite(first) ? join(first - CONTEXT, first) : '',
					text: Number.isFinite(first) ? join(first, last + 1) : '',
					after: Number.isFinite(last) ? join(last + 1, last + 1 + CONTEXT) : '',
					reviewed: reviewed.has(region.index)
				};
			})
		};
	}

	// ---- plans and earnings (P1-STU-04) ----

	/** A serial's early-access Product, made on first use (SIMULATION, OPEN-10). */
	async function earlyAccessProduct(user: Creator, book: BookRecord): Promise<string> {
		const existing = await productOf('early_access', book.id);
		if (existing) return existing.id;
		const id = `product-early-${book.id}`;
		await createProduct(user, {
			id,
			kind: 'early_access',
			refId: book.id,
			bookId: book.id,
			creatorId: book.creatorId,
			isOfficial: true,
			price: money(0, CURRENCY)
		});
		return id;
	}

	// ---- community and moderation (P1-COM-01, P1-ADM-01, P1-ADM-02) ----

	type LayerRecord = IllustrationPackRecord | AudioTrackRecord;
	const layerKind = (layer: LayerRecord) =>
		'packUrl' in layer ? ('illustration_pack' as const) : ('audio_track' as const);
	const kindName = (kind: 'illustration_pack' | 'audio_track') =>
		kind === 'illustration_pack' ? 'illustration pack' : 'narration';

	async function heldNotice(
		creatorId: string,
		type: 'book' | 'illustration_pack' | 'audio_track',
		id: string,
		title: string
	) {
		await deps.inbox.notify(
			{ creatorId },
			{
				title: `“${title}” is held for review`,
				body: 'It may have been made with AI but isn’t labelled as such. A moderator will look at it soon; until then only you can see it. If AI was used, correct the AI answer in its details.',
				about: { type, id }
			}
		);
	}

	/**
	 * Where a published pack or narration goes (§6.6, §10.6): the author's own is listed; a
	 * community one follows the Book's policy (Invariant 19); either is held when the automatic
	 * Flags say so. One already listed, waiting or held stays as it is.
	 */
	async function submit(
		kind: 'illustration_pack' | 'audio_track',
		layer: LayerRecord,
		items: number
	): Promise<ListingState> {
		if (['listed', 'pending', 'held'].includes(layer.listingState)) return layer.listingState;
		if (layer.listingState === 'removed') {
			throw new BackendError('FORBIDDEN', 'A moderator removed this, so it can’t be published.');
		}
		await requireActive();
		const book = (await db.get('books', layer.bookId))!;
		const decision = submission(book, { creatorId: layer.creatorId, aiUse: layer.aiUse });
		if (!decision.allowed) throw new BackendError('FORBIDDEN', decision.reason);
		let state: ListingState =
			decision.state === 'pending' && layer.authorApproved ? 'listed' : decision.state;
		const check = await deps.moderation.checkPublish({
			type: kind,
			id: layer.id,
			volumeTargetId: layer.id,
			creatorId: layer.creatorId,
			aiUse: layer.aiUse,
			priceMinor: (await productOf(kind, layer.id))?.price.amountMinor ?? 0
		});
		if (check.hold) {
			state = 'held';
			await heldNotice(layer.creatorId, kind, layer.id, layer.name);
		} else if (state === 'pending') {
			const creator = await db.get('creators', layer.creatorId);
			await deps.inbox.notify(
				{ creatorId: book.creatorId },
				{
					title: `A community ${kindName(kind)} for “${book.title}”`,
					body: `${creator?.displayName ?? 'A creator'} made “${layer.name}” (${items} ${kind === 'illustration_pack' ? (items === 1 ? 'picture' : 'pictures') : items === 1 ? 'chapter' : 'chapters'}) for your book. Approve or decline it in your Studio.`,
					about: { type: kind, id: layer.id }
				}
			);
		}
		return state;
	}

	/** A community Layer on one of the signed-in author's own Books. */
	async function communityLayer(layerId: string) {
		const layer =
			(await db.get('illustrationPacks', layerId)) ?? (await db.get('audioTracks', layerId));
		if (!layer) throw new BackendError('NOT_FOUND', 'That isn’t on one of your books.');
		const { book } = await ownBook(layer.bookId);
		if (layer.creatorId === book.creatorId) {
			throw new BackendError(
				'VALIDATION_FAILED',
				'That’s your own; curation is for community work.'
			);
		}
		return { layer, book };
	}

	/** Saves a Layer's new state; a pack's `pack.json` is written once it's listed. */
	async function saveLayer(layer: LayerRecord) {
		if ('packUrl' in layer) {
			await saveDraft(layer, await draftOf(layer.id), { force: true });
		} else {
			await db.put('audioTracks', layer);
		}
	}

	async function curated(layer: LayerRecord) {
		const creator = await db.get('creators', layer.creatorId);
		return {
			id: layer.id,
			kind: layerKind(layer),
			name: layer.name,
			creatorName: creator?.displayName ?? '',
			creatorHandle: creator?.handle ?? '',
			state: layer.listingState,
			aiUse: layer.aiUse,
			endorsed: layer.endorsed,
			rating: ratingSummary(await db.getAllFromIndex('ratings', 'layerId', layer.id)),
			items: 'packUrl' in layer ? layer.illustrationCount : layer.chapterCount
		};
	}

	async function curationOf(book: BookRecord): Promise<CurationDto> {
		const layers = [
			...(await db.getAllFromIndex('illustrationPacks', 'bookId', book.id)),
			...(await db.getAllFromIndex('audioTracks', 'bookId', book.id))
		].filter((l) => l.creatorId !== book.creatorId && l.listingState !== 'draft');
		const all = await Promise.all(layers.map(curated));
		return {
			bookId: book.id,
			policy: book.communityPolicy,
			communityAi: book.communityAi,
			pending: all.filter((l) => l.state === 'pending'),
			layers: all
				.filter((l) => ['listed', 'delisted', 'held'].includes(l.state))
				.sort((a, b) => Number(b.endorsed) - Number(a.endorsed) || a.name.localeCompare(b.name)),
			flags: (await deps.moderation.flagsAbout(book.id)).map((f) => ({
				rule: f.rule,
				targetTitle: f.targetTitle,
				details: f.details,
				createdAt: f.createdAt
			}))
		};
	}

	async function latestPublish(book: BookRecord): Promise<string> {
		const times = (await db.getAllFromIndex('revisions', 'bookId', book.id))
			.map((r) => r.studio?.publishedAt)
			.filter((t): t is string => !!t)
			.sort();
		return times.at(-1) ?? clock.now().toISOString();
	}

	return {
		async listBooks(page) {
			const user = requireCreator();
			await deps.releases.refresh();
			const books = (await db.getAllFromIndex('books', 'creatorId', user.creatorId)).sort((a, b) =>
				a.title.localeCompare(b.title)
			);
			const summaries = await deps.catalogue.summaries(books);
			const result: StudioBookDto[] = [];
			for (const [i, book] of books.entries()) {
				const pending = (await db.getAllFromIndex('revisions', 'bookId', book.id))
					.filter((r) => r.studio && ['processing', 'ready', 'failed'].includes(r.studio.state))
					.sort(newestFirst)[0];
				result.push({
					...summaries[i]!,
					listingState: book.listingState,
					pendingRevision: (pending?.studio?.state as StudioBookDto['pendingRevision']) ?? null
				});
			}
			return paginate(result, page);
		},

		async getBook(bookId) {
			const { book } = await ownBook(bookId);
			await deps.releases.refresh();
			return detail(book);
		},

		async upload(file, options) {
			const user = await requireActive();
			if (file.size > MAX_EPUB_BYTES) {
				throw new BackendError('UPLOAD_TOO_LARGE', 'EPUB files can be up to 100 MB.');
			}
			let book = options?.bookId ? (await ownBook(options.bookId)).book : null;
			const bytes = new Uint8Array(await file.arrayBuffer());
			const revisionId = await sha256Hex(bytes);
			return once(revisionId, async () => {
				const existing = await db.get('revisions', revisionId);
				const owner = existing ? await db.get('books', existing.bookId) : undefined;
				if (existing && owner) {
					// The same file again gives the Revision it made before (an idempotent upload).
					const mine = owner.creatorId === user.creatorId;
					if (mine && (!book || owner.id === book.id)) return revisionDto(existing, owner);
					throw new BackendError(
						'CONFLICT',
						owner.creatorId === user.creatorId
							? `This file is already “${owner.title}”. To publish a new version, upload it from that book’s page.`
							: 'This file is already another book in the store.'
					);
				}
				const now = clock.now().toISOString();
				if (!book) {
					const id = newId('book');
					book = {
						id,
						slug: `draft-${id}`,
						title: UNTITLED,
						creatorId: user.creatorId,
						lang: 'en',
						aiUse: null,
						description: '',
						coverUrl: null,
						coverFile: null,
						epubUrl: null,
						listingState: 'draft',
						contentRating: 'all_ages',
						contentWarnings: [],
						isSerial: false,
						earlyAccess: null,
						currentRevisionId: null,
						nextWordId: 1,
						communityPolicy: 'closed',
						communityAi: 'allowed',
						relabelRequired: false,
						endorsed: false,
						authorApproved: false
					};
					await db.put('books', book);
					await createProduct(user, {
						id: `product-${id}`,
						kind: 'book',
						refId: id,
						bookId: id,
						creatorId: user.creatorId,
						isOfficial: true,
						price: money(0, CURRENCY)
					});
				}
				const record: RevisionRecord = {
					id: revisionId,
					bookId: book.id,
					processedAt: '',
					studio: {
						state: 'processing',
						uploadedAt: now,
						seq: (await db.getAllFromIndex('revisions', 'bookId', book.id)).length,
						publishedAt: null,
						aiUse: null,
						failure: null,
						changes: null
					}
				};
				await db.put('revisions', record);
				void process(book.id, revisionId, bytes);
				deps.changed('studio');
				return revisionDto(record, book);
			});
		},

		async updateBook(bookId, changes) {
			const { user, book } = await ownBook(bookId);
			const next: BookRecord = { ...book };
			if (changes.title !== undefined) next.title = changes.title;
			if (changes.description !== undefined) next.description = changes.description;
			if (changes.contentRating !== undefined) next.contentRating = changes.contentRating;
			if (changes.contentWarnings !== undefined) next.contentWarnings = changes.contentWarnings;
			if (changes.communityPolicy !== undefined) next.communityPolicy = changes.communityPolicy;
			if (changes.communityAi !== undefined) next.communityAi = changes.communityAi;
			if (changes.isSerial !== undefined) next.isSerial = changes.isSerial;
			if (changes.aiUse !== undefined) {
				// A corrected AI answer for the version readers have (§10.6 relabelling).
				next.aiUse = changes.aiUse;
				next.relabelRequired = false;
				const current = book.currentRevisionId
					? await db.get('revisions', book.currentRevisionId)
					: undefined;
				if (current?.studio) {
					await db.put('revisions', {
						...current,
						studio: { ...current.studio, aiUse: changes.aiUse }
					});
				}
			}
			if (changes.earlyAccessChapters !== undefined) {
				// SIMULATION (OPEN-10): the newest Chapters, for 30 days after the latest release.
				next.earlyAccess =
					changes.earlyAccessChapters > 0
						? {
								chapters: changes.earlyAccessChapters,
								freeAt: earlyAccessFreeAt(
									(await deps.releases.latestRelease(bookId)) ?? (await latestPublish(book))
								),
								productId: await earlyAccessProduct(user, book)
							}
						: null;
			}
			if (changes.cover === null) {
				await files.remove(`cover:${bookId}`);
				next.coverFile = null;
			} else if (changes.cover) {
				if (changes.cover.size > MAX_IMAGE_BYTES) {
					throw new BackendError('UPLOAD_TOO_LARGE', 'Covers can be up to 25 MB.');
				}
				const bytes = new Uint8Array(await changes.cover.arrayBuffer());
				const type = sniffImage(bytes);
				if (!type)
					throw validation('That file isn’t a picture we can show (use JPEG, PNG or WebP).');
				await files.remove(`cover:${bookId}`);
				const path = `cover.${extensionOf(type)}`;
				await files.put(`cover:${bookId}`, path, bytes, type);
				next.coverFile = { store: 'layerFiles', id: `cover:${bookId}`, path };
			}
			await db.put('books', next);
			await setPrice('book', bookId, changes.price);
			deps.changed('studio', 'catalogue');
			return detail(next);
		},

		async publishRevision(bookId, input) {
			const { book } = await ownBook(bookId);
			await requireActive();
			const record = await db.get('revisions', input.revisionId);
			if (!record || record.bookId !== bookId) {
				throw new BackendError('NOT_FOUND', 'That version of the book isn’t here.');
			}
			const state = stateOf(record, book);
			if (state !== 'ready') {
				throw new BackendError(
					'CONFLICT',
					state === 'published'
						? 'That version is already published.'
						: 'Only a processed version can be published.'
				);
			}
			const problems = publishProblems({ state, aiUse: input.aiUse });
			if (problems.length) throw validation(problems.join(' '));
			const manifest = await content.manifestOf(record.id);
			// A Chapter still to come can't sit between Chapters readers have (P1-STU-06).
			const stuck = await deps.releases.stuck(book, manifest);
			if (stuck.length) {
				throw validation(
					`“${stuck[0]}” has a release time, but chapters after it are already out. Remove its time, so it comes out with this version, and publish again.`
				);
			}
			const now = clock.now().toISOString();
			const previousId =
				book.currentRevisionId ?? (book.epubUrl ? await content.currentRevisionId(book) : null);
			const previousManifest = previousId ? await content.manifestOf(previousId) : null;
			if (previousId) {
				const previous = await db.get('revisions', previousId);
				if (previous?.studio) {
					await db.put('revisions', {
						...previous,
						studio: { ...previous.studio, state: 'superseded' }
					});
				}
			}
			await db.put('revisions', {
				...record,
				studio: { ...record.studio!, state: 'published', publishedAt: now, aiUse: input.aiUse }
			});
			// Automatic Flags (§10.6): an upload burst or a detector score on unlabelled content holds it.
			const check = await deps.moderation.checkPublish({
				type: 'book',
				id: bookId,
				volumeTargetId: bookId,
				creatorId: book.creatorId,
				aiUse: input.aiUse,
				priceMinor: (await productOf('book', bookId))?.price.amountMinor ?? 0
			});
			const next: BookRecord = {
				...book,
				currentRevisionId: record.id,
				aiUse: input.aiUse,
				relabelRequired: false,
				lang: manifest.lang,
				listingState: check.hold
					? 'held'
					: book.listingState === 'draft'
						? 'listed'
						: book.listingState
			};
			await db.put('books', next);
			await moveLayers(next, record.id);
			// Recaps and glossary find their names in the new text (P1-STU-05 acceptance).
			await deps.story.moveTo(bookId, record.id);
			if (check.hold) await heldNotice(book.creatorId, 'book', bookId, book.title);
			// New Chapters come out now or when scheduled, and restart early access (P1-STU-06).
			await deps.releases.published(next, previousManifest, manifest);
			deps.changed('studio', 'catalogue');
			return detail(next);
		},

		async scheduleChapter(bookId, input) {
			const { book } = await ownBook(bookId);
			await requireActive();
			await deps.releases.refresh();
			const currentId =
				book.currentRevisionId ?? (book.epubUrl ? await content.currentRevisionId(book) : null);
			const current = currentId ? await content.manifestOf(currentId) : null;
			if (current?.chapters.some((c) => c.chapterId === input.chapterId)) {
				await deps.releases.schedule(book, current, true, input.chapterId, input.releaseAt);
				return detail(book);
			}
			// A Chapter only in an uploaded version: its newest processed one.
			for (const record of await revisionsOf(book)) {
				if (stateOf(record, book) !== 'ready') continue;
				const manifest = await content.manifestOf(record.id);
				if (!manifest.chapters.some((c) => c.chapterId === input.chapterId)) continue;
				await deps.releases.schedule(book, manifest, false, input.chapterId, input.releaseAt);
				return detail(book);
			}
			throw new BackendError('NOT_FOUND', 'That chapter isn’t in this book.');
		},

		async previewRevision(bookId, revisionId): Promise<OpenBookDto> {
			const user = requireCreator();
			const book = await db.get('books', bookId);
			if (!book) throw new BackendError('NOT_FOUND', 'That book isn’t in your Studio.');
			if (book.creatorId !== user.creatorId) {
				// A community Creator building a Layer for this Book sees the version readers see.
				const layers = [
					...(await db.getAllFromIndex('illustrationPacks', 'bookId', bookId)),
					...(await db.getAllFromIndex('audioTracks', 'bookId', bookId))
				];
				const current = await content.currentRevisionId(book);
				if (
					!layers.some((l) => l.creatorId === user.creatorId) ||
					(revisionId && revisionId !== current)
				) {
					throw new BackendError('FORBIDDEN', 'That isn’t one of your books.');
				}
				revisionId = current;
			}
			const records = await revisionsOf(book);
			const record = revisionId
				? records.find((r) => r.id === revisionId)
				: records.find((r) => !['processing', 'failed'].includes(stateOf(r, book)));
			if (!record) throw new BackendError('NOT_FOUND', 'That version of the book isn’t here.');
			if (['processing', 'failed'].includes(stateOf(record, book))) {
				throw new BackendError('CONFLICT', 'That version hasn’t been processed.');
			}
			const creator = await db.get('creators', book.creatorId);
			const { token, expiresAt } = content.grantRevision(bookId, record.id);
			return {
				bookId,
				slug: book.slug,
				revisionId: record.id,
				title: book.title,
				creatorName: creator?.displayName ?? '',
				lang: book.lang,
				contentToken: token,
				expiresAt: new Date(expiresAt).toISOString(),
				access: 'full',
				locked: []
			};
		},

		// ---- packs ----

		async createPack(bookId, details) {
			const { user, book, community } = await bookForLayer(bookId);
			const revisionId = community
				? await content.currentRevisionId(book)
				: await workingRevisionId(book);
			const id = newId('pack');
			const pack: IllustrationPackRecord = {
				id,
				bookId,
				creatorId: user.creatorId,
				name: details.name ?? 'Illustrations',
				description: details.description ?? '',
				isOfficial: !community,
				aiUse: details.aiUse ?? null,
				credit: details.credit ?? user.displayName,
				packUrl: studioUrl(id, 'pack.json'),
				illustrationCount: 0,
				listingState: 'draft',
				relabelRequired: false,
				endorsed: false,
				authorApproved: false,
				contentRating: book.contentRating
			};
			await putJson(id, 'draft.json', { revisionId, illustrations: [] } satisfies DraftPack);
			await db.put('illustrationPacks', pack);
			await createProduct(user, {
				id: `product-${id}`,
				kind: 'illustration_pack',
				refId: id,
				bookId,
				creatorId: user.creatorId,
				isOfficial: !community,
				price: details.price ?? money(0, CURRENCY)
			});
			deps.changed('studio');
			return packDto(pack);
		},

		async getPack(packId) {
			const { pack } = await ownPack(packId);
			return packDto(pack);
		},

		async updatePack(packId, details) {
			const { pack } = await ownPack(packId);
			const next = await withDetails('illustration_pack', pack, details);
			const saved = await saveDraft(next, await draftOf(packId));
			deps.changed('studio', 'catalogue');
			return packDto(saved);
		},

		async addIllustration(packId, input) {
			const { pack } = await ownPack(packId);
			const draft = await draftOf(packId);
			checkAnchor(input.anchor, pack, draft);
			const id = newId('ill');
			const illustration: DraftIllustrationDto = {
				id,
				anchor: input.anchor,
				placement: input.placement,
				span: input.span,
				alt: input.alt,
				...(input.caption ? { caption: input.caption } : {}),
				...(input.credit ? { credit: input.credit } : {}),
				spoilerSafe: input.spoilerSafe,
				image: await storeImage(packId, id, input.image),
				anchorStatus: 'ok'
			};
			try {
				const saved = await saveDraft(pack, {
					...draft,
					illustrations: [...draft.illustrations, illustration]
				});
				deps.changed('studio', 'catalogue');
				return packDto(saved);
			} catch (error) {
				await removeImages(packId, illustration);
				throw error;
			}
		},

		async updateIllustration(packId, illustrationId, changes) {
			const { pack } = await ownPack(packId);
			const draft = await draftOf(packId);
			const old = draft.illustrations.find((i) => i.id === illustrationId);
			if (!old) throw new BackendError('NOT_FOUND', 'That picture isn’t in this pack.');
			if (changes.anchor) checkAnchor(changes.anchor, pack, draft);
			const { image, anchor, ...rest } = changes;
			const updated: DraftIllustrationDto = {
				...old,
				...rest,
				...(anchor ? { anchor, anchorStatus: 'ok' as const } : {}),
				...(image
					? { image: await storeImage(packId, `${illustrationId}-${Date.now()}`, image) }
					: {})
			};
			const saved = await saveDraft(pack, {
				...draft,
				illustrations: draft.illustrations.map((i) => (i.id === illustrationId ? updated : i))
			});
			if (image) await removeImages(packId, old);
			deps.changed('studio', 'catalogue');
			return packDto(saved);
		},

		async removeIllustration(packId, illustrationId) {
			const { pack } = await ownPack(packId);
			const draft = await draftOf(packId);
			const old = draft.illustrations.find((i) => i.id === illustrationId);
			if (!old) throw new BackendError('NOT_FOUND', 'That picture isn’t in this pack.');
			const saved = await saveDraft(pack, {
				...draft,
				illustrations: draft.illustrations.filter((i) => i.id !== illustrationId)
			});
			await removeImages(packId, old);
			deps.changed('studio', 'catalogue');
			return packDto(saved);
		},

		async publishPack(packId) {
			const { pack } = await ownPack(packId);
			const draft = await draftOf(packId);
			const problems = packProblems(pack, draft);
			if (problems.length) throw validation(problems.join(' '), { problems });
			const state = await submit('illustration_pack', pack, draft.illustrations.length);
			const saved = await saveDraft({ ...pack, listingState: state }, draft);
			deps.changed('studio', 'catalogue', 'community');
			return packDto(saved);
		},

		// ---- narration ----

		async createTrack(bookId, details) {
			const { user, book, community } = await bookForLayer(bookId);
			const revisionId = community
				? await content.currentRevisionId(book)
				: await workingRevisionId(book);
			const id = newId('track');
			const track: AudioTrackRecord = {
				id,
				bookId,
				creatorId: user.creatorId,
				name: details.name ?? 'Narration',
				description: details.description ?? '',
				narrator: details.narrator ?? user.displayName,
				isOfficial: !community,
				aiUse: details.aiUse ?? null,
				credit: details.credit ?? '',
				trackUrl: studioUrl(id, 'track.json'),
				chapterCount: 0,
				durationMs: 0,
				listingState: 'draft',
				relabelRequired: false,
				endorsed: false,
				authorApproved: false,
				sample: null,
				staleChapterIds: [],
				reviewed: {}
			};
			await putJson(id, 'track.json', {
				version: 1,
				id,
				bookId,
				revisionId,
				chapters: []
			} satisfies AudioTrackFile);
			await db.put('audioTracks', track);
			await createProduct(user, {
				id: `product-${id}`,
				kind: 'audio_track',
				refId: id,
				bookId,
				creatorId: user.creatorId,
				isOfficial: !community,
				price: details.price ?? money(0, CURRENCY)
			});
			deps.changed('studio');
			return trackDto(track);
		},

		async getTrack(trackId) {
			const { track } = await ownTrack(trackId);
			return trackDto(track);
		},

		async updateTrack(trackId, details) {
			const { track } = await ownTrack(trackId);
			const next = await withDetails('audio_track', track, details);
			if (next.listingState === 'listed' && !next.aiUse) {
				throw validation('Answer “Was AI used to make this?” first.');
			}
			await db.put('audioTracks', next);
			deps.changed('studio', 'catalogue');
			return trackDto(next);
		},

		async setChapterNarration(trackId, input) {
			const { track } = await ownTrack(trackId);
			const file = await trackFile(track);
			const manifest = await content.manifestOf(file.revisionId);
			const chapter = manifest.chapters.find(
				(c) => c.chapterId === input.chapterId && c.wordCount > 0
			);
			if (!chapter) {
				throw new BackendError('NOT_FOUND', 'That chapter isn’t in this version of the book.');
			}
			let map: SyncMap;
			try {
				map = parseSyncMap(input.syncMap);
			} catch {
				throw validation('That file isn’t a Sync Map from tools/align (DESIGN.md §7.2).');
			}
			const wordIds = (await chapterWords(file.revisionId)).get(chapter.chapterId) ?? [];
			const problems = syncMapProblems(map, {
				revisionId: file.revisionId,
				chapterId: chapter.chapterId,
				wordIds: new Set(wordIds)
			});
			if (problems.length) throw validation(problems.join(' '), { problems });
			if (input.audio.size > MAX_AUDIO_BYTES) {
				throw new BackendError('UPLOAD_TOO_LARGE', 'Audio files can be up to 1 GB.');
			}
			const audio = new Uint8Array(await input.audio.arrayBuffer());
			const kind = sniffAudio(audio);
			if (!kind)
				throw validation('That audio isn’t a file we can play (use M4A, MP3, WAV or Ogg).');
			const key = encodeURIComponent(chapter.chapterId);
			const previous = file.chapters.find((c) => c.chapterId === chapter.chapterId);
			if (previous) await files.remove(trackId, parseStudioUrl(previous.audio)?.path ?? '');
			const audioPath = `audio/${key}.${kind.ext}`;
			const syncPath = `sync/${key}.json`;
			await files.put(trackId, audioPath, audio, kind.type);
			const coverage = coverageOf(map.words, wordIds.length);
			await putJson(trackId, syncPath, {
				...map,
				trackId,
				audioKey: `tracks/${trackId}/${audioPath}`,
				coverage
			} satisfies SyncMap);
			const order = new Map(manifest.chapters.map((c, i) => [c.chapterId, i]));
			const chapters = [
				...file.chapters.filter((c) => c.chapterId !== chapter.chapterId),
				{
					chapterId: chapter.chapterId,
					syncMap: syncPath,
					audio: studioUrl(trackId, audioPath),
					durationMs: map.durationMs,
					coverage
				}
			].sort((a, b) => (order.get(a.chapterId) ?? 0) - (order.get(b.chapterId) ?? 0));
			await putJson(trackId, 'track.json', { ...file, chapters } satisfies AudioTrackFile);
			// A new recording needs reviewing afresh.
			const reviewed = { ...track.reviewed };
			delete reviewed[chapter.chapterId];
			const next: AudioTrackRecord = {
				...track,
				chapterCount: chapters.length,
				durationMs: chapters.reduce((sum, c) => sum + c.durationMs, 0),
				staleChapterIds: track.staleChapterIds.filter((id) => id !== chapter.chapterId),
				reviewed
			};
			await db.put('audioTracks', next);
			deps.changed('studio', 'catalogue');
			return trackDto(next);
		},

		async reviewChapter(trackId, chapterId) {
			const { track } = await ownTrack(trackId);
			return review(track, chapterId);
		},

		async markReviewed(trackId, chapterId, regionIndex, reviewed) {
			const { track } = await ownTrack(trackId);
			const current = await review(track, chapterId);
			if (!current.regions.some((r) => r.index === regionIndex)) {
				throw new BackendError('NOT_FOUND', 'That part of the chapter isn’t marked for review.');
			}
			const set = new Set(track.reviewed[chapterId] ?? []);
			if (reviewed) set.add(regionIndex);
			else set.delete(regionIndex);
			const next = {
				...track,
				reviewed: { ...track.reviewed, [chapterId]: [...set].sort((a, b) => a - b) }
			};
			await db.put('audioTracks', next);
			deps.changed('studio');
			return review(next, chapterId);
		},

		async publishTrack(trackId) {
			const { track } = await ownTrack(trackId);
			const file = await trackFile(track);
			const problems = layerPublishProblems({
				aiUse: track.aiUse,
				items: file.chapters.length,
				itemName: { one: 'chapter', many: 'chapters' }
			});
			if (problems.length) throw validation(problems.join(' '), { problems });
			const state = await submit('audio_track', track, file.chapters.length);
			const next: AudioTrackRecord = { ...track, listingState: state };
			await db.put('audioTracks', next);
			deps.changed('studio', 'catalogue', 'community');
			return trackDto(next);
		},

		// ---- plans and earnings ----

		async listPlans() {
			const user = requireCreator();
			const plans = await db.getAllFromIndex('plans', 'creatorId', user.creatorId);
			return Promise.all(plans.map((p) => deps.support.planDto(p)));
		},

		async savePlan(planId, input): Promise<PlanDto> {
			const user = requireCreator();
			const existing = planId ? await db.get('plans', planId) : undefined;
			if (planId && !existing) throw new BackendError('NOT_FOUND', 'That plan isn’t yours.');
			if (existing && existing.creatorId !== user.creatorId) {
				throw new BackendError('FORBIDDEN', 'That plan isn’t yours.');
			}
			const benefits: PlanRecord['benefits'] = [];
			for (const bookId of input.earlyAccessBookIds) {
				const book = await db.get('books', bookId);
				if (!book || book.creatorId !== user.creatorId || !book.isSerial) {
					throw validation('Early access works only for your own serials.');
				}
				benefits.push({
					kind: 'early_access',
					bookId,
					productId: await earlyAccessProduct(user, book),
					description: `Early access to the newest chapters of ${book.title}`
				});
			}
			const plan: PlanRecord = {
				id: existing?.id ?? newId('plan'),
				creatorId: user.creatorId,
				name: input.name,
				description: input.description,
				price: input.price,
				benefits
			};
			await db.put('plans', plan);
			deps.changed('studio', 'support', 'catalogue');
			return deps.support.planDto(plan);
		},

		async earnings(): Promise<EarningsDto> {
			const user = requireCreator();
			const mine = user.creatorId;
			const [products, books, orders, tips, subscriptions, plans] = await Promise.all([
				db.getAll('products'),
				db.getAll('books'),
				db.getAll('orders'),
				db.getAll('tips'),
				db.getAll('subscriptions'),
				db.getAllFromIndex('plans', 'creatorId', mine)
			]);
			const product = new Map(products.map((p) => [p.id, p]));
			const authorOf = new Map(books.map((b) => [b.id, b.creatorId]));
			const titleOf = new Map(books.map((b) => [b.id, b.title]));
			type Line = { kind: EarningsDto['lines'][number]['kind']; label: string; splits: Split[] };
			const lines = new Map<string, Line>();
			const add = (key: string, kind: Line['kind'], label: string, split: Split) => {
				const line = lines.get(key) ?? { kind, label, splits: [] };
				line.splits.push(split);
				lines.set(key, line);
			};
			const gbp = (amountMinor: number) => money(amountMinor, CURRENCY);
			// As this Creator: their share is `creator`, or `author` on another's community Layer.
			const view = (split: Split, yours: 'creator' | 'author'): Split => ({
				...split,
				creator: yours === 'creator' ? split.creator : split.author,
				author: yours === 'creator' ? split.author : split.creator
			});

			for (const order of orders) {
				const p = product.get(order.productId);
				if (order.status !== 'paid' || order.currency !== CURRENCY || !p) continue;
				const community = !p.isOfficial;
				const author = p.bookId ? authorOf.get(p.bookId) : undefined;
				if (p.creatorId !== mine && !(community && author === mine)) continue;
				const split = splitRevenue(gbp(order.totalMinor), community ? 'community_sale' : 'sale');
				const label =
					p.kind === 'bundle'
						? `Complete edition: ${titleOf.get(p.bookId ?? '') ?? ''}`
						: p.kind === 'book'
							? (titleOf.get(p.refId) ?? 'A book')
							: p.kind === 'illustration_pack'
								? ((await db.get('illustrationPacks', p.refId))?.name ?? 'An illustration pack')
								: p.kind === 'audio_track'
									? ((await db.get('audioTracks', p.refId))?.name ?? 'A narration')
									: p.kind === 'bookmark_design'
										? ((await db.get('bookmarkDesigns', p.refId))?.name ?? 'A bookmark design')
										: p.refId;
				add(p.id, 'sales', label, view(split, p.creatorId === mine ? 'creator' : 'author'));
			}
			for (const tip of tips) {
				if (tip.creatorId !== mine || tip.currency !== CURRENCY) continue;
				add('tips', 'tips', 'Tips', splitRevenue(gbp(tip.amountMinor), 'tip'));
			}
			const planIds = new Set(plans.map((p) => p.id));
			const subscribers = new Set(
				subscriptions.filter((s) => planIds.has(s.planId)).map((s) => s.userId)
			);
			// Renewals follow the dev clock, as a server's billing job would (P1-STO-04).
			for (const userId of subscribers) await deps.support.refresh(userId);
			let active = 0;
			for (const sub of await db.getAll('subscriptions')) {
				const plan = plans.find((p) => p.id === sub.planId);
				if (!plan || plan.price.currency !== CURRENCY) continue;
				if (sub.status !== 'ended') active++;
				for (let i = 0; i < sub.payments; i++) {
					add(plan.id, 'subscriptions', plan.name, splitRevenue(plan.price, 'subscription'));
				}
			}
			const toDto = (split: Split) => ({
				gross: split.gross,
				platform: split.platform,
				yours: split.creator,
				others: split.author
			});
			const all = [...lines.values()];
			return {
				simulated: true,
				currency: CURRENCY,
				splitNotes: Object.values(PLACEHOLDER_SPLITS).map((r) => r.note),
				total: toDto(
					addSplits(
						all.flatMap((l) => l.splits),
						CURRENCY
					)
				),
				lines: all
					.map((l) => ({
						kind: l.kind,
						label: l.label,
						count: l.splits.length,
						split: toDto(addSplits(l.splits, CURRENCY))
					}))
					.sort((a, b) => b.split.gross.amountMinor - a.split.gross.amountMinor),
				activeSubscribers: active
			};
		},

		// ---- community work and curation ----

		async listLayers() {
			const user = requireCreator();
			const mine = [
				...(await db.getAll('illustrationPacks')),
				...(await db.getAll('audioTracks'))
			].filter(
				(l) =>
					l.creatorId === user.creatorId && parseStudioUrl('packUrl' in l ? l.packUrl : l.trackUrl)
			);
			const out: StudioLayerDto[] = [];
			for (const layer of mine) {
				const book = await db.get('books', layer.bookId);
				out.push({
					id: layer.id,
					kind: layerKind(layer),
					name: layer.name,
					bookId: layer.bookId,
					bookTitle: book?.title ?? '',
					community: book?.creatorId !== user.creatorId,
					state: layer.listingState,
					relabelRequired: layer.relabelRequired
				});
			}
			return out.sort(
				(a, b) => a.bookTitle.localeCompare(b.bookTitle) || a.name.localeCompare(b.name)
			);
		},

		async curation(bookId) {
			const { book } = await ownBook(bookId);
			return curationOf(book);
		},

		async decide(layerId, decision, reason) {
			const { layer, book } = await communityLayer(layerId);
			if (layer.listingState !== 'pending') {
				throw new BackendError('CONFLICT', 'It isn’t waiting for your approval.');
			}
			const approve = decision === 'approve';
			await saveLayer({
				...layer,
				authorApproved: approve,
				listingState: approve ? 'listed' : 'declined'
			});
			await deps.inbox.notify(
				{ creatorId: layer.creatorId },
				{
					title: approve ? `“${layer.name}” is listed` : `“${layer.name}” wasn’t accepted`,
					body: approve
						? `The author of “${book.title}” approved it. ${reason}`.trim()
						: `The author of “${book.title}” declined it. ${reason || 'They didn’t give a reason.'}`,
					about: { type: layerKind(layer), id: layer.id }
				}
			);
			deps.changed('studio', 'catalogue', 'community');
			return curationOf(book);
		},

		async endorse(layerId, endorsed) {
			const { layer, book } = await communityLayer(layerId);
			await saveLayer({ ...layer, endorsed });
			if (endorsed && !layer.endorsed) {
				await deps.inbox.notify(
					{ creatorId: layer.creatorId },
					{
						title: `The author endorsed “${layer.name}”`,
						body: `It now shows as Author-endorsed on “${book.title}”, first in its community hub.`,
						about: { type: layerKind(layer), id: layer.id }
					}
				);
			}
			deps.changed('studio', 'catalogue', 'community');
			return curationOf(book);
		},

		// ---- the story so far (P1-STU-05) ----

		async getStory(bookId) {
			const { book } = await ownBook(bookId);
			return deps.story.studio(book, await workingRevisionId(book));
		},

		async saveRecap(bookId, input) {
			const { book } = await ownBook(bookId);
			return deps.story.saveRecap(book, await workingRevisionId(book), input);
		},

		async saveGlossaryEntry(bookId, entryId, input) {
			const { book } = await ownBook(bookId);
			return deps.story.saveEntry(book, await workingRevisionId(book), entryId, input);
		},

		async removeGlossaryEntry(bookId, entryId) {
			const { book } = await ownBook(bookId);
			return deps.story.removeEntry(book, await workingRevisionId(book), entryId);
		},

		async publishStory(bookId, input) {
			const { book } = await ownBook(bookId);
			await requireActive();
			return deps.story.publish(book, await workingRevisionId(book), input?.aiUse);
		},

		async setCommunityListing(layerId, listed) {
			const { layer, book } = await communityLayer(layerId);
			const from = listed ? 'delisted' : 'listed';
			if (layer.listingState !== from) {
				throw new BackendError('CONFLICT', listed ? 'It isn’t hidden.' : 'It isn’t listed.');
			}
			await saveLayer({ ...layer, listingState: listed ? 'listed' : 'delisted' });
			await deps.inbox.notify(
				{ creatorId: layer.creatorId },
				{
					title: listed
						? `“${layer.name}” is listed again`
						: `The author of “${book.title}” hid “${layer.name}”`,
					body: listed
						? `Readers can find it in the community hub for “${book.title}” again.`
						: 'Readers who have it keep it, but it’s no longer in the store.',
					about: { type: layerKind(layer), id: layer.id }
				}
			);
			deps.changed('studio', 'catalogue', 'community');
			return curationOf(book);
		}
	};
}
