import type { EntitlementSource } from '@book/core';

/**
 * The Entitlements module: the only code that decides ownership (Invariant 15). Free Products
 * still need an Entitlement. Bundles and subscriptions (P1-STO-02, P1-STO-04) add rules here.
 */
export interface EntitlementRecord {
	id: string;
	userId: string;
	productId: string;
	source: EntitlementSource;
	grantedAt: string;
	/** Set when revoked (refund, or a subscription's paid period ending). */
	revokedAt: string | null;
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
