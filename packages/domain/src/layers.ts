/**
 * Layer selection rules (DESIGN.md §8.1), shared by the reader and, from Phase 2, the API.
 */

export interface SelectableLayer {
	id: string;
	isOfficial: boolean;
	entitled: boolean;
}

/**
 * The Illustration Packs a reader starts with on first opening a Book: every official one they
 * hold an Entitlement to, in the order listed. (Narration waits for play, Invariant 11.)
 */
export function defaultIllustrationPackIds(layers: readonly SelectableLayer[]): string[] {
	return layers.filter((l) => l.isOfficial && l.entitled).map((l) => l.id);
}

/**
 * A saved selection, kept to packs the reader may still use: unknown or no-longer-entitled packs
 * drop out (Entitlements can be revoked), and the saved priority order is kept.
 */
export function usableIllustrationPackIds(
	saved: readonly string[],
	layers: readonly SelectableLayer[]
): string[] {
	const entitled = new Set(layers.filter((l) => l.entitled).map((l) => l.id));
	return [...new Set(saved)].filter((id) => entitled.has(id));
}
