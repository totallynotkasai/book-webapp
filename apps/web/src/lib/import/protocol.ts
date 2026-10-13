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

/** Process an EPUB (imports, catalogue Books, Studio uploads). */
export interface IngestMessage {
	op: 'ingest';
	id: number;
	bytes: ArrayBuffer;
	bookId?: string;
	firstWordId?: number;
	/** Used when the EPUB has no dc:identifier. */
	newBookId?: string;
	previous?: PreviousRevisionRequest;
}

/** Move Anchors from one Revision to another (§6.2): a Studio publish, a reader's next open. */
export interface MigrateMessage {
	op: 'migrate';
	id: number;
	before: Record<string, string>;
	after: Record<string, string>;
	anchors: Anchor[];
	progress: PointAnchor[];
}

/** Read a Revision's Words (IDs and text), e.g. for the narration review screen. */
export interface WordsMessage {
	op: 'words';
	id: number;
	revision: Record<string, string>;
}

export type WorkerRequest = IngestMessage | MigrateMessage | WordsMessage;

export interface MigrationResult {
	anchors: Migrated<Anchor>[];
	progress: (Migrated<PointAnchor> | null)[];
}

export interface ChapterWordTexts {
	chapterId: string;
	wordIds: number[];
	texts: string[];
}

export type WorkerResponse =
	| { id: number; type: 'progress'; done: number; total: number }
	| { id: number; type: 'done'; result: IngestResult; migration?: MigrationResult }
	| { id: number; type: 'migrated'; result: MigrationResult }
	| { id: number; type: 'words'; result: ChapterWordTexts[] }
	| { id: number; type: 'error'; code: IngestFailureCode | null; message: string };
