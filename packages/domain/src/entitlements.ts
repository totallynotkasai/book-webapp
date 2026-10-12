import type { EntitlementSource } from '@book/core';

/**
 * The Entitlements module: the only code that decides ownership (Invariant 15). Free Products
 * still need an Entitlement. A Bundle grants a parent Entitlement and one per child (§6.5);
 * a subscription's benefits are Entitlements revoked at the end of its last paid period.
 */
export interface EntitlementRecord {
	id: string;
	userId: string;
	productId: string;
	source: EntitlementSource;
	grantedAt: string;
	/** Set when revoked (refund, or a subscription's paid period ending). */
	revokedAt: string | null;
	/** The Bundle Entitlement that granted this one. */
	parentId?: string | null;
	/** The order or subscription behind it, if any. */
	orderId?: string | null;
	subscriptionId?: string | null;
}

/** True if the Entitlement grants access at `at`. */
export function isActive(entitlement: EntitlementRecord, at: Date): boolean {
	const time = at.getTime();
	if (Date.parse(entitlement.grantedAt) > time) return false;
	return entitlement.revokedAt === null || Date.parse(entitlement.revokedAt) > time;
}

export function activeEntitlements(
	entitlements: readonly EntitlementRecord[],
	userId: string,
	at: Date
): EntitlementRecord[] {
	return entitlements.filter((e) => e.userId === userId && isActive(e, at));
}

/**
 * Refunding a Bundle (§6.5): the parent and every child it granted are revoked at `at`.
 * Returns the records to save; Entitlements from elsewhere (bought separately) are untouched.
 */
export function revokeWithChildren(
	entitlements: readonly EntitlementRecord[],
	parentId: string,
	at: Date
): EntitlementRecord[] {
	const when = at.toISOString();
	return entitlements
		.filter((e) => (e.id === parentId || e.parentId === parentId) && e.revokedAt === null)
		.map((e) => ({ ...e, revokedAt: when }));
}

/** The Products a user holds at `at`, for prices and offers. */
export function ownedProductIds(
	entitlements: readonly EntitlementRecord[],
	userId: string,
	at: Date
): Set<string> {
	return new Set(activeEntitlements(entitlements, userId, at).map((e) => e.productId));
}

/** `entitlements.check(userId, productId)` (§6.5). */
export function hasEntitlement(
	entitlements: readonly EntitlementRecord[],
	userId: string,
	productId: string,
	at: Date
): boolean {
	return entitlements.some(
		(e) => e.productId === productId && e.userId === userId && isActive(e, at)
	);
}
