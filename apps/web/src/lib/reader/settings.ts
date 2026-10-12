/**
 * Reader Preferences → what the engine needs (§9.4): typography, the layout `auto` resolves to,
 * the page turn under reduced motion (Invariant 12), and the reading surface's theme tokens.
 */
import type { LayoutMode, ReaderPreferences } from '@book/core';
import type { PageTurn, ReaderThemeTokens, TypographySettings } from '@book/reader-core';
import { fontStacks, generateTheme, themeFromPreferences } from '@book/tokens';

export function typographyOf(prefs: ReaderPreferences): TypographySettings {
	return {
		fontFamily: fontStacks[prefs.fontFamily],
		fontScale: prefs.fontScale,
		lineHeight: prefs.lineHeight,
		paragraphSpacing: prefs.paragraphSpacing,
		margins: prefs.margins,
		justify: prefs.justify,
		hyphenate: prefs.hyphenate
	};
}

/** Spread is offered from 1024 px wide (§9.2); `auto` uses it on wide landscape windows. */
export const SPREAD_MIN_WIDTH = 1024;

export function layoutOf(prefs: ReaderPreferences, width: number, height: number): LayoutMode {
	if (prefs.layout === 'paginated-spread' && width < SPREAD_MIN_WIDTH) return 'paginated-single';
	if (prefs.layout !== 'auto') return prefs.layout;
	return width >= SPREAD_MIN_WIDTH && width > height ? 'paginated-spread' : 'paginated-single';
}

export function pageTurnOf(prefs: ReaderPreferences, reducedMotion: boolean): PageTurn {
	return reducedMotion ? 'none' : prefs.pageTurn;
}

/** The reading surface's colours: the Book's own theme overrides apply here, not app-wide. */
export function themeTokensOf(prefs: ReaderPreferences, systemDark: boolean): ReaderThemeTokens {
	return generateTheme(themeFromPreferences(prefs.theme, systemDark));
}
