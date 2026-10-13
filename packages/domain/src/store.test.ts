import { describe, expect, it } from 'vitest';
import {
	addMonths,
	advanceSubscription,
	bundlePriceFor,
	earlyAccessChapterIds,
	money,
	ownedProductIds,
	revokeWithChildren,
	sampleChapterIds,
	type EntitlementRecord
} from './index';

const gbp = (n: number) => money(n, 'GBP');

describe('Bundles (§6.5, P1-STO-02)', () => {
	const children = [
		{ productId: 'book', price: gbp(0) },
		{ productId: 'pack', price: gbp(149) },
		{ productId: 'track', price: gbp(199) }
	];

	it('cost the full price to a reader who owns none of it, and nothing to one who owns it all', () => {
		expect(bundlePriceFor(gbp(249), children, new Set())).toEqual(gbp(249));
		expect(bundlePriceFor(gbp(249), children, new Set(['book', 'pack', 'track']))).toEqual(gbp(0));
	});

	it('take off what the reader owns, in proportion, rounding down', () => {
		// The free Book changes nothing; owning the pack (149 of 348) leaves 249 × 199 / 348.
		expect(bundlePriceFor(gbp(249), children, new Set(['book']))).toEqual(gbp(249));
		expect(bundlePriceFor(gbp(249), children, new Set(['pack']))).toEqual(gbp(142));
	});

	it('refuse to mix currencies (Invariant 17)', () => {
		expect(() =>
			bundlePriceFor(gbp(100), [{ productId: 'x', price: money(100, 'EUR') }], new Set())
		).toThrow(RangeError);
	});

	it('are refunded with their children, leaving separate purchases alone', () => {
		const e = (
			id: string,
			productId: string,
			parentId: string | null = null
		): EntitlementRecord => ({
			id,
			userId: 'u',
			productId,
			source: parentId ? 'bundle' : 'purchase',
			grantedAt: '2026-10-01T00:00:00.000Z',
			revokedAt: null,
			parentId
		});
		const all = [e('b', 'bundle'), e('c1', 'pack', 'b'), e('c2', 'track', 'b'), e('own', 'other')];
		const revoked = revokeWithChildren(all, 'b', new Date('2026-10-02T00:00:00.000Z'));
		expect(revoked.map((r) => r.id)).toEqual(['b', 'c1', 'c2']);
		const after = all.map((x) => revoked.find((r) => r.id === x.id) ?? x);
		expect([...ownedProductIds(after, 'u', new Date('2026-10-03T00:00:00.000Z'))]).toEqual([
			'other'
		]);
	});
});

const chapter = (chapterId: string, wordCount: number, linear = true) => ({
	chapterId,
	wordCount,
	linear
});

describe('samples and early access (P1-STO-01, P1-STO-04)', () => {
	it('a sample is the front matter and whole Chapters up to a tenth of the Words', () => {
		const book = [chapter('cover', 0), chapter('c1', 400), chapter('c2', 500), chapter('c3', 4100)];
		expect(sampleChapterIds(book)).toEqual(['cover', 'c1', 'c2']);
		// Always at least one Chapter, however long.
		expect(sampleChapterIds([chapter('only', 9000)])).toEqual(['only']);
	});

	it('early access is the newest Chapters with Words', () => {
		const serial = [
			chapter('front', 50),
			chapter('c1', 900),
			chapter('c2', 800),
			chapter('notes', 30, false)
		];
		expect(earlyAccessChapterIds(serial, 2)).toEqual(['c1', 'c2']);
	});
});

describe('Creator Subscriptions (§6.5, P1-STO-04)', () => {
	it('months keep the day, or the last day of a shorter month', () => {
		expect(addMonths('2026-10-11T09:00:00.000Z', 1)).toBe('2026-11-11T09:00:00.000Z');
		expect(addMonths('2027-01-31T00:00:00.000Z', 1)).toBe('2027-02-28T00:00:00.000Z');
	});

	const start = {
		status: 'active' as const,
		currentPeriodEnd: '2026-11-11T09:00:00.000Z',
		cancelAtPeriodEnd: false,
		endedAt: null
	};

	it('renew each month while payments go through', () => {
		const later = advanceSubscription(start, new Date('2027-01-20T00:00:00.000Z'), () => true);
		expect(later).toMatchObject({ status: 'active', currentPeriodEnd: '2027-02-11T09:00:00.000Z' });
		expect(later.renewalsPaid).toBe(3);
	});

	it('end at the end of the paid period once cancelled, or when a renewal is declined', () => {
		const cancelled = { ...start, status: 'cancelled' as const, cancelAtPeriodEnd: true };
		expect(
			advanceSubscription(cancelled, new Date('2026-11-01T00:00:00.000Z'), () => true)
		).toMatchObject({
			status: 'cancelled',
			endedAt: null
		});
		expect(
			advanceSubscription(cancelled, new Date('2026-12-01T00:00:00.000Z'), () => true)
		).toMatchObject({
			status: 'ended',
			endedAt: '2026-11-11T09:00:00.000Z',
			renewalsPaid: 0
		});
		expect(
			advanceSubscription(start, new Date('2026-12-01T00:00:00.000Z'), () => false)
		).toMatchObject({
			status: 'ended',
			endedAt: '2026-11-11T09:00:00.000Z'
		});
	});
});
