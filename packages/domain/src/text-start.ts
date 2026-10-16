/**
 * Where a Book's text starts (P1-RDR-09): a Book opened for the first time opens there, not at the
 * front matter before it (a cover, a licence, a contents page). It reads only the Revision's
 * manifest, so it works for any Revision, including ones processed before ingest recorded
 * landmarks; and the reader gets a Word, so it opens at an Anchor (DESIGN.md §6.1).
 *
 * In order:
 * 1. The EPUB's own word for it: the EPUB 3 nav's `bodymatter` landmark, else the EPUB 2 guide's
 *    `text` reference.
 * 2. Otherwise a heuristic over the table of contents (D-034). Each
 *    step counts only if what it skips is front-matter-sized: at most a tenth of the Book's Words.
 *    a. The first entry headed like a chapter or part: "Chapter …", "Prologue", "Part I", "Book
 *       the First", or a number on its own ("1. Dusk Shift", "IV: The Sea-Chest").
 *    b. The first Chapter with Words after the one holding the contents page.
 *    c. The first entry that isn't the Book's title or named like front matter.
 * 3. Otherwise the first Chapter with Words, where the reader always opened before.
 */
import { chapterForOrdinal, type RevisionManifest } from '@book/core';

export type TextStartSource =
	'bodymatter' | 'guide' | 'chapter-heading' | 'after-contents' | 'first-entry' | 'first-chapter';

export interface TextStart {
	chapterId: string;
	/** Ordinal of the text's first Word. */
	ordinal: number;
	/** Which rule found it. */
	source: TextStartSource;
}

/** The heuristic trusts a start only when the front matter it skips is at most this share. */
export const MAX_FRONT_MATTER = 0.1;

const CHAPTER_WORD = /^(chapter|chap\.|prologue)(?![\p{L}\p{N}])/iu;
/** Words that head a chapter only with a number after them: "Part I", not "Part of the Plan". */
const NUMBERED_WORD =
	/^(part|book|volume|vol\.|letter|stave|canto|act|episode)\s+(the\s+)?(\d+|[ivxlcdm]+|one|two|three|first|second|third)(?![\p{L}\p{N}])/iu;
/** A number on its own: Arabic, or an upper-case Roman numeral ("I", "XII"), not a word ("Did"). */
const BARE_NUMBER =
	/^(\d+|(?=[MDCLXVI])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3}))(?![\p{L}\p{N}])/u;

/** Labels of front matter, compared after `normalise`: the whole label or its first words. */
const FRONT_MATTER = [
	'cover',
	'front cover',
	'title',
	'title page',
	'titlepage',
	'half title',
	'half title page',
	'halftitle',
	'halftitlepage',
	'copyright',
	'imprint',
	'colophon',
	'contents',
	'table of contents',
	'dedication',
	'epigraph',
	'frontispiece',
	'licence',
	'license',
	'list of illustrations',
	'list of plates',
	'list of figures',
	'list of maps',
	'illustrations',
	'map',
	'maps',
	'acknowledgements',
	'acknowledgments',
	'also by',
	'by the same author',
	'praise for',
	'about this book',
	'about this ebook',
	"transcriber's note",
	"transcriber's notes",
	'a note on the text',
	'note on the text'
];
const CONTENTS = ['contents', 'table of contents'];

/** Lower case, no accents, straight apostrophes, punctuation as single spaces. */
function normalise(label: string): string {
	return label
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.replace(/[‘’ʼ]/gu, "'")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}']+/gu, ' ')
		.trim();
}

const startsWithName = (label: string, names: readonly string[]) =>
	names.some((name) => label === name || label.startsWith(`${name} `));

export function isChapterHeading(label: string): boolean {
	const text = label.trim();
	return CHAPTER_WORD.test(text) || NUMBERED_WORD.test(text) || BARE_NUMBER.test(text);
}

export function isFrontMatter(label: string, bookTitle: string): boolean {
	const name = normalise(label);
	const title = normalise(bookTitle);
	// The title page, whose entry is the Book's title (or the start of a long one).
	if (!name || name === title || title.startsWith(`${name} `)) return true;
	return name.includes('project gutenberg') || startsWithName(name, FRONT_MATTER);
}

export function isContentsPage(label: string): boolean {
	return startsWithName(normalise(label), CONTENTS);
}

export function textStart(manifest: RevisionManifest): TextStart | null {
	const { chapters, toc, wordCount } = manifest;
	/** A start at this Word, if it's in a linear Chapter of this manifest. */
	const at = (ordinal: number, source: TextStartSource): TextStart | null => {
		if (ordinal >= wordCount) return null;
		const chapter = chapterForOrdinal(chapters, ordinal);
		return chapter?.linear ? { chapterId: chapter.chapterId, ordinal, source } : null;
	};
	/** Heuristic starts must leave only front-matter-sized text before them. */
	const plausible = (ordinal: number, source: TextStartSource) =>
		ordinal <= wordCount * MAX_FRONT_MATTER ? at(ordinal, source) : null;

	const landmark = (type: string) => manifest.landmarks?.find((l) => l.type === type);
	const bodymatter = landmark('bodymatter');
	const guide = landmark('text');

	const heading = toc.find((t) => isChapterHeading(t.label));
	const contents = toc.find((t) => isContentsPage(t.label));
	const contentsChapter = contents
		? chapters.findIndex((c) => c.chapterId === contents.chapterId)
		: -1;
	const afterContents =
		contentsChapter >= 0
			? chapters.slice(contentsChapter + 1).find((c) => c.linear && c.wordCount > 0)
			: undefined;
	const firstEntry = toc.find((t) => !isFrontMatter(t.label, manifest.title));
	const firstChapter = chapters.find((c) => c.linear && c.wordCount > 0);

	return (
		(bodymatter && at(bodymatter.ordinal, 'bodymatter')) ||
		(guide && at(guide.ordinal, 'guide')) ||
		(heading && plausible(heading.ordinal, 'chapter-heading')) ||
		(afterContents && plausible(afterContents.firstOrdinal, 'after-contents')) ||
		(firstEntry && plausible(firstEntry.ordinal, 'first-entry')) ||
		(firstChapter && at(firstChapter.firstOrdinal, 'first-chapter')) ||
		null
	);
}
