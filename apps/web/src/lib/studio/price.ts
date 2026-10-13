import type { Money } from '@book/core';

/**
 * A price typed by a creator ("2.49", "£2.49", "0") as integer minor units (Invariant 17), or
 * null when it isn't one. Two decimal places, as GBP has (SIMULATION: one currency until Phase 4).
 */
export function parsePrice(text: string, currency = 'GBP'): Money | null {
	const cleaned = text
		.trim()
		.replace(/^[£$€]/, '')
		.replace(/,/g, '');
	if (!/^\d{1,6}(\.\d{1,2})?$/.test(cleaned)) return null;
	const [whole, fraction = ''] = cleaned.split('.');
	return { amountMinor: Number(whole) * 100 + Number(fraction.padEnd(2, '0')), currency };
}

/** Minor units back to what the creator would type ("2.49"). */
export function priceText(price: Money): string {
	return `${Math.floor(price.amountMinor / 100)}.${String(price.amountMinor % 100).padStart(2, '0')}`;
}
