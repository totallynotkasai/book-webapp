import { describe, expect, it } from 'vitest';
import {
	AnchorRevisionMismatchError,
	compareAnchors,
	endOrdinal,
	isAtOrBefore,
	isWithinRange,
	latestAtOrBefore,
	rangesOverlap,
	startOrdinal,
	type PointAnchor,
	type RangeAnchor
} from './anchor';

const quote = { exact: 'word', prefix: '', suffix: '' };

/** WordIds deliberately don't follow Ordinals, as after a Revision inserts text (Invariant 4). */
function point(ordinal: number, revisionId = 'rev1', bookId = 'book1'): PointAnchor {
	return { kind: 'point', bookId, revisionId, wordId: 1000 - ordinal, ordinal, quote };
}

function range(start: number, end: number, revisionId = 'rev1', bookId = 'book1'): RangeAnchor {
	return {
		kind: 'range',
		bookId,
		revisionId,
		startWordId: 5000 + end,
		endWordId: 5000 + start,
		startOrdinal: start,
		endOrdinal: end,
		quote
	};
}

describe('startOrdinal / endOrdinal', () => {
	it('reads points and ranges', () => {
		expect([startOrdinal(point(7)), endOrdinal(point(7))]).toEqual([7, 7]);
		expect([startOrdinal(range(3, 9)), endOrdinal(range(3, 9))]).toEqual([3, 9]);
	});
});

describe('compareAnchors', () => {
	it('orders by Ordinal, never by WordId', () => {
		// point(1) has the higher WordId but comes first in reading order.
		expect(compareAnchors(point(1), point(2))).toBeLessThan(0);
		expect(compareAnchors(point(5), point(3))).toBeGreaterThan(0);
		expect(compareAnchors(point(5), point(5))).toBe(0);
	});

	it('orders ranges by start, then by end, and mixes with points', () => {
		expect(compareAnchors(range(2, 4), range(2, 9))).toBeLessThan(0);
		expect(compareAnchors(range(3, 4), range(2, 9))).toBeGreaterThan(0);
		expect(compareAnchors(point(2), range(2, 2))).toBe(0);
		expect(compareAnchors(point(2), range(2, 3))).toBeLessThan(0);
	});

	it('refuses to compare across Revisions or Books', () => {
		expect(() => compareAnchors(point(1, 'rev1'), point(1, 'rev2'))).toThrow(
			AnchorRevisionMismatchError
		);
		expect(() => compareAnchors(point(1, 'rev1', 'a'), point(1, 'rev1', 'b'))).toThrow(
			AnchorRevisionMismatchError
		);
	});
});

describe('isAtOrBefore', () => {
	it('includes equality', () => {
		expect(isAtOrBefore(point(1), point(1))).toBe(true);
		expect(isAtOrBefore(point(1), point(2))).toBe(true);
		expect(isAtOrBefore(point(2), point(1))).toBe(false);
	});
});

describe('isWithinRange', () => {
	const r = range(10, 20);

	it('includes both ends', () => {
		expect(isWithinRange(point(10), r)).toBe(true);
		expect(isWithinRange(point(20), r)).toBe(true);
		expect(isWithinRange(range(12, 18), r)).toBe(true);
	});

	it('excludes anything partly or wholly outside', () => {
		expect(isWithinRange(point(9), r)).toBe(false);
		expect(isWithinRange(point(21), r)).toBe(false);
		expect(isWithinRange(range(15, 21), r)).toBe(false);
	});

	it('refuses ranges from another Revision', () => {
		expect(() => isWithinRange(point(12, 'rev2'), r)).toThrow(AnchorRevisionMismatchError);
	});
});

describe('rangesOverlap', () => {
	it('detects overlapping and touching ranges', () => {
		expect(rangesOverlap(range(1, 3), range(2, 5))).toBe(true);
		expect(rangesOverlap(range(1, 3), range(3, 5))).toBe(true);
		expect(rangesOverlap(range(1, 9), range(3, 5))).toBe(true);
		expect(rangesOverlap(point(4), range(3, 5))).toBe(true);
	});

	it('rejects separate ranges', () => {
		expect(rangesOverlap(range(1, 2), range(3, 5))).toBe(false);
		expect(rangesOverlap(point(6), range(3, 5))).toBe(false);
	});

	it('refuses ranges from another Revision', () => {
		expect(() => rangesOverlap(range(1, 3), range(1, 3, 'rev2'))).toThrow(
			AnchorRevisionMismatchError
		);
	});
});

describe('latestAtOrBefore (current-Illustration rule, §8.2)', () => {
	const illustrations = [
		{ id: 'c', at: range(300, 310) },
		{ id: 'a', at: point(10) },
		{ id: 'b', at: range(100, 150) }
	];
	const pick = (ordinal: number) =>
		latestAtOrBefore(illustrations, point(ordinal), (i) => i.at)?.id;

	it('returns nothing before the first Anchor', () => {
		expect(pick(9)).toBeUndefined();
	});

	it('returns the latest Anchor starting at or before the position', () => {
		expect(pick(10)).toBe('a');
		expect(pick(99)).toBe('a');
		expect(pick(100)).toBe('b');
		expect(pick(999)).toBe('c');
	});

	it('never returns an Anchor ahead of the reader (Invariant 6)', () => {
		expect(pick(299)).toBe('b');
	});

	it('breaks ties by list order, so callers control priority', () => {
		const tied = [
			{ id: 'first', at: point(5) },
			{ id: 'second', at: point(5) }
		];
		expect(latestAtOrBefore(tied, point(5), (i) => i.at)?.id).toBe('first');
	});

	it('refuses items from another Revision', () => {
		expect(() => latestAtOrBefore([{ at: point(1, 'rev2') }], point(5), (i) => i.at)).toThrow(
			AnchorRevisionMismatchError
		);
	});
});
