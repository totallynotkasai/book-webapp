/**
 * Motion helpers (DESIGN.md Invariant 12). CSS motion uses the `--duration-*` tokens, which drop
 * to 0 under `prefers-reduced-motion`; script-driven motion asks here first.
 */
export function prefersReducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A duration in ms, or 0 when the reader prefers reduced motion. */
export function motionDuration(ms: number): number {
	return prefersReducedMotion() ? 0 : ms;
}

let nextId = 0;
/** A unique, stable-per-instance ID for label and description wiring. */
export function uid(prefix = 'ui'): string {
	return `${prefix}-${++nextId}`;
}
