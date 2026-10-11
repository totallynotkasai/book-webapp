import type { Money } from '@book/core';

/** Price arithmetic in integer minor units (Invariant 17). Throws on mixed currencies. */
export function money(amountMinor: number, currency: string): Money {
	if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
		throw new RangeError(`Money must be a non-negative integer of minor units, got ${amountMinor}`);
	}
	if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError(`Not an ISO 4217 code: ${currency}`);
	return { amountMinor, currency };
}

export function isFree(price: Money): boolean {
	return price.amountMinor === 0;
}

export function addMoney(a: Money, b: Money): Money {
	if (a.currency !== b.currency) {
		throw new RangeError(`Cannot add ${a.currency} to ${b.currency}`);
	}
	return money(a.amountMinor + b.amountMinor, a.currency);
}

export function sumMoney(prices: readonly Money[], currency: string): Money {
	return prices.reduce(addMoney, money(0, currency));
}
