import { describe, expect, it } from 'vitest';
import { aiLabel, formatPrice, reviewProgress } from './format';

describe('formatPrice', () => {
	it('says Free for zero and formats minor units in their currency', () => {
		expect(formatPrice({ amountMinor: 0, currency: 'GBP' })).toBe('Free');
		expect(formatPrice({ amountMinor: 399, currency: 'GBP' }, 'en-GB')).toBe('£3.99');
		expect(formatPrice({ amountMinor: 1050, currency: 'EUR' }, 'en-GB')).toBe('€10.50');
		// Currencies without minor units still come from integers.
		expect(formatPrice({ amountMinor: 500, currency: 'JPY' }, 'en-GB')).toBe('JP¥500');
	});
});

describe('aiLabel', () => {
	it('labels AI use and stays quiet when there was none', () => {
		expect(aiLabel('generated')).toBe('AI-generated');
		expect(aiLabel('assisted')).toBe('AI-assisted');
		expect(aiLabel('none')).toBeNull();
	});
});

describe('reviewProgress (P1-STO-07)', () => {
	it('says how far the reviewer had read', () => {
		expect(reviewProgress(0.45)).toBe('Read 45% when reviewing');
		expect(reviewProgress(0.019)).toBe('Read 1% when reviewing');
		expect(reviewProgress(0.004)).toBe('Hadn’t started reading when reviewing');
		expect(reviewProgress(0.989)).toBe('Read 98% when reviewing');
		expect(reviewProgress(0.995)).toBe('Finished the book when reviewing');
		expect(reviewProgress(1)).toBe('Finished the book when reviewing');
	});
});
