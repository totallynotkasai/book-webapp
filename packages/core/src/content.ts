/**
 * Processed Book content (docs/DESIGN.md §6.7, §7.1; ADR-001, ADR-002): what `text-pipeline`
 * writes for a Revision and the reader reads back. Stored per Revision as files:
 *
 *   manifest.json                      RevisionManifest
 *   content/{chapterHref}              sanitised XHTML, Blocks marked with `data-b`
 *   index/{chapterId}.words.json       WordIndex for the Chapter
 *   res/{path}                         images, stylesheets and fonts from the EPUB
 *
 * Revision folders are immutable once written (§6.7). Nothing here is a position to persist:
 * Block offsets live only in the word index, and everything outside it attaches with Anchors.
 */
import { z } from 'zod';
import type { WordId } from './anchor';

/** Bump when tokenisation changes: the same text then gets different Words (D-026). */
export const TOKENISER_VERSION = 1;
export const WORD_INDEX_VERSION = 1;
export const MANIFEST_VERSION = 1;

/**
 * Elements that are Blocks (§2): each gets a `data-b` index in reading order, unique within its
 * Chapter. A Word belongs to its nearest Block ancestor; text directly in `<body>` belongs to the
 * body. `text-pipeline` and `reader-core` must agree on this list exactly (ADR-002).
 */
export const BLOCK_TAGS = [
	'body',
	'address',
	'article',
	'aside',
	'blockquote',
	'caption',
	'dd',
	'div',
	'dt',
	'figcaption',
	'figure',
	'footer',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'li',
	'nav',
	'p',
	'pre',
	'section',
	'td',
	'th'
] as const;

/** Elements whose text is never tokenised. */
export const UNTOKENISED_TAGS = ['script', 'style', 'svg', 'math'] as const;

/** Paths of the files a Revision consists of, relative to its folder (§6.7). */
export const revisionPaths = {
	manifest: 'manifest.json',
	chapter: (href: string) => `content/${href}`,
	wordIndex: (chapterId: string) => `index/${chapterId}.words.json`,
	resource: (path: string) => `res/${path}`
} as const;

/** `[wordId, block, start, end]`: offsets are UTF-16 units into the Block's own text (ADR-002). */
export type WordIndexEntry = [wordId: WordId, block: number, start: number, end: number];

const int = z.number().int();
const nonNegative = int.nonnegative();

export const wordIndexSchema = z.object({
	version: z.literal(WORD_INDEX_VERSION),
	revisionId: z.string().min(1),
	chapterId: z.string().min(1),
	/** Ordinal of the first Word; a Word's Ordinal is this plus its position in `words`. */
	firstOrdinal: nonNegative,
	/** Per-Block integrity check: the Block's own text length and the first 8 hex of its SHA-256. */
	blocks: z.array(z.object({ b: nonNegative, len: nonNegative, sha: z.string().length(8) })),
	words: z.array(z.tuple([int.positive(), nonNegative, nonNegative, nonNegative]))
});
export type WordIndex = Omit<z.infer<typeof wordIndexSchema>, 'words'> & {
	words: WordIndexEntry[];
};

/** One spine item of a Revision (§2 Chapter). */
export const chapterRecordSchema = z.object({
	/** Stable across Revisions while the file keeps its path: the spine item's href. */
	chapterId: z.string().min(1),
	/** Path of the XHTML under `content/`. */
	href: z.string().min(1),
	spineIndex: nonNegative,
	/** `linear="no"` items (notes, pop-ups) are skipped by page turns. */
	linear: z.boolean(),
	title: z.string(),
	wordCount: nonNegative,
	/** First and last WordId, or null for a Chapter with no Words (a cover page). */
	firstWordId: int.positive().nullable(),
	lastWordId: int.positive().nullable(),
	/** Ordinals of the first and last Word. An empty Chapter has `lastOrdinal = firstOrdinal - 1`. */
	firstOrdinal: nonNegative,
	lastOrdinal: int.min(-1)
});
export type ChapterRecord = z.infer<typeof chapterRecordSchema>;

/** A table-of-contents entry, already resolved to the first Word at or after its target. */
export const tocEntrySchema = z.object({
	label: z.string(),
	chapterId: z.string().min(1),
	/** The fragment id inside the Chapter, if the entry points into it. */
	fragment: z.string().nullable(),
	/** First Word at or after the target; the Chapter's first Word when there's none after it. */
	ordinal: nonNegative,
	depth: nonNegative
});
export type TocEntry = z.infer<typeof tocEntrySchema>;

export const resourceSchema = z.object({
	/** Path inside the EPUB (relative to the OPF folder), as chapters reference it. */
	path: z.string().min(1),
	mediaType: z.string().min(1),
	bytes: nonNegative
});
export type ResourceRecord = z.infer<typeof resourceSchema>;

export const revisionManifestSchema = z.object({
	version: z.literal(MANIFEST_VERSION),
	bookId: z.string().min(1),
	/** SHA-256 of the EPUB file, hex (§6.3). */
	revisionId: z.string().min(1),
	tokeniserVersion: int.positive(),
	title: z.string(),
	creator: z.string(),
	/** BCP 47, from the OPF. */
	lang: z.string().min(1),
	dir: z.enum(['ltr', 'rtl']),
	/** The EPUB's own `dc:identifier`, if it had one. */
	identifier: z.string().nullable(),
	chapters: z.array(chapterRecordSchema),
	toc: z.array(tocEntrySchema),
	resources: z.array(resourceSchema),
	/** Path of the cover image under `res/`, if the EPUB names one. */
	coverPath: z.string().nullable(),
	wordCount: nonNegative,
	/** The Book's WordId counter after this Revision (§6.2). */
	nextWordId: int.positive(),
	/** The Revision this one was carried forward from; absent on a Book's first Revision. */
	previousRevisionId: z.string().min(1).optional(),
	/** WordIds of the previous Revision that this one no longer has (§6.2 step 2). */
	deletedWordIds: z.array(int.positive()).optional()
});
export type RevisionManifest = z.infer<typeof revisionManifestSchema>;

/** Plain-language warnings for the ingest report (§7.1 step 7). */
export const ingestWarningCodes = [
	'script_removed',
	'unsafe_element_removed',
	'unsafe_attribute_removed',
	'external_resource_removed',
	'css_removed',
	'missing_resource',
	'missing_alt',
	'malformed_xhtml',
	'unsupported_media_removed',
	'no_toc'
] as const;
export type IngestWarningCode = (typeof ingestWarningCodes)[number];

export const ingestWarningSchema = z.object({
	code: z.enum(ingestWarningCodes),
	severity: z.enum(['info', 'warning']),
	/** Says what happened, for the reader or author. */
	message: z.string(),
	/** How many times it happened across the Book. */
	count: int.positive(),
	/** Chapters it happened in, for linking to the preview. */
	chapterIds: z.array(z.string())
});
export type IngestWarning = z.infer<typeof ingestWarningSchema>;

export const ingestReportSchema = z.object({
	title: z.string(),
	chapterCount: nonNegative,
	wordCount: nonNegative,
	imageCount: nonNegative,
	warnings: z.array(ingestWarningSchema)
});
export type IngestReport = z.infer<typeof ingestReportSchema>;

/** Why an EPUB couldn't be processed at all, in words a reader can act on. */
export const ingestFailureCodes = [
	'not_a_zip',
	'not_an_epub',
	'no_package_document',
	'bad_package_document',
	'no_readable_chapters',
	'encrypted',
	'too_large'
] as const;
export type IngestFailureCode = (typeof ingestFailureCodes)[number];

/** The Chapter an Ordinal falls in, by binary search over the Chapters' Ordinal ranges. */
export function chapterForOrdinal(
	chapters: readonly ChapterRecord[],
	ordinal: number
): ChapterRecord | undefined {
	let lo = 0;
	let hi = chapters.length - 1;
	let found: ChapterRecord | undefined;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const chapter = chapters[mid]!;
		if (chapter.firstOrdinal > ordinal) hi = mid - 1;
		else {
			if (chapter.lastOrdinal >= ordinal) found = chapter;
			lo = mid + 1;
		}
	}
	return found;
}
