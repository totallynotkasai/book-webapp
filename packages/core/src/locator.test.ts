import { describe, expect, it } from 'vitest';
import {
	compareLocators,
	isWithinRange,
	latestAtOrBefore,
	rangesOverlap,
	type Locator,
	type TextRange
} from './locator';

function loc(paragraphIndex: number, charOffset = 0, editionId = 'ed1'): Locator {
	return { editionId, cfi: '', paragraphId: `p${paragraphIndex}`, paragraphIndex, charOffset };
}

function range(start: Locator, end: Locator): TextRange {
	return { start, end };
}

describe('compareLocators', () => {
	it('orders by paragraph, then by character offset', () => {
		expect(compareLocators(loc(1), loc(2))).toBeLessThan(0);
		expect(compareLocators(loc(2, 5), loc(2, 3))).toBeGreaterThan(0);
		expect(compareLocators(loc(2, 5), loc(2, 5))).toBe(0);
	});

	it('refuses to compare across editions', () => {
		expect(() => compareLocators(loc(1, 0, 'ed1'), loc(1, 0, 'ed2'))).toThrow();
	});
});

describe('isWithinRange', () => {
	const r = range(loc(2, 10), loc(4, 0));

	it('includes both ends', () => {
		expect(isWithinRange(loc(2, 10), r)).toBe(true);
		expect(isWithinRange(loc(4, 0), r)).toBe(true);
	});

	it('excludes positions outside', () => {
		expect(isWithinRange(loc(2, 9), r)).toBe(false);
		expect(isWithinRange(loc(4, 1), r)).toBe(false);
	});
});

describe('rangesOverlap', () => {
	it('detects overlapping and touching ranges', () => {
		expect(rangesOverlap(range(loc(1), loc(3)), range(loc(2), loc(5)))).toBe(true);
		expect(rangesOverlap(range(loc(1), loc(3)), range(loc(3), loc(5)))).toBe(true);
	});

	it('rejects separate ranges', () => {
		expect(rangesOverlap(range(loc(1), loc(2)), range(loc(3), loc(5)))).toBe(false);
	});
});

describe('latestAtOrBefore (illustration display rule)', () => {
	const illustrations = [
		{ id: 'c', at: loc(30) },
		{ id: 'a', at: loc(1) },
		{ id: 'b', at: loc(10, 50) }
	];
	const pick = (position: Locator) => latestAtOrBefore(illustrations, position, (i) => i.at)?.id;

	it('returns nothing before the first anchor', () => {
		expect(pick(loc(0))).toBeUndefined();
	});

	it('returns the most recent anchor at or before the position', () => {
		expect(pick(loc(1))).toBe('a');
		expect(pick(loc(10, 49))).toBe('a');
		expect(pick(loc(10, 50))).toBe('b');
		expect(pick(loc(99))).toBe('c');
	});

	it('never returns an anchor ahead of the reader (spoiler safety)', () => {
		expect(pick(loc(29, 999))).toBe('b');
	});
});
