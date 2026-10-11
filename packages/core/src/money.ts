import { z } from 'zod';

/**
 * Money is integer minor units plus an ISO 4217 currency code, never floats (Invariant 17).
 * Arithmetic lives in `@book/domain`; formatting for display lives in the app.
 */
export const moneySchema = z.object({
	amountMinor: z.number().int().nonnegative(),
	currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. GBP')
});

export type Money = z.infer<typeof moneySchema>;
