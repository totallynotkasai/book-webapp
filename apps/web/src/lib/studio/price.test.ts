import { describe, expect, it } from 'vitest';
import { parsePrice, priceText } from './price';

describe('typed prices (Invariant 17)', () => {
	it('become integer minor units', () => {
		expect(parsePrice('2.49')).toEqual({ amountMinor: 249, currency: 'GBP' });
		expect(parsePrice('£2.5')).toEqual({ amountMinor: 250, currency: 'GBP' });
		expect(parsePrice(' 0 ')).toEqual({ amountMinor: 0, currency: 'GBP' });
		expect(parsePrice('1,200.00')).toEqual({ amountMinor: 120000, currency: 'GBP' });
	});

	it('refuse anything else', () => {
		for (const text of ['', '-1', '2.499', 'two', '1e3', '0.1.2'])
			expect(parsePrice(text)).toBeNull();
	});

	it('go back to what was typed', () => {
		expect(priceText({ amountMinor: 249, currency: 'GBP' })).toBe('2.49');
		expect(priceText({ amountMinor: 5, currency: 'GBP' })).toBe('0.05');
	});
});
