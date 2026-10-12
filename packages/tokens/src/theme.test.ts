import { contrastLevels, type ContrastLevel } from '@book/core';
import { describe, expect, it } from 'vitest';
import {
	contrastRatio,
	generateTheme,
	normaliseHex,
	PLACEHOLDER_SEED,
	resolveSchemeMode,
	seedPresets,
	TEXT_ROLE_PAIRS,
	themeFromPreferences,
	tokensToCss,
	type SchemeMode,
	type ThemeTokens
} from './theme';
import { defaultThemeCss } from './default-theme';

const modes: SchemeMode[] = ['light', 'dark'];
const AA = 4.5;

const role = (tokens: ThemeTokens, name: string) => {
	const value = tokens[`--md-sys-color-${name}`];
	if (!value) throw new Error(`No --md-sys-color-${name}`);
	return value;
};

/** Every combination Settings can produce from the presets (custom seeds are checked separately). */
const combinations = seedPresets.flatMap((preset) =>
	modes.flatMap((mode) =>
		contrastLevels.map((contrast) => ({ preset: preset.id, seed: preset.seed, mode, contrast }))
	)
);

describe('generateTheme (P1-UI-01)', () => {
	it('gives the same tokens for the same seed, mode and contrast', () => {
		const a = generateTheme({ seed: '#00696b', mode: 'dark', contrast: 'medium' });
		const b = generateTheme({ seed: '#00696B', mode: 'dark', contrast: 'medium' });
		expect(a).toEqual(b);
		expect(Object.keys(a).length).toBeGreaterThan(50);
	});

	it('names tokens after M3 roles, with shadow, scrim and five highlights', () => {
		const tokens = generateTheme({ seed: PLACEHOLDER_SEED, mode: 'light', contrast: 'standard' });
		for (const name of ['primary', 'on-surface', 'surface-container-high', 'outline', 'scrim']) {
			expect(role(tokens, name)).toMatch(/^#[0-9a-f]{6}$/);
		}
		for (const n of [1, 2, 3, 4, 5]) expect(role(tokens, `highlight-${n}`)).toMatch(/^#/);
	});

	it('changes with each input', () => {
		const base = { seed: PLACEHOLDER_SEED, mode: 'light', contrast: 'standard' } as const;
		const tokens = generateTheme(base);
		expect(generateTheme({ ...base, seed: '#9C4A2F' })).not.toEqual(tokens);
		expect(generateTheme({ ...base, mode: 'dark' })).not.toEqual(tokens);
		expect(generateTheme({ ...base, contrast: 'high' })).not.toEqual(tokens);
		expect(generateTheme({ ...base, sepia: true })['--reader-background']).not.toBe(
			tokens['--reader-background']
		);
	});

	it('rejects a seed that is not #rrggbb', () => {
		expect(() => generateTheme({ seed: 'teal', mode: 'light', contrast: 'standard' })).toThrow(
			RangeError
		);
	});

	describe.each(combinations)('$preset, $mode, $contrast', ({ seed, mode, contrast }) => {
		const tokens = generateTheme({ seed, mode, contrast });

		it('every text role meets WCAG AA on its surface', () => {
			const failures = TEXT_ROLE_PAIRS.filter(
				([text, surface]) => contrastRatio(role(tokens, text), role(tokens, surface)) < AA
			).map(([text, surface]) => `${text} on ${surface}`);
			expect(failures).toEqual([]);
		});

		it('text stays readable on every highlight colour', () => {
			for (const n of [1, 2, 3, 4, 5]) {
				const ratio = contrastRatio(role(tokens, 'on-surface'), role(tokens, `highlight-${n}`));
				expect(ratio, `highlight-${n}`).toBeGreaterThanOrEqual(AA);
			}
		});

		it.each([false, true])('the reader surface meets AA (sepia: %s)', (sepia) => {
			const reader = generateTheme({ seed, mode, contrast, sepia });
			expect(
				contrastRatio(reader['--reader-text']!, reader['--reader-background']!)
			).toBeGreaterThanOrEqual(AA);
			expect(
				contrastRatio(reader['--reader-text-muted']!, reader['--reader-background']!)
			).toBeGreaterThanOrEqual(AA);
			expect(
				contrastRatio(reader['--reader-text']!, reader['--reader-block-background']!)
			).toBeGreaterThanOrEqual(AA);
		});
	});

	it.each(['#ffff00', '#000000', '#ffffff', '#ff0000', '#00ff00', '#123456'])(
		'a custom seed %s still meets AA in every mode and contrast',
		(seed) => {
			for (const mode of modes) {
				for (const contrast of contrastLevels as readonly ContrastLevel[]) {
					const tokens = generateTheme({ seed, mode, contrast });
					const failures = TEXT_ROLE_PAIRS.filter(
						([text, surface]) => contrastRatio(role(tokens, text), role(tokens, surface)) < AA
					);
					expect(failures, `${mode} ${contrast}`).toEqual([]);
				}
			}
		}
	);
});

describe('theme helpers', () => {
	it('resolves system and sepia modes to a scheme', () => {
		expect(resolveSchemeMode('system', true)).toBe('dark');
		expect(resolveSchemeMode('system', false)).toBe('light');
		expect(resolveSchemeMode('sepia', true)).toBe('light');
		expect(resolveSchemeMode('dark', false)).toBe('dark');
	});

	it('reads the theme from Reader Preferences, with the placeholder seed by default', () => {
		expect(themeFromPreferences({ mode: 'sepia', contrast: 'high' }, true)).toEqual({
			seed: PLACEHOLDER_SEED,
			mode: 'light',
			contrast: 'high',
			sepia: true
		});
		expect(
			themeFromPreferences({ mode: 'dark', contrast: 'standard', seedColor: '#9c4a2f' }, false).seed
		).toBe('#9c4a2f');
	});

	it('measures contrast like WCAG', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
		expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
	});

	it('normalises colours typed or picked by the user', () => {
		expect(normaliseHex('#ABC')).toBe('#aabbcc');
		expect(normaliseHex(' #00696B ')).toBe('#00696b');
		expect(normaliseHex('teal')).toBeNull();
	});

	it('writes sorted CSS declarations', () => {
		expect(tokensToCss({ '--b': '2', '--a': '1' })).toBe('\t--a: 1;\n\t--b: 2;');
	});
});

describe('default theme CSS', () => {
	// The CSS the app paints before any script runs. `npx vitest -u` regenerates it.
	it('matches the generator', async () => {
		await expect(defaultThemeCss()).toMatchFileSnapshot('./default-theme.css');
	});
});
