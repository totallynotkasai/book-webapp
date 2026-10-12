import { describe, expect, it } from 'vitest';
import {
	defaultIllustrationPackIds,
	usableIllustrationPackIds,
	activeEntitlements,
	addMoney,
	can,
	hasEntitlement,
	isActive,
	isFree,
	money,
	sumMoney,
	type EntitlementRecord
} from './index';

describe('money (Invariant 17)', () => {
	it('accepts integer minor units with an ISO 4217 code', () => {
		expect(money(499, 'GBP')).toEqual({ amountMinor: 499, currency: 'GBP' });
		expect(isFree(money(0, 'GBP'))).toBe(true);
	});

	it('rejects floats, negatives and bad codes', () => {
		expect(() => money(4.99, 'GBP')).toThrow(RangeError);
		expect(() => money(-1, 'GBP')).toThrow(RangeError);
		expect(() => money(100, 'gbp')).toThrow(RangeError);
	});

	it('adds only within one currency', () => {
		expect(addMoney(money(199, 'GBP'), money(300, 'GBP'))).toEqual(money(499, 'GBP'));
		expect(() => addMoney(money(1, 'GBP'), money(1, 'USD'))).toThrow(RangeError);
		expect(sumMoney([money(1, 'EUR'), money(2, 'EUR')], 'EUR')).toEqual(money(3, 'EUR'));
		expect(sumMoney([], 'EUR')).toEqual(money(0, 'EUR'));
	});
});

describe('entitlements (Invariant 15)', () => {
	const grant: EntitlementRecord = {
		id: 'e1',
		userId: 'reader',
		productId: 'book-alice',
		source: 'grant',
		grantedAt: '2026-10-01T00:00:00.000Z',
		revokedAt: null
	};
	const revoked: EntitlementRecord = {
		...grant,
		id: 'e2',
		productId: 'book-serial',
		source: 'subscription',
		revokedAt: '2026-11-01T00:00:00.000Z'
	};
	const all = [grant, revoked];

	it('is active from grant until revocation', () => {
		expect(isActive(grant, new Date('2026-09-30T23:59:59Z'))).toBe(false);
		expect(isActive(grant, new Date('2026-10-01T00:00:00Z'))).toBe(true);
		expect(isActive(revoked, new Date('2026-10-31T23:59:59Z'))).toBe(true);
		expect(isActive(revoked, new Date('2026-11-01T00:00:00Z'))).toBe(false);
	});

	it('checks ownership per user and Product', () => {
		const at = new Date('2026-10-15T00:00:00Z');
		expect(hasEntitlement(all, 'reader', 'book-alice', at)).toBe(true);
		expect(hasEntitlement(all, 'author', 'book-alice', at)).toBe(false);
		expect(hasEntitlement(all, 'reader', 'book-other', at)).toBe(false);
		expect(activeEntitlements(all, 'reader', new Date('2026-12-01T00:00:00Z'))).toEqual([grant]);
	});
});

describe('roles', () => {
	it('lets only Creators and admins into the Studio', () => {
		expect(can('creator', 'studio')).toBe(true);
		expect(can('admin', 'studio')).toBe(true);
		expect(can('reader', 'studio')).toBe(false);
		expect(can('moderator', 'studio')).toBe(false);
		expect(can(undefined, 'studio')).toBe(false);
	});

	it('lets only moderators and admins moderate', () => {
		expect(can('moderator', 'moderation')).toBe(true);
		expect(can('creator', 'moderation')).toBe(false);
	});
});

describe('Layer selection (§8.1)', () => {
	const layers = [
		{ id: 'community', isOfficial: false, entitled: true },
		{ id: 'official', isOfficial: true, entitled: true },
		{ id: 'official-not-owned', isOfficial: true, entitled: false }
	];

	it('starts with every official pack the reader is entitled to', () => {
		expect(defaultIllustrationPackIds(layers)).toEqual(['official']);
	});

	it('keeps a saved order but drops packs the reader can no longer use', () => {
		expect(
			usableIllustrationPackIds(['community', 'gone', 'official-not-owned', 'official'], layers)
		).toEqual(['community', 'official']);
	});
});
