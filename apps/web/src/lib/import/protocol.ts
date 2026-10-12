import type { Anchor, IngestFailureCode, PointAnchor } from '@book/core';
import type { IngestResult, Migrated } from '@book/text-pipeline';

/** A new version of a Book already here: its current Revision, and what's attached to it. */
export interface PreviousRevisionRequest {
	/** The current Revision's text files by path (manifest, word indexes, chapters). */
	files: Record<string, string>;
	/** Annotations' and Placed Bookmarks' Anchors on that Revision, to migrate (§6.2). */
	anchors: Anchor[];
	/** Reading Progress on that Revision (current, then furthest), to migrate. */
	progress: PointAnchor[];
}

export interface WorkerRequest {
	id: number;
	bytes: ArrayBuffer;
	bookId?: string;
	firstWordId?: number;
	/** Used when the EPUB has no dc:identifier. */
	newBookId?: string;
	previous?: PreviousRevisionRequest;
}

export interface MigrationResult {
	anchors: Migrated<Anchor>[];
	progress: (Migrated<PointAnchor> | null)[];
}

export type WorkerResponse =
	| { id: number; type: 'progress'; done: number; total: number }
	| { id: number; type: 'done'; result: IngestResult; migration?: MigrationResult }
	| { id: number; type: 'error'; code: IngestFailureCode | null; message: string };
