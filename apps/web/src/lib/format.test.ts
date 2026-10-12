import { describe, expect, it } from 'vitest';
import { aiLabel, formatPrice } from './format';

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
