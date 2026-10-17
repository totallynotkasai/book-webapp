import type {
	ContrastLevel,
	FontId,
	HighlightColour,
	ReaderPreferences,
	ThemeMode
} from '@book/core';

export * from './theme';
export * from './custom-colours';
export { AA_NON_TEXT, AA_TEXT, AAA_TEXT, isDarkColour, mixColours } from './colour';

export const themeModeLabels: Record<ThemeMode, string> = {
	system: 'System',
	light: 'Light',
	dark: 'Dark',
	sepia: 'Sepia',
	custom: 'Custom'
};

export const contrastLabels: Record<ContrastLevel, string> = {
	standard: 'Standard',
	medium: 'Medium',
	high: 'High'
};

/** Names for the five highlight colours (their hues are in `theme.ts`), for screen readers and filters. */
export const highlightLabels: Record<HighlightColour, string> = {
	1: 'Yellow',
	2: 'Green',
	3: 'Blue',
	4: 'Pink',
	5: 'Purple'
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

/**
 * Reading font stacks (§11.3), the same as tokens.css's --font-* tokens, as plain strings for the
 * reader's frames, which can't see the app's CSS. `publisher` keeps the EPUB's own fonts.
 */
export const fontStacks: Record<FontId, string | null> = {
	literata: "'Literata', Georgia, 'Times New Roman', serif",
	'source-serif-4': "'Source Serif 4', 'Source Serif Pro', Georgia, serif",
	merriweather: "'Merriweather', Georgia, serif",
	nunito: "'Nunito', system-ui, sans-serif",
	'atkinson-hyperlegible': "'Atkinson Hyperlegible', Verdana, sans-serif",
	opendyslexic: "'OpenDyslexic', 'Atkinson Hyperlegible', 'Comic Sans MS', sans-serif",
	publisher: null
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
