/**
 * Theme generation (docs/DESIGN.md §11.2): seed colour + mode + contrast → token map.
 *
 * Pure and deterministic, so it gives the same tokens in every browser, in Node and in tests.
 * Token names follow Material 3 roles (`--md-sys-color-primary`, `--md-sys-color-on-surface`, …),
 * plus five highlight colours per scheme so Annotations stay legible in dark mode, and the reader
 * surface (`--reader-*`), which is where sepia lives: sepia is a reader-surface override on the
 * light scheme, not a scheme of its own.
 */
import {
	Hct,
	MaterialDynamicColors,
	SchemeTonalSpot,
	argbFromHex,
	hexFromArgb,
	type DynamicScheme
} from '@material/material-color-utilities';
import type { ContrastLevel, CustomColours, ReaderPreferences, ThemeMode } from '@book/core';
import { isDarkColour } from './colour';
import { customReaderTokens } from './custom-colours';

export { contrastRatio, normaliseHex } from './colour';

/**
 * Placeholder brand seed: a deep teal, chosen by the owner on 12 October 2026 until the product
 * is named (OPEN-07 stays open). Never M3's baseline purple #6750A4 (§11.2).
 */
export const PLACEHOLDER_SEED = '#00696B';

/** The presets Settings → Appearance offers, plus a custom colour (IMPLEMENTATION-PLAN.md §6). */
export const seedPresets = [
	{ id: 'teal', label: 'Teal', seed: PLACEHOLDER_SEED },
	{ id: 'ink', label: 'Ink blue', seed: '#2B4F8C' },
	{ id: 'forest', label: 'Forest', seed: '#2E6B3F' },
	{ id: 'terracotta', label: 'Terracotta', seed: '#9C4A2F' },
	{ id: 'plum', label: 'Plum', seed: '#6E3B6E' },
	{ id: 'ochre', label: 'Ochre', seed: '#8A6A12' },
	{ id: 'rose', label: 'Rose', seed: '#9A3B5A' },
	{ id: 'slate', label: 'Slate', seed: '#4A5A6A' }
] as const;

/** The light or dark scheme actually drawn: `system` and `sepia` resolve to one of these. */
export type SchemeMode = 'light' | 'dark';

export interface ThemeInput {
	seed: string;
	mode: SchemeMode;
	contrast: ContrastLevel;
	/** Sepia reading surface over the light scheme. Ignored in dark mode. */
	sepia?: boolean;
	/**
	 * The reader's own page and text colours (P1-UI-04): the reading surface, over the light or
	 * dark scheme that suits the page (`mode`). The rest of the app keeps the seed's colours.
	 */
	custom?: CustomColours;
}

/** M3 contrast levels: 0 standard, 0.5 medium, 1 high. */
export const CONTRAST_LEVEL: Record<ContrastLevel, number> = {
	standard: 0,
	medium: 0.5,
	high: 1
};

export type ThemeTokens = Record<`--${string}`, string>;

const HEX = /^#[0-9a-f]{6}$/i;
const colors = new MaterialDynamicColors();

/** Highlight hues: yellow, green, blue, pink, violet (HCT hue degrees). */
const HIGHLIGHT_HUES = [90, 145, 245, 0, 300] as const;

/** Colour roles that carry text, with the surface they sit on (checked for WCAG AA in tests). */
export const TEXT_ROLE_PAIRS = [
	['on-primary', 'primary'],
	['on-primary-container', 'primary-container'],
	['on-secondary', 'secondary'],
	['on-secondary-container', 'secondary-container'],
	['on-tertiary', 'tertiary'],
	['on-tertiary-container', 'tertiary-container'],
	['on-error', 'error'],
	['on-error-container', 'error-container'],
	['on-surface', 'surface'],
	['on-surface', 'surface-container-lowest'],
	['on-surface', 'surface-container-low'],
	['on-surface', 'surface-container'],
	['on-surface', 'surface-container-high'],
	['on-surface', 'surface-container-highest'],
	['on-surface-variant', 'surface'],
	['on-surface-variant', 'surface-container'],
	['on-surface-variant', 'surface-container-highest'],
	['on-background', 'background'],
	['inverse-on-surface', 'inverse-surface'],
	['primary', 'surface'],
	['error', 'surface']
] as const;

function schemeFor(seed: string, mode: SchemeMode, contrast: ContrastLevel): DynamicScheme {
	if (!HEX.test(seed)) throw new RangeError(`Seed must be #rrggbb, got ${seed}`);
	return new SchemeTonalSpot(
		Hct.fromInt(argbFromHex(seed)),
		mode === 'dark',
		CONTRAST_LEVEL[contrast]
	);
}

/** A colour at a hue, chroma and tone, as `#rrggbb`. */
function hct(hue: number, chroma: number, tone: number): string {
	return hexFromArgb(Hct.from(hue, chroma, tone).toInt());
}

/** Tones for the highlight swatches: pale under dark text in light mode, deep under light text in dark. */
const HIGHLIGHT_TONE: Record<SchemeMode, Record<ContrastLevel, number>> = {
	light: { standard: 88, medium: 90, high: 94 },
	dark: { standard: 32, medium: 28, high: 22 }
};

/** Sepia reading surface: warm paper and brown ink, darker ink at higher contrast. */
const SEPIA = {
	hue: 75,
	background: { standard: 93, medium: 93, high: 95 },
	text: { standard: 18, medium: 14, high: 8 },
	muted: { standard: 40, medium: 30, high: 18 }
} as const;

/**
 * Generates every colour token for one scheme. Same input, same output (DESIGN.md P1-UI-01).
 */
export function generateTheme(input: ThemeInput): ThemeTokens {
	const scheme = schemeFor(input.seed, input.mode, input.contrast);
	const tokens: ThemeTokens = {};
	// `allColors` leaves out shadow and scrim, which sheets and menus need.
	for (const color of [...colors.allColors, colors.shadow(), colors.scrim()]) {
		tokens[`--md-sys-color-${color.name.replaceAll('_', '-')}`] = hexFromArgb(
			color.getArgb(scheme)
		);
	}
	const tone = HIGHLIGHT_TONE[input.mode][input.contrast];
	HIGHLIGHT_HUES.forEach((hue, i) => {
		tokens[`--md-sys-color-highlight-${i + 1}`] = hct(hue, 48, tone);
	});

	// The reader surface follows the scheme, except sepia, which tints the light one.
	const sepia = input.sepia && input.mode === 'light';
	const get = (role: string) => tokens[`--md-sys-color-${role}`]!;
	tokens['--reader-background'] = sepia
		? hct(SEPIA.hue, 14, SEPIA.background[input.contrast])
		: get('surface');
	tokens['--reader-text'] = sepia
		? hct(SEPIA.hue, 18, SEPIA.text[input.contrast])
		: get('on-surface');
	tokens['--reader-text-muted'] = sepia
		? hct(SEPIA.hue, 16, SEPIA.muted[input.contrast])
		: get('on-surface-variant');
	// Styled blocks (§9.6): author backgrounds, borders and text map onto these.
	tokens['--reader-block-background'] = sepia
		? hct(SEPIA.hue, 16, SEPIA.background[input.contrast] - 6)
		: get('surface-container');
	tokens['--reader-block-border'] = sepia ? hct(SEPIA.hue, 18, 45) : get('outline');
	tokens['--reader-link'] = get('primary');
	// Custom colours (P1-UI-04) replace the reading surface and the highlights under its text.
	if (input.custom)
		Object.assign(tokens, customReaderTokens(input.custom, input.seed, HIGHLIGHT_HUES));
	return tokens;
}

/**
 * `system` follows the device; `sepia` is the light scheme with a sepia reading surface;
 * `custom` is the scheme that suits the reader's page colour (`system` until there is one).
 */
export function resolveSchemeMode(
	mode: ThemeMode,
	systemPrefersDark: boolean,
	custom?: CustomColours
): SchemeMode {
	if (mode === 'custom' && custom) return isDarkColour(custom.page) ? 'dark' : 'light';
	if (mode === 'system' || mode === 'custom') return systemPrefersDark ? 'dark' : 'light';
	return mode === 'dark' ? 'dark' : 'light';
}

/** The theme a user's Reader Preferences ask for. */
export function themeFromPreferences(
	theme: ReaderPreferences['theme'],
	systemPrefersDark: boolean
): ThemeInput {
	const custom = theme.mode === 'custom' ? theme.custom : undefined;
	return {
		seed: theme.seedColor ?? PLACEHOLDER_SEED,
		mode: resolveSchemeMode(theme.mode, systemPrefersDark, custom),
		contrast: theme.contrast,
		sepia: theme.mode === 'sepia',
		...(custom && { custom })
	};
}

/** CSS declarations for a token map, e.g. inside `:root { … }`. Sorted, so output is stable. */
export function tokensToCss(tokens: ThemeTokens, indent = '\t'): string {
	return Object.keys(tokens)
		.sort()
		.map((name) => `${indent}${name}: ${tokens[name as keyof ThemeTokens]};`)
		.join('\n');
}
