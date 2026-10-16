import type { ChapterRecord, Landmark, RevisionManifest, TocEntry } from '@book/core';
import { describe, expect, it } from 'vitest';
import { isChapterHeading, isFrontMatter, textStart } from './index';

/** A manifest from Chapters' word counts, in reading order, with Ordinals worked out. */
function book(
	chapters: { id: string; words: number; linear?: boolean }[],
	{
		toc = [],
		landmarks,
		title = 'The Book'
	}: {
		toc?: [label: string, chapterId: string, offset?: number][];
		landmarks?: [type: string, chapterId: string, offset?: number][];
		title?: string;
	} = {}
): RevisionManifest {
	let ordinal = 0;
	const records: ChapterRecord[] = chapters.map((c, i) => {
		const record: ChapterRecord = {
			chapterId: c.id,
			href: c.id,
			spineIndex: i,
			linear: c.linear ?? true,
			title: '',
			wordCount: c.words,
			firstWordId: c.words ? ordinal + 1 : null,
			lastWordId: c.words ? ordinal + c.words : null,
			firstOrdinal: ordinal,
			lastOrdinal: ordinal + c.words - 1
		};
		ordinal += c.words;
		return record;
	});
	const ordinalIn = (chapterId: string, offset = 0) =>
		records.find((c) => c.chapterId === chapterId)!.firstOrdinal + offset;
	return {
		version: 1,
		bookId: 'book',
		revisionId: 'rev',
		tokeniserVersion: 1,
		title,
		creator: '',
		lang: 'en',
		dir: 'ltr',
		identifier: null,
		chapters: records,
		toc: toc.map(([label, chapterId, offset]): TocEntry => ({
			label,
			chapterId,
			fragment: offset ? 'f' : null,
			ordinal: ordinalIn(chapterId, offset),
			depth: 0
		})),
		...(landmarks && {
			landmarks: landmarks.map(([type, chapterId, offset]): Landmark => ({
				type,
				chapterId,
				fragment: offset ? 'f' : null,
				ordinal: ordinalIn(chapterId, offset)
			}))
		}),
		resources: [],
		coverPath: null,
		wordCount: ordinal,
		nextWordId: ordinal + 1
	};
}

/** Cover, front matter with a contents page, then three Chapters of 1,000 Words. */
const CHAPTERS = [
	{ id: 'cover', words: 0 },
	{ id: 'front', words: 200 },
	{ id: 'c1', words: 1000 },
	{ id: 'c2', words: 1000 },
	{ id: 'c3', words: 1000 }
];

describe('where a Book’s text starts (P1-RDR-09)', () => {
	describe('the EPUB’s own landmarks', () => {
		it('starts at the EPUB 3 bodymatter landmark, even inside a Chapter', () => {
			expect(textStart(book(CHAPTERS, { landmarks: [['bodymatter', 'c1', 40]] }))).toEqual({
				chapterId: 'c1',
				ordinal: 240,
				source: 'bodymatter'
			});
		});

		it('trusts a landmark however far in it is: the author put it there', () => {
			expect(textStart(book(CHAPTERS, { landmarks: [['bodymatter', 'c3']] }))?.ordinal).toBe(2200);
		});

		it('uses the EPUB 2 guide’s text reference when there’s no bodymatter landmark', () => {
			expect(textStart(book(CHAPTERS, { landmarks: [['text', 'c2']] }))).toEqual({
				chapterId: 'c2',
				ordinal: 1200,
				source: 'guide'
			});
		});

		it('prefers bodymatter to the guide, and ignores other kinds of landmark', () => {
			const manifest = book(CHAPTERS, {
				landmarks: [
					['toc', 'front'],
					['text', 'c2'],
					['bodymatter', 'c1']
				]
			});
			expect(textStart(manifest)?.source).toBe('bodymatter');
			expect(textStart(manifest)?.ordinal).toBe(200);
		});

		it('passes over a landmark in a Chapter the reader can’t open (a sample)', () => {
			const manifest = book(CHAPTERS, { landmarks: [['bodymatter', 'c3']] });
			// The reader leaves locked Chapters out of the manifest it lays out.
			const sample = { ...manifest, chapters: manifest.chapters.slice(0, 4), wordCount: 2200 };
			expect(textStart(sample)?.source).toBe('first-chapter');
		});

		it('passes over a landmark on a non-linear Chapter', () => {
			const manifest = book(
				[
					{ id: 'notes', words: 50, linear: false },
					{ id: 'c1', words: 1000 }
				],
				{ landmarks: [['bodymatter', 'notes']] }
			);
			expect(textStart(manifest)).toEqual({
				chapterId: 'c1',
				ordinal: 50,
				source: 'first-chapter'
			});
		});
	});

	describe('without landmarks: the table of contents (D-034)', () => {
		it('starts at the first entry headed like a chapter', () => {
			// Project Gutenberg's Alice: title, edition and contents, then CHAPTER I.
			const manifest = book(CHAPTERS, {
				title: 'Alice’s Adventures in Wonderland',
				toc: [
					['Alice’s Adventures in Wonderland', 'front', 130],
					['THE MILLENNIUM FULCRUM EDITION 3.0', 'front', 140],
					['Contents', 'front', 150],
					['CHAPTER I. Down the Rabbit-Hole', 'c1'],
					['CHAPTER II. The Pool of Tears', 'c2']
				]
			});
			expect(textStart(manifest)).toEqual({
				chapterId: 'c1',
				ordinal: 200,
				source: 'chapter-heading'
			});
		});

		it('skips an introduction for the first chapter, as publishers’ landmarks do', () => {
			const manifest = book(CHAPTERS, {
				toc: [
					['Introduction', 'front'],
					['I: The Cyclone', 'c1']
				]
			});
			expect(textStart(manifest)?.ordinal).toBe(200);
		});

		it('otherwise starts at the first Chapter after the contents page', () => {
			// Rackham's Alice: its contents lists the plates, not the chapters.
			const manifest = book(CHAPTERS, {
				title: 'Alice’s Adventures in Wonderland / Illustrated by Arthur Rackham',
				toc: [
					['ALICE’S ADVENTURES IN WONDERLAND', 'front', 20],
					['CONTENTS', 'front', 100],
					['LIST OF THE PLATES', 'front', 150],
					['THE END', 'c3', 990]
				]
			});
			expect(textStart(manifest)).toEqual({
				chapterId: 'c1',
				ordinal: 200,
				source: 'after-contents'
			});
		});

		it('otherwise starts at the first entry that isn’t front matter', () => {
			const manifest = book(CHAPTERS, {
				toc: [
					['Cover', 'cover'],
					['Title Page', 'front'],
					['Copyright', 'front', 50],
					['Dedication', 'front', 100],
					['The Boy Who Lived', 'c1'],
					['The Vanishing Glass', 'c2']
				]
			});
			expect(textStart(manifest)).toEqual({ chapterId: 'c1', ordinal: 200, source: 'first-entry' });
		});

		it('never skips more than a tenth of the Book on a guess', () => {
			// Chapter headings only from the third Chapter: that would skip two thirds of it.
			const late = book(CHAPTERS, {
				toc: [
					['Opening', 'c1'],
					['Chapter 3', 'c3']
				]
			});
			expect(textStart(late)).toEqual({ chapterId: 'c1', ordinal: 200, source: 'first-entry' });
			// A contents page at the end (as some books have) isn't front matter.
			const contentsAtEnd = book(CHAPTERS, {
				toc: [
					['Title', 'front'],
					['Contents', 'c3', 900]
				]
			});
			expect(textStart(contentsAtEnd)?.source).toBe('first-chapter');
		});

		it('starts at the first Chapter with Words when nothing else fits, as before', () => {
			expect(textStart(book(CHAPTERS, { landmarks: [] }))).toEqual({
				chapterId: 'front',
				ordinal: 0,
				source: 'first-chapter'
			});
		});
	});

	describe('labels', () => {
		it.each([
			'CHAPTER I. Down the Rabbit-Hole',
			'Chapter One',
			'Chap. 4',
			'Prologue',
			'Part I: The Old Buccaneer',
			'Book the First',
			'Letter 1',
			'Stave I: Marley’s Ghost',
			'1. Dusk Shift',
			'IV: The Sea-Chest',
			'XII',
			'I'
		])('%s is headed like a chapter', (label) => {
			expect(isChapterHeading(label)).toBe(true);
		});

		it.each([
			'Introduction',
			'Contents',
			'Did You Know?',
			'Mixed Blessings',
			'Partners',
			'Part of the Plan',
			'Letter from the Editor',
			'Books by the Same Author',
			'In the Beginning',
			'1st Edition'
		])('%s is not headed like a chapter', (label) => {
			expect(isChapterHeading(label)).toBe(false);
		});

		it.each([
			'Cover',
			'Titlepage',
			'Half-title',
			'Copyright Page',
			'Imprint',
			'Table of Contents',
			'Dedication',
			'Epigraph',
			'List of Illustrations',
			'THE FULL PROJECT GUTENBERG™ LICENSE',
			'The Project Gutenberg eBook of Alice',
			'Acknowledgements',
			'Also by Lewis Carroll',
			'Transcriber’s Note:',
			'Treasure Island',
			''
		])('“%s” is front matter in Treasure Island', (label) => {
			expect(isFrontMatter(label, 'Treasure Island')).toBe(true);
		});

		it.each(['Preface', 'Foreword', 'The Old Sea-Dog', 'Titus’s Story', 'Treasure Hunting'])(
			'“%s” is not front matter',
			(label) => {
				expect(isFrontMatter(label, 'Treasure Island')).toBe(false);
			}
		);
	});
});
