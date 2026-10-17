import { describe, expect, it } from 'vitest';
import { money, reviewOrder, reviewSummary, reviewVisibleTo, saleAlertDue } from './index';

const gbp = (n: number) => money(n, 'GBP');

describe('sale alerts (P1-STO-06, D-042)', () => {
	it('are due when the price falls below the price last seen', () => {
		expect(saleAlertDue(gbp(399), gbp(299))).toBe(true);
		expect(saleAlertDue(gbp(399), gbp(0))).toBe(true);
	});

	it('are not due for the same price, a rise, or a price in another currency', () => {
		expect(saleAlertDue(gbp(399), gbp(399))).toBe(false);
		expect(saleAlertDue(gbp(299), gbp(499))).toBe(false);
		expect(saleAlertDue(gbp(399), money(100, 'EUR'))).toBe(false);
	});

	it('compare with the last alert, so moving the price down and up again tells a reader once', () => {
		// Added at 3.99; down to 2.99 (alert, seen 2.99); up to 4.99; down to 3.49: not below 2.99.
		let seen = gbp(399);
		const alerts: number[] = [];
		for (const price of [299, 499, 349, 299, 249]) {
			if (saleAlertDue(seen, gbp(price))) {
				alerts.push(price);
				seen = gbp(price);
			}
		}
		expect(alerts).toEqual([299, 249]);
	});
});

describe('reviews (P1-STO-07)', () => {
	const review = (
		id: string,
		userId: string,
		stars: number,
		state: 'visible' | 'hidden' = 'visible',
		createdAt = '2026-10-01T00:00:00.000Z'
	) => ({ id, userId, stars, state, createdAt });

	it('are seen by everyone until a moderator hides one; then only by its writer', () => {
		expect(reviewVisibleTo(review('a', 'sam', 4), 'robin')).toBe(true);
		expect(reviewVisibleTo(review('a', 'sam', 4, 'hidden'), 'robin')).toBe(false);
		expect(reviewVisibleTo(review('a', 'sam', 4, 'hidden'), 'sam')).toBe(true);
		expect(reviewVisibleTo(review('a', 'sam', 4, 'hidden'), null)).toBe(false);
	});

	it('average the visible stars to one decimal place', () => {
		expect(reviewSummary([])).toBeNull();
		expect(
			reviewSummary([review('a', 'x', 5), review('b', 'y', 4), review('c', 'z', 1, 'hidden')])
		).toEqual({ average: 4.5, count: 2 });
		expect(reviewSummary([review('a', 'x', 5), review('b', 'y', 4), review('c', 'z', 4)])).toEqual({
			average: 4.3,
			count: 3
		});
	});

	it('come newest first', () => {
		const older = review('a', 'x', 5, 'visible', '2026-09-01T00:00:00.000Z');
		const newer = review('b', 'y', 3, 'visible', '2026-10-01T00:00:00.000Z');
		expect([older, newer].sort(reviewOrder).map((r) => r.id)).toEqual(['b', 'a']);
	});
});
