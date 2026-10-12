/**
 * Shared setup for component tests in jsdom (apps/web and packages/ui): jest-dom matchers and the few browser APIs jsdom lacks that Bits UI and our components use.
 */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/** Tests switch this to check reduced-motion behaviour (Invariant 12). */
export const media = { reducedMotion: false, dark: false };

if (typeof window !== 'undefined') {
	window.matchMedia = vi.fn((query: string) => {
		const matches =
			(query.includes('prefers-reduced-motion: reduce') && media.reducedMotion) ||
			(query.includes('prefers-color-scheme: dark') && media.dark);
		return {
			matches,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		} as MediaQueryList;
	});

	class ResizeObserverStub {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

	// Bits UI positions floating content and reads pointer capture; jsdom has neither.
	Element.prototype.scrollIntoView ??= function () {};
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.setPointerCapture ??= () => {};
	Element.prototype.releasePointerCapture ??= () => {};
	globalThis.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent;
}
