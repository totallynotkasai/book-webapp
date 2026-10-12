import type { ContrastLevel, FontId, ReaderPreferences, ThemeMode } from '@book/core';

export * from './theme';

export const themeModeLabels: Record<ThemeMode, string> = {
	system: 'System',
	light: 'Light',
	dark: 'Dark',
	sepia: 'Sepia'
};

export const contrastLabels: Record<ContrastLevel, string> = {
	standard: 'Standard',
	medium: 'Medium',
	high: 'High'
};

export const fontLabels: Record<FontId, string> = {
	literata: 'Literata',
	'source-serif-4': 'Source Serif',
	merriweather: 'Merriweather',
	nunito: 'Nunito',
	'atkinson-hyperlegible': 'Atkinson Hyperlegible',
	opendyslexic: 'OpenDyslexic',
	publisher: 'Publisher default'
};

/** Base reading size in rem, before the user's font scale is applied. */
const BASE_READER_SIZE = 1.125;

const MARGINS: Record<ReaderPreferences['margins'], string> = {
	narrow: '1rem',
	normal: '2rem',
	wide: '3.5rem'
};

/**
 * Maps Reader Preferences to token values. Applying them is left to the caller
 * (e.g. `element.style.setProperty`), so this stays usable outside the DOM.
 */
export function readerTokens(preferences: ReaderPreferences): Record<string, string> {
	return {
		'--reader-font': `var(--font-${preferences.fontFamily})`,
		'--reader-size': `${BASE_READER_SIZE * preferences.fontScale}rem`,
		'--reader-line-height': String(preferences.lineHeight),
		'--reader-paragraph-spacing': `${preferences.paragraphSpacing}em`,
		'--reader-margin': MARGINS[preferences.margins],
		'--reader-align': preferences.justify ? 'justify' : 'start',
		'--reader-hyphens': preferences.hyphenate ? 'auto' : 'manual'
	};
}
