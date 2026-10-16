import { describe, expect, it } from 'vitest';
import type { ChapterText } from '@book/reader-core';
import { focusOnPage, paragraphAt, paragraphsOf, step } from './focus';

// Three paragraphs: Words 100–104 (Block 1), 105–107 (Block 2), 108–111 (Block 3).
const text: ChapterText = {
	chapterId: 'c1',
	firstOrdinal: 100,
	wordIds: Array.from({ length: 12 }, (_, i) => 900 + i),
	texts: Array.from({ length: 12 }, (_, i) => `w${i}`),
	blocks: [1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3]
};
const paragraphs = paragraphsOf(text);

describe('paragraphs (P1-RDR-11)', () => {
	it('are runs of Words in one Block', () => {
		expect(paragraphs).toEqual([
			{ first: 100, last: 104, firstWordId: 900, lastWordId: 904 },
			{ first: 105, last: 107, firstWordId: 905, lastWordId: 907 },
			{ first: 108, last: 111, firstWordId: 908, lastWordId: 911 }
		]);
		expect(paragraphAt(paragraphs, 106)).toBe(1);
		expect(paragraphAt(paragraphs, 99)).toBe(-1);
	});

	it('focus starts at the first paragraph that begins on the page', () => {
		expect(focusOnPage(paragraphs, { first: 100, last: 111 })).toBe(0);
		// The page starts mid-paragraph: the next one, which begins on it.
		expect(focusOnPage(paragraphs, { first: 102, last: 111 })).toBe(1);
		// The whole page is the end of one long paragraph.
		expect(focusOnPage(paragraphs, { first: 109, last: 111 })).toBe(2);
		expect(focusOnPage(paragraphs, { first: 100, last: 106 }, 'end')).toBe(1);
	});
});

describe('step', () => {
	const page = { first: 100, last: 106 };

	it('moves to the next paragraph on the page', () => {
		expect(step(paragraphs, 0, page, 1)).toEqual({ kind: 'focus', index: 1, turn: false });
	});

	it('turns the page when the paragraph goes on past it, keeping focus', () => {
		expect(step(paragraphs, 1, page, 1)).toEqual({ kind: 'turn' });
	});

	it('turns the page for a paragraph that starts after it', () => {
		expect(step(paragraphs, 1, { first: 100, last: 107 }, 1)).toEqual({
			kind: 'focus',
			index: 2,
			turn: true
		});
	});

	it('goes back a paragraph, or back a page to where one began', () => {
		expect(step(paragraphs, 1, page, -1)).toEqual({ kind: 'focus', index: 0, turn: false });
		expect(step(paragraphs, 1, { first: 106, last: 111 }, -1)).toEqual({ kind: 'turn' });
		expect(step(paragraphs, 2, { first: 108, last: 111 }, -1)).toEqual({
			kind: 'focus',
			index: 1,
			turn: true
		});
	});

	it('leaves the Chapter past its first or last paragraph', () => {
		expect(step(paragraphs, 2, { first: 105, last: 111 }, 1)).toEqual({ kind: 'chapter' });
		expect(step(paragraphs, 0, page, -1)).toEqual({ kind: 'chapter' });
	});
});
