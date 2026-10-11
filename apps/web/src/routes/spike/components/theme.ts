/**
 * SPIKE P0-10: throwaway theme generation for the component spike. P1-UI-01 builds the real,
 * pure generator in `packages/tokens` (DESIGN.md §11.2); this file is deleted with the spike.
 *
 * seed + mode + contrast → a map of M3 role tokens named `--md-sys-color-<role>`.
 */
import {
	Hct,
	MaterialDynamicColors,
	SchemeTonalSpot,
	argbFromHex,
	hexFromArgb
} from '@material/material-color-utilities';

/**
 * SIMULATION: placeholder brand seed, a deep teal (OPEN-07 picks the real one; never M3's
 * baseline purple #6750A4). Not a decision.
 */
export const PLACEHOLDER_SEED = '#1b6b6b';

export type SpikeMode = 'light' | 'dark';
export type SpikeContrast = 'standard' | 'medium' | 'high';

/** M3 contrast levels: 0 standard, 0.5 medium, 1 high. */
export const CONTRAST_LEVEL: Record<SpikeContrast, number> = {
	standard: 0,
	medium: 0.5,
	high: 1
};

const colors = new MaterialDynamicColors();

export type RoleTokens = Record<`--md-sys-color-${string}`, string>;

export function generateRoleTokens(
	seedHex: string,
	mode: SpikeMode,
	contrast: SpikeContrast
): RoleTokens {
	const scheme = new SchemeTonalSpot(
		Hct.fromInt(argbFromHex(seedHex)),
		mode === 'dark',
		CONTRAST_LEVEL[contrast]
	);
	const tokens: RoleTokens = {};
	// `allColors` leaves out shadow and scrim, which sheets and menus need.
	for (const color of [...colors.allColors, colors.shadow(), colors.scrim()]) {
		tokens[`--md-sys-color-${color.name.replaceAll('_', '-')}`] = hexFromArgb(
			color.getArgb(scheme)
		);
	}
	return tokens;
}

/** Inline-style string for an element, e.g. `style={toStyle(tokens)}`. */
export function toStyle(tokens: RoleTokens): string {
	return Object.entries(tokens)
		.map(([name, value]) => `${name}: ${value}`)
		.join('; ');
}

/** WCAG relative-luminance contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
	const luminance = (hex: string) => {
		const [r, g, b] = [1, 3, 5].map((i) => {
			const c = parseInt(hex.slice(i, i + 2), 16) / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}
