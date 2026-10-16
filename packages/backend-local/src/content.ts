/**
 * `Backend.content` in the browser (P1-APP-03, DESIGN.md §10.3). Opening checks Entitlements
 * through `@book/domain` (Invariant 15), processes the seeded EPUB with text-pipeline on first open
 * (cached per Revision, as the Phase 2 worker would), and issues a short-lived content token.
 * Reading a file needs a live token for that Revision (Invariant 16, simulated).
 *
 * A reader who doesn't own a Book may open its sample (P1-STO-01); an owner can't open a
 * serial's early-access Chapters without the author's subscription (P1-STO-04). Locked
 * Chapters are listed in the result and their files refused under the token.
 *
 * A Book's current Revision is the one its author last published in the Studio (P1-STU-01) or,
 * until then, the one processed from its seeded EPUB. Readers' Anchors on an older Revision are
 * moved to it by `migrateAnchors` when they next open the Book (§6.2).
 */
import {
	BackendError,
	revisionManifestSchema,
	revisionPaths,
	type Clock,
	type ContentApi,
	type LockedChapterDto,
	type OpenBookDto,
	type RevisionManifest,
	type UserDto
} from '@book/core';
import { earlyAccessChapterIds, hasEntitlement, sampleChapterIds } from '@book/domain';
import type { BackendDatabase, RevisionRecord } from './db';
import type { StoredFiles } from './files';
import type { Pipeline, ProcessedRevision } from './pipeline';
import type { BookRecord } from './seed';
import type { StoryModule } from './story';

/** Tokens last an hour (§10.3). */
export const CONTENT_TOKEN_MS = 60 * 60 * 1000;

/**
 * What a content token opens: one Book Revision's files (less any locked Chapters), or one
 * Layer's files (an Illustration Pack's images, an Audio Track's Sync Maps, a store page's
 * previews).
 */
type Grant =
	| {
			kind: 'revision';
			userId: string;
			bookId: string;
			revisionId: string;
			expiresAt: number;
			/** Files of locked Chapters, refused under this token. */
			locked: Set<string>;
	  }
	| {
			kind: 'layer';
			userId: string;
			layerId: string;
			baseUrl: string;
			expiresAt: number;
			/** When set, only these files. */
			only?: Set<string>;
			/** When set, each readable path and where it's loaded from (files from several Layers). */
			files?: Map<string, string>;
	  };

/** A grant before it's issued: who it's for and when it ends are added then. */
type GrantRequest = Grant extends infer G
	? G extends Grant
		? Omit<G, 'userId' | 'expiresAt'>
		: never
	: never;

const MEDIA_TYPES: Record<string, string> = {
	webp: 'image/webp',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	json: 'application/json',
	m4a: 'audio/mp4'
};

/** `ContentApi` plus what `layers` and `studio` need: tokens and Revisions. */
export interface ContentModule extends ContentApi {
	grantLayer(
		layerId: string,
		baseUrl: string,
		only?: string[]
	): { token: string; expiresAt: number };
	/** A token for files gathered from several Layers: readable path → where it's loaded from. */
	grantLayerFiles(
		layerId: string,
		files: Map<string, string>
	): { token: string; expiresAt: number };
	/** A token for one Revision's files, for a Creator's preview (P1-STU-01). */
	grantRevision(bookId: string, revisionId: string): { token: string; expiresAt: number };
	/** The Revision readers open now, processing a seeded Book's EPUB first if need be. */
	currentRevisionId(book: BookRecord): Promise<string>;
	/** Stores a processed Revision's files and record. */
	saveRevision(
		bookId: string,
		processed: ProcessedRevision,
		studio?: RevisionRecord['studio']
	): Promise<void>;
	manifestOf(revisionId: string): Promise<RevisionManifest>;
}

export function createContentApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requireUser: () => UserDto;
	loadFile: (url: string) => Promise<Uint8Array>;
	pipeline: Pipeline;
	files: StoredFiles;
	/** Brings subscriptions up to date before early access is checked (P1-STO-04). */
	beforeAccess?: (userId: string) => Promise<void>;
	/** Recaps and glossaries (P1-RDR-13). */
	story?: Pick<StoryModule, 'forReader'>;
}): ContentModule {
	const { db, clock } = deps;
	const grants = new Map<string, Grant>();
	const processing = new Map<string, Promise<string>>();

	async function saveRevision(
		bookId: string,
		result: ProcessedRevision,
		studio?: RevisionRecord['studio']
	) {
		const tx = db.transaction(['content', 'revisions', 'books'], 'readwrite');
		for (const file of result.files) {
			await tx.objectStore('content').put({
				revisionId: result.revisionId,
				path: file.path,
				type: file.mediaType,
				bytes: file.data.slice().buffer as ArrayBuffer
			});
		}
		await tx.objectStore('revisions').put({
			id: result.revisionId,
			bookId,
			processedAt: clock.now().toISOString(),
			report: result.report,
			...(studio ? { studio } : {})
		});
		// The counter only grows, so no WordId is ever given out twice (Invariant 3).
		const book = await tx.objectStore('books').get(bookId);
		if (book && book.nextWordId < result.manifest.nextWordId) {
			await tx.objectStore('books').put({ ...book, nextWordId: result.manifest.nextWordId });
		}
		await tx.done;
	}

	/** The seeded Book's processed Revision, processing its EPUB first if needed. */
	function revisionOf(bookId: string, epubUrl: string): Promise<string> {
		let pending = processing.get(bookId);
		if (!pending) {
			pending = (async () => {
				const existing = await db.getAllFromIndex('revisions', 'bookId', bookId);
				const seeded = existing.find((r) => !r.studio);
				if (seeded) return seeded.id;
				// The pipeline starts up while the EPUB downloads (P1-QA-01: the cold open).
				deps.pipeline.warm?.();
				const bytes = await deps.loadFile(epubUrl);
				const result = await deps.pipeline.ingest(bytes, { bookId });
				await saveRevision(bookId, result);
				return result.revisionId;
			})();
			// A failure isn't cached: the next open tries again.
			pending.catch(() => processing.delete(bookId));
			processing.set(bookId, pending);
		}
		return pending;
	}

	async function currentRevisionId(book: BookRecord): Promise<string> {
		if (book.currentRevisionId) return book.currentRevisionId;
		if (!book.epubUrl) throw new BackendError('NOT_FOUND', 'This book has no text yet.');
		try {
			return await revisionOf(book.id, book.epubUrl);
		} catch (error) {
			throw new BackendError(
				'INGEST_FAILED',
				'This book couldn’t be prepared for reading.',
				String(error)
			);
		}
	}

	async function manifestOf(revisionId: string): Promise<RevisionManifest> {
		const file = await db.get('content', [revisionId, revisionPaths.manifest]);
		if (!file) throw new BackendError('SERVER_ERROR', 'This book’s manifest is missing.');
		return revisionManifestSchema.parse(JSON.parse(new TextDecoder().decode(file.bytes)));
	}

	/** A Chapter's files: its XHTML and its word index. */
	function filesOf(manifest: RevisionManifest, chapterIds: Set<string>): Set<string> {
		const files = new Set<string>();
		for (const c of manifest.chapters) {
			if (!chapterIds.has(c.chapterId)) continue;
			files.add(revisionPaths.chapter(c.href));
			files.add(revisionPaths.wordIndex(c.chapterId));
		}
		return files;
	}

	/** Which Chapters this reader can't open: the rest of a sample, or early access. */
	async function lockedFor(
		book: BookRecord,
		manifest: RevisionManifest,
		owns: boolean,
		holds: (productId: string) => boolean
	): Promise<LockedChapterDto[]> {
		const creator = await db.get('creators', book.creatorId);
		const base = {
			creatorName: creator?.displayName ?? '',
			creatorHandle: creator?.handle ?? ''
		};
		if (!owns) {
			const sample = new Set(sampleChapterIds(manifest.chapters));
			return manifest.chapters
				.filter((c) => !sample.has(c.chapterId))
				.map((c) => ({
					chapterId: c.chapterId,
					reason: 'sample',
					freeAt: null,
					planId: null,
					...base
				}));
		}
		const early = book.earlyAccess;
		if (!early || clock.now().getTime() >= Date.parse(early.freeAt) || holds(early.productId)) {
			return [];
		}
		// SIMULATION (OPEN-10): the serial's newest Chapters wait for the author's subscribers.
		const plan = (await db.getAllFromIndex('plans', 'creatorId', book.creatorId)).find((p) =>
			p.benefits.some((b) => b.productId === early.productId)
		);
		return earlyAccessChapterIds(manifest.chapters, early.chapters).map((chapterId) => ({
			chapterId,
			reason: 'early_access',
			freeAt: early.freeAt,
			planId: plan?.id ?? null,
			...base
		}));
	}

	async function ownsBook(userId: string, bookId: string): Promise<boolean> {
		const product = (await db.getAll('products')).find(
			(p) => p.kind === 'book' && p.refId === bookId
		);
		if (!product) return false;
		const entitlements = await db.getAllFromIndex('entitlements', 'userId', userId);
		return hasEntitlement(entitlements, userId, product.id, clock.now());
	}

	function newToken(): string {
		const bytes = new Uint8Array(24);
		crypto.getRandomValues(bytes);
		return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	}

	function grant(value: GrantRequest): { token: string; expiresAt: number } {
		const user = deps.requireUser();
		const token = newToken();
		const expiresAt = clock.now().getTime() + CONTENT_TOKEN_MS;
		grants.set(token, { ...value, userId: user.id, expiresAt } as Grant);
		return { token, expiresAt };
	}

	/**
	 * Who may read a Book (Invariant 15): its owners, and anyone reading the sample of a listed
	 * one. Rejects with `ENTITLEMENT_REQUIRED` otherwise.
	 */
	async function access(bookId: string, sample: boolean) {
		const user = deps.requireUser();
		const book = await db.get('books', bookId);
		if (!book) throw new BackendError('NOT_FOUND', 'That book isn’t in the store.');
		const product = (await db.getAll('products')).find(
			(p) => p.kind === 'book' && p.refId === bookId
		);
		await deps.beforeAccess?.(user.id);
		const entitlements = await db.getAllFromIndex('entitlements', 'userId', user.id);
		const holds = (productId: string) =>
			hasEntitlement(entitlements, user.id, productId, clock.now());
		const owns = !!product && holds(product.id);
		if (!owns && !(sample && book.listingState === 'listed')) {
			throw new BackendError('ENTITLEMENT_REQUIRED', 'This book isn’t in your library yet.', {
				bookId,
				slug: book.slug
			});
		}
		return { book, owns, holds };
	}

	return {
		async open(bookId, options): Promise<OpenBookDto> {
			const { book, owns, holds } = await access(bookId, !!options?.sample);
			const revisionId = await currentRevisionId(book);
			const creator = await db.get('creators', book.creatorId);
			const manifest = await manifestOf(revisionId);
			const locked = await lockedFor(book, manifest, owns, holds);
			const { token, expiresAt } = grant({
				kind: 'revision',
				bookId,
				revisionId,
				locked: filesOf(manifest, new Set(locked.map((l) => l.chapterId)))
			});
			return {
				bookId,
				slug: book.slug,
				revisionId,
				title: book.title,
				creatorName: creator?.displayName ?? '',
				lang: book.lang,
				contentToken: token,
				expiresAt: new Date(expiresAt).toISOString(),
				access: owns ? 'full' : 'sample',
				locked
			};
		},

		async read(contentToken, path) {
			const grant = grants.get(contentToken);
			if (!grant || grant.expiresAt <= clock.now().getTime()) {
				grants.delete(contentToken);
				throw new BackendError(
					'UNAUTHENTICATED',
					'Your reading session ended. Open the book again.'
				);
			}
			if (grant.kind === 'layer') {
				// Only files inside the Layer: no parent directories, no absolute paths.
				if (
					path.split('/').some((part) => part === '..' || part === '') ||
					/^[a-z]+:/i.test(path) ||
					(grant.only && !grant.only.has(path)) ||
					(grant.files && !grant.files.has(path))
				) {
					throw new BackendError('NOT_FOUND', `This layer has no file ${path}.`);
				}
				const type =
					MEDIA_TYPES[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
				try {
					const bytes = await deps.loadFile(grant.files?.get(path) ?? `${grant.baseUrl}/${path}`);
					return new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
				} catch {
					throw new BackendError('NOT_FOUND', `This layer has no file ${path}.`);
				}
			}
			if (grant.locked.has(path)) {
				throw new BackendError('ENTITLEMENT_REQUIRED', 'That chapter isn’t open to you yet.');
			}
			const file = await db.get('content', [grant.revisionId, path]);
			if (!file) throw new BackendError('NOT_FOUND', `This book has no file ${path}.`);
			return new Blob([file.bytes], { type: file.type });
		},

		async migrateAnchors(bookId, input) {
			const user = deps.requireUser();
			const book = await db.get('books', bookId);
			if (!book) throw new BackendError('NOT_FOUND', 'That book isn’t in the store.');
			if (!(await ownsBook(user.id, bookId))) {
				throw new BackendError('ENTITLEMENT_REQUIRED', 'This book isn’t in your library yet.', {
					bookId,
					slug: book.slug
				});
			}
			const revisionId = await currentRevisionId(book);
			const from = await db.get('revisions', input.fromRevisionId);
			if (input.fromRevisionId === revisionId || !from || from.bookId !== bookId) {
				// Already current, or a Revision this Book never had: nothing to move them by.
				const status = input.fromRevisionId === revisionId ? 'ok' : 'orphaned';
				return {
					revisionId,
					anchors: input.anchors.map((anchor) => ({ anchor, status })),
					progress: input.progress.map(() => null)
				};
			}
			const [before, after] = await Promise.all([
				deps.files.revisionText(input.fromRevisionId),
				deps.files.revisionText(revisionId)
			]);
			const migrated = await deps.pipeline.migrate({
				before,
				after,
				anchors: input.anchors,
				progress: input.progress
			});
			return { revisionId, ...migrated };
		},

		async storySoFar(bookId) {
			// A sample reader gets what their sample Chapters hold, like the sample itself.
			const { book, owns, holds } = await access(bookId, true);
			const revisionId = await currentRevisionId(book);
			const manifest = await manifestOf(revisionId);
			const locked = new Set(
				(await lockedFor(book, manifest, owns, holds)).map((l) => l.chapterId)
			);
			if (!deps.story) return null;
			return deps.story.forReader(book, revisionId, (chapterId) => !locked.has(chapterId));
		},

		grantLayer(layerId, baseUrl, only) {
			return grant({ kind: 'layer', layerId, baseUrl, only: only ? new Set(only) : undefined });
		},

		grantLayerFiles(layerId, files) {
			return grant({ kind: 'layer', layerId, baseUrl: '', files });
		},

		grantRevision(bookId, revisionId) {
			return grant({ kind: 'revision', bookId, revisionId, locked: new Set() });
		},

		currentRevisionId,
		saveRevision,
		manifestOf
	};
}
