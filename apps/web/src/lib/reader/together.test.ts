import type { CommentDto, PopularHighlightDto, RangeAnchor } from '@book/core';
import { describe, expect, it } from 'vitest';
import { paragraphsOf } from './focus';
import {
	commentCountLabel,
	commentedParagraphs,
	onPassage,
	paragraphAnchor,
	popularAt,
	popularReached,
	popularReaders,
	readersLabel,
	tidyPassage
} from './together';

const book = { bookId: 'b', revisionId: 'r' };

const range = (startOrdinal: number, endOrdinal: number): RangeAnchor => ({
	kind: 'range',
	...book,
	startWordId: startOrdinal + 1,
	endWordId: endOrdinal + 1,
	startOrdinal,
	endOrdinal,
	quote: { exact: '', prefix: '', suffix: '' }
});

const comment = (id: string, startOrdinal: number, replies = 0, deleted = false): CommentDto => ({
	id,
	bookId: 'b',
	chapterId: 'ch1',
	anchor: range(startOrdinal, startOrdinal + 2),
	authorName: deleted ? '' : 'Someone',
	byAuthor: false,
	mine: false,
	text: deleted ? '' : 'Words',
	spoilers: false,
	createdAt: '2026-10-01T00:00:00.000Z',
	hidden: false,
	deleted,
	replies: Array.from({ length: replies }, (_, i) => ({
		id: `${id}-r${i}`,
		authorName: 'Another',
		byAuthor: false,
		mine: false,
		text: 'A reply',
		spoilers: false,
		createdAt: '2026-10-02T00:00:00.000Z',
		hidden: false
	}))
});

// Three paragraphs: Words 10–14, 15–19 and 20–24 (Blocks 0, 1 and 2).
const paragraphs = paragraphsOf({
	chapterId: 'ch1',
	firstOrdinal: 10,
	wordIds: Array.from({ length: 15 }, (_, i) => i + 11),
	texts: Array.from({ length: 15 }, (_, i) => `w${i}`),
	blocks: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]
});

describe('paragraph comments in the reader (P1-COM-03)', () => {
	it('groups comments by the paragraph their passage starts in, and counts replies too', () => {
		const grouped = commentedParagraphs(
			[comment('a', 11, 2), comment('b', 20), comment('c', 13), comment('d', 22, 1, true)],
			paragraphs
		);
		expect(grouped.map((g) => [g.index, g.comments.map((c) => c.id), g.count])).toEqual([
			[0, ['a', 'c'], 4],
			[2, ['b', 'd'], 2]
		]);
		expect(grouped[0]!.paragraph).toMatchObject({ first: 10, last: 14 });
	});

	it('leaves out a comment that isn’t in the Chapter’s paragraphs', () => {
		expect(commentedParagraphs([comment('x', 99)], paragraphs)).toEqual([]);
	});

	it('says how many, for screen readers', () => {
		expect(commentCountLabel(1)).toBe('1 comment on this paragraph');
		expect(commentCountLabel(3)).toBe('3 comments on this paragraph');
	});

	it('quotes a passage from the page without punctuation left hanging', () => {
		expect(tidyPassage('very sleepy and stupid),')).toBe('very sleepy and stupid');
		expect(tidyPassage('(as well as she')).toBe('as well as she');
		expect(tidyPassage('“and what is the use of a book,” thought Alice')).toBe(
			'“and what is the use of a book,” thought Alice'
		);
		expect(tidyPassage('without pictures or conversations?”')).toBe(
			'without pictures or conversations?'
		);
		expect(tidyPassage('Alice’s  first thought')).toBe('Alice’s first thought');
	});

	it('says what a comment is on, without a second pair of quotation marks round dialogue', () => {
		expect(onPassage('very sleepy and stupid')).toBe('On “very sleepy and stupid”');
		expect(onPassage('“and what is the use of a book,” thought Alice')).toBe(
			'On “and what is the use of a book,” thought Alice'
		);
	});

	it('anchors “Add a comment” to the whole paragraph', () => {
		expect(paragraphAnchor(paragraphs[1]!, book, ['Some', 'words'])).toMatchObject({
			startOrdinal: 15,
			endOrdinal: 19,
			startWordId: 16,
			endWordId: 20,
			quote: { exact: 'Some words' }
		});
	});
});

describe('popular highlights in the reader (P1-COM-04)', () => {
	const passage = (start: number, end: number, readers: number): PopularHighlightDto => ({
		anchor: range(start, end),
		chapterId: 'ch1',
		readers
	});
	const passages = [passage(10, 14, 6), passage(30, 40, 29), passage(50, 52, 12)];

	it('finds the passage under a tapped Word, and the most readers under a selection', () => {
		expect(popularAt(passages, 35)?.readers).toBe(29);
		expect(popularAt(passages, 20)).toBeUndefined();
		expect(popularReaders(passages, { startOrdinal: 12, endOrdinal: 31 })).toBe(29);
		expect(popularReaders(passages, { startOrdinal: 15, endOrdinal: 29 })).toBe(0);
	});

	it('lists only what the reader has reached, most highlighted first (Invariant 6)', () => {
		expect(popularReached(passages, 45).map((p) => p.readers)).toEqual([29, 6]);
		expect(popularReached(passages, 35).map((p) => p.readers)).toEqual([6]);
		expect(popularReached(passages, 100).map((p) => p.readers)).toEqual([29, 12, 6]);
	});

	it('says how many, and never who', () => {
		expect(readersLabel(12)).toBe('12 readers highlighted this');
		expect(readersLabel(1)).toBe('1 reader highlighted this');
	});
});
