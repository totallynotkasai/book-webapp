/**
 * The content work the simulated backend asks for (DESIGN.md §7.1, §6.2), the same code the
 * Phase 2 worker will run: process an EPUB (carrying WordIds forward from the Book's current
 * Revision), migrate Anchors to a new Revision, and read a Revision's Words. The app runs it in
 * a Web Worker (§5.4); tests and the default run it in this thread.
 */
import type { Anchor, AnchorStatus, IngestReport, PointAnchor, RevisionManifest } from '@book/core';

/** What processing an EPUB yields: the same files text-pipeline writes (§6.7). */
export interface ProcessedRevision {
	revisionId: string;
	manifest: RevisionManifest;
	report: IngestReport;
	files: { path: string; mediaType: string; data: Uint8Array }[];
}

/** A Revision's text files by path (manifest, Chapters, word indexes). */
export type RevisionText = Record<string, string>;

export interface Migrated<A extends Anchor> {
	anchor: A;
	status: AnchorStatus;
}

export interface Pipeline {
	ingest(
		bytes: Uint8Array,
		options: { bookId: string; firstWordId?: number; previous?: RevisionText }
	): Promise<ProcessedRevision>;
	migrate(input: {
		before: RevisionText;
		after: RevisionText;
		anchors: Anchor[];
		progress: PointAnchor[];
	}): Promise<{ anchors: Migrated<Anchor>[]; progress: (Migrated<PointAnchor> | null)[] }>;
	/** Each Chapter's Words: IDs and their text, in reading order. */
	words(
		revision: RevisionText
	): Promise<{ chapterId: string; wordIds: number[]; texts: string[] }[]>;
	/** Gets ready for a job that's coming (the app starts its worker), so it loads meanwhile. */
	warm?(): void;
}

/** The thread-local default: text-pipeline, loaded only when first needed. */
export const inThreadPipeline: Pipeline = {
	async ingest(bytes, { bookId, firstWordId, previous }) {
		const { ingestEpub, readRevisionWords } = await import('@book/text-pipeline');
		return ingestEpub(bytes, {
			bookId,
			firstWordId,
			previous: previous ? readRevisionWords((path) => previous[path]) : undefined
		});
	},

	async migrate({ before, after, anchors, progress }) {
		const { migrateAnchors, migrateProgress, readRevisionWords } =
			await import('@book/text-pipeline');
		const from = readRevisionWords((path) => before[path]);
		const to = readRevisionWords((path) => after[path]);
		return {
			anchors: migrateAnchors(anchors, from, to),
			progress: progress.map((point) => migrateProgress(point, from, to))
		};
	},

	async words(revision) {
		const { readRevisionWords } = await import('@book/text-pipeline');
		return readRevisionWords((path) => revision[path]).chapters.map((c) => ({
			chapterId: c.chapterId,
			wordIds: c.wordIds,
			texts: c.texts
		}));
	}
};
