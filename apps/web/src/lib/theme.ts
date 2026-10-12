/**
 * Applies the generated theme (DESIGN.md §11.2) to the document. Generation is pure and lives in
 * `@book/tokens`; this is the one place the app writes it to the DOM.
 *
 * The tokens are also cached in localStorage so `app.html` can paint the user's colours on the
 * next launch before any script has loaded (no flash of the default theme). The cache is only a
 * paint hint: Reader Preferences in `Stores` stay the source of truth.
 */
import { generateTheme, type ThemeInput, type ThemeTokens } from '@book/tokens';

export const THEME_CACHE_KEY = 'book-theme';

let applied: string | undefined;

export function applyTheme(input: ThemeInput, root: HTMLElement = document.documentElement) {
	const key = JSON.stringify(input);
	if (key === applied) return;
	applied = key;
	const tokens = generateTheme(input);
	for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
	root.style.colorScheme = input.mode;
	root.dataset.scheme = input.mode;
	if (input.sepia) root.dataset.sepia = '';
	else delete root.dataset.sepia;
	cacheTheme(tokens, input.mode);
}

function cacheTheme(tokens: ThemeTokens, mode: ThemeInput['mode']) {
	try {
		localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ mode, tokens }));
	} catch {
		// Storage can be full or disabled; the default theme paints first instead.
	}
}
