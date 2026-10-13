/**
 * Idempotency keys for purchases, subscriptions and Tips (P1-STO-02, DESIGN.md §10.1): one per
 * attempt, so pressing "Pay" twice buys once, and a new attempt after a decline is a new payment.
 */
export function newKey(): string {
	return crypto.randomUUID();
}
