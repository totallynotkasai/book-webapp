/**
 * A processed Revision's Words, read back from its files (manifest, word indexes and chapter
 * XHTML): what WordId carry-forward diffs against and what `migrateAnchors` searches (§6.2).
 *
 * The chapter XHTML is tokenised again with the same deterministic rules (D-026) to get each
 * Word's text, and checked against the stored index, so a mismatch fails loudly rather than
 * re-anchoring onto the wrong Words.
 */
import {
	revisionManifestSchema,
	revisionPaths,
	wordIndexSchema,
	type RevisionManifest,
	type WordIndexEntry
} from '@book/core';
import { markChapter } from './chapter';
import { findFirst, localName, parseMarkup } from './dom';

export interface RevisionChapter {
	chapterId: string;
	firstOrdinal: number;
	wordIds: number[];
	/** Each Word's text, as on the page. */
	texts: string[];
	/** `[wordId, block, start, end]`, for exact quotes. */
	entries: WordIndexEntry[];
	blockTexts: string[];
}

export interface RevisionWords {
	bookId: string;
	revisionId: string;
	nextWordId: number;
	wordCount: number;
	chapters: RevisionChapter[];
}

/** Reads a Revision from its files; `read` returns a file's text by its path in the Revision. */
export function readRevisionWords(read: (path: string) => string | undefined): RevisionWords {
	const manifestText = read(revisionPaths.manifest);
	if (!manifestText) throw new Error('The Revision has no manifest.');
	const manifest: RevisionManifest = revisionManifestSchema.parse(JSON.parse(manifestText));
	const chapters: RevisionChapter[] = [];
	for (const record of manifest.chapters) {
		const indexText = read(revisionPaths.wordIndex(record.chapterId));
		const xhtml = read(revisionPaths.chapter(record.chapterId));
		if (!indexText || !xhtml) {
			throw new Error(`The Revision is missing files for ${record.chapterId}.`);
		}
		const index = wordIndexSchema.parse(JSON.parse(indexText));
		const body = findFirst(parseMarkup(xhtml), (el) => localName(el) === 'body');
		const marked = body
			? markChapter(body, 1)
			: { wordTexts: [] as string[], blockTexts: [] as string[] };
		const entries = index.words as WordIndexEntry[];
		if (marked.wordTexts.length !== entries.length) {
			throw new Error(
				`${record.chapterId} doesn’t match its word index (${marked.wordTexts.length} Words, ${entries.length} indexed).`
			);
		}
		chapters.push({
			chapterId: record.chapterId,
			firstOrdinal: record.firstOrdinal,
			wordIds: entries.map((e) => e[0]),
			texts: marked.wordTexts,
			entries,
			blockTexts: marked.blockTexts
		});
	}
	return {
		bookId: manifest.bookId,
		revisionId: manifest.revisionId,
		nextWordId: manifest.nextWordId,
		wordCount: manifest.wordCount,
		chapters
	};
}
