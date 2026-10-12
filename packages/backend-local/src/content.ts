/**
 * `Backend.content` in the browser (P1-APP-03, DESIGN.md §10.3). Opening checks Entitlements
 * through `@book/domain` (Invariant 15), processes the seeded EPUB with text-pipeline on first open
 * (cached per Revision, as the Phase 2 worker would), and issues a short-lived content token.
 * Reading a file needs a live token for that Revision (Invariant 16, simulated).
 */
import {
	BackendError,
	type Clock,
	type ContentApi,
	type OpenBookDto,
	type UserDto
} from '@book/core';
import { hasEntitlement } from '@book/domain';
import type { BackendDatabase } from './db';

/** What processing a catalogue EPUB yields: the same files text-pipeline writes (§6.7). */
export interface ProcessedRevision {
	revisionId: string;
	files: { path: string; mediaType: string; data: Uint8Array }[];
}

export type IngestFn = (
	bytes: Uint8Array,
	options: { bookId: string }
) => Promise<ProcessedRevision>;

/** Tokens last an hour (§10.3). */
export const CONTENT_TOKEN_MS = 60 * 60 * 1000;

interface Grant {
	userId: string;
	bookId: string;
	revisionId: string;
	expiresAt: number;
}

export function createContentApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requireUser: () => UserDto;
	loadFile: (url: string) => Promise<Uint8Array>;
	ingest: IngestFn;
}): ContentApi {
	const { db, clock } = deps;
	const grants = new Map<string, Grant>();
	const processing = new Map<string, Promise<string>>();

	/** The Book's processed Revision, processing it first if needed. */
	function revisionOf(bookId: string, epubUrl: string): Promise<string> {
		let pending = processing.get(bookId);
		if (!pending) {
			pending = (async () => {
				const existing = await db.getAllFromIndex('revisions', 'bookId', bookId);
				if (existing[0]) return existing[0].id;
				const bytes = await deps.loadFile(epubUrl);
				const result = await deps.ingest(bytes, { bookId });
				const tx = db.transaction(['content', 'revisions'], 'readwrite');
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
					processedAt: clock.now().toISOString()
				});
				await tx.done;
				return result.revisionId;
			})();
			// A failure isn't cached: the next open tries again.
			pending.catch(() => processing.delete(bookId));
			processing.set(bookId, pending);
		}
		return pending;
	}

	function newToken(): string {
		const bytes = new Uint8Array(24);
		crypto.getRandomValues(bytes);
		return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	}

	return {
		async open(bookId): Promise<OpenBookDto> {
			const user = deps.requireUser();
			const book = await db.get('books', bookId);
			if (!book) throw new BackendError('NOT_FOUND', 'That book isn’t in the store.');
			const product = (await db.getAll('products')).find(
				(p) => p.kind === 'book' && p.refId === bookId
			);
			const entitlements = await db.getAllFromIndex('entitlements', 'userId', user.id);
			if (!product || !hasEntitlement(entitlements, user.id, product.id, clock.now())) {
				throw new BackendError('ENTITLEMENT_REQUIRED', 'This book isn’t in your library yet.', {
					bookId,
					slug: book.slug
				});
			}
			if (!book.epubUrl) throw new BackendError('NOT_FOUND', 'This book has no text yet.');
			let revisionId: string;
			try {
				revisionId = await revisionOf(bookId, book.epubUrl);
			} catch (error) {
				throw new BackendError(
					'INGEST_FAILED',
					'This book couldn’t be prepared for reading.',
					String(error)
				);
			}
			const creator = await db.get('creators', book.creatorId);
			const token = newToken();
			const expiresAt = clock.now().getTime() + CONTENT_TOKEN_MS;
			grants.set(token, { userId: user.id, bookId, revisionId, expiresAt });
			return {
				bookId,
				revisionId,
				title: book.title,
				creatorName: creator?.displayName ?? '',
				lang: book.lang,
				contentToken: token,
				expiresAt: new Date(expiresAt).toISOString()
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
			const file = await db.get('content', [grant.revisionId, path]);
			if (!file) throw new BackendError('NOT_FOUND', `This book has no file ${path}.`);
			return new Blob([file.bytes], { type: file.type });
		}
	};
}
