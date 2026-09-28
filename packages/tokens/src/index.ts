import type { FontId, ReaderSettings, ThemeId } from '@book/core';

export const themeLabels: Record<ThemeId, string> = {
	light: 'Light',
	sepia: 'Sepia',
	dark: 'Dark',
	'high-contrast': 'High contrast'
};

export const fontLabels: Record<FontId, string> = {
	serif: 'Serif',
	sans: 'Sans-serif',
	dyslexic: 'Dyslexia-friendly'
};

/** Base reading size in rem, before the user's font scale is applied. */
const BASE_READER_SIZE = 1.125;

/**
 * Maps reader settings to token values. Applying them is left to the caller
 * (e.g. `element.style.setProperty`), so this stays usable outside the DOM.
 */
export function readerTokens(settings: ReaderSettings): Record<string, string> {
	return {
		'--reader-font': `var(--font-${settings.font})`,
		'--reader-size': `${BASE_READER_SIZE * settings.fontScale}rem`,
		'--reader-line-height': String(settings.lineHeight),
		'--reader-paragraph-spacing': `${settings.paragraphSpacing}em`,
		'--reader-margin': `${settings.margin}rem`,
		'--reader-align': settings.textAlign
	};
}
