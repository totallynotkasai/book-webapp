import { Hct, argbFromHex } from '@material/material-color-utilities';
import { describe, expect, it } from 'vitest';
import { AA_NON_TEXT, AA_TEXT, contrastRatio } from './colour';
import {
	contrastGrade,
	customColourSuggestions,
	customReaderTokens,
	formatRatio,
	nearestReadableColour,
	readablePair
} from './custom-colours';
import { generateTheme, PLACEHOLDER_SEED, TEXT_ROLE_PAIRS, themeFromPreferences } from './theme';

const HUES = [90, 145, 245, 0, 300];
const hue = (hex: string) => Hct.fromInt(argbFromHex(hex)).hue;

/** A fixed pseudo-random sequence, so the sweep is the same on every run. */
function* colours(count: number, seed = 7): Generator<string> {
	let x = seed;
	for (let i = 0; i < count; i++) {
		x = (x * 1103515245 + 12345) % 2 ** 31;
		yield `#${(x % 0x1000000).toString(16).padStart(6, '0')}`;
	}
}

/** Every derived colour a styled block or a highlight puts text on, or next to (§9.6). */
function derivedProblems(page: string, text: string, floor: number): string[] {
	const t = customReaderTokens({ page, text }, PLACEHOLDER_SEED, HUES);
	const problems: string[] = [];
	const check = (what: string, ratio: number, min: number) => {
		if (ratio < min - 1e-9) problems.push(`${what} ${ratio.toFixed(2)} < ${min}`);
	};
	check('muted text', contrastRatio(t['--reader-text-muted']!, page), floor);
	check('text on a styled block', contrastRatio(text, t['--reader-block-background']!), floor);
	check('link', contrastRatio(t['--reader-link']!, page), AA_TEXT);
	check(
		'block border',
		contrastRatio(t['--reader-block-border']!, page),
		Math.min(AA_NON_TEXT, floor)
	);
	for (let n = 1; n <= 5; n++) {
		check(
			`text on highlight ${n}`,
			contrastRatio(text, t[`--md-sys-color-highlight-${n}`]!),
			floor
		);
	}
	return problems;
}

describe('nearestReadableColour (P1-UI-04)', () => {
	it('leaves a readable colour as it is', () => {
		expect(nearestReadableColour('#F3EAD3', '#1f3d2b')).toBe('#f3ead3');
	});

	it('moves a colour just far enough, keeping its hue', () => {
		const fixed = nearestReadableColour('#4f7a5f', '#1f3d2b');
		expect(contrastRatio(fixed, '#1f3d2b')).toBeGreaterThanOrEqual(AA_TEXT);
		expect(contrastRatio(fixed, '#1f3d2b')).toBeLessThan(5.2);
		expect(Math.abs(hue(fixed) - hue('#4f7a5f'))).toBeLessThan(6);
	});

	it('goes whichever way is nearer', () => {
		// Mid grey on white is nearer to reading darker than to reading lighter than white.
		const darker = nearestReadableColour('#999999', '#ffffff');
		expect(contrastRatio(darker, '#ffffff')).toBeGreaterThanOrEqual(AA_TEXT);
		expect(Hct.fromInt(argbFromHex(darker)).tone).toBeLessThan(60);
		const lighter = nearestReadableColour('#3a3a3a', '#000000');
		expect(Hct.fromInt(argbFromHex(lighter)).tone).toBeGreaterThan(40);
	});

	it('always finds one, even on a mid-grey page', () => {
		for (const colour of colours(200)) {
			for (const page of ['#777777', '#767676', '#808080', colour]) {
				const fixed = nearestReadableColour(colour, page);
				expect(contrastRatio(fixed, page), `${colour} on ${page}`).toBeGreaterThanOrEqual(AA_TEXT);
			}
		}
	});

	it('fixes the colour the reader changed last', () => {
		const pair = { page: '#2e4a3a', text: '#5c7a68' };
		const text = readablePair(pair, 'text');
		expect(text.page).toBe(pair.page);
		expect(contrastRatio(text.text, text.page)).toBeGreaterThanOrEqual(AA_TEXT);
		const page = readablePair(pair, 'page');
		expect(page.text).toBe(pair.text);
		expect(contrastRatio(page.text, page.page)).toBeGreaterThanOrEqual(AA_TEXT);
	});
});

describe('contrast check', () => {
	it('grades a ratio against WCAG', () => {
		expect(contrastGrade(4.49)).toBe('fail');
		expect(contrastGrade(4.5)).toBe('aa');
		expect(contrastGrade(7)).toBe('aaa');
	});

	it('never rounds a ratio up to a pass', () => {
		expect(formatRatio(4.4999)).toBe('4.49:1');
		expect(formatRatio(4.5)).toBe('4.5:1');
		expect(formatRatio(21)).toBe('21:1');
		expect(formatRatio(contrastRatio('#777777', '#ffffff'))).toBe('4.47:1');
	});
});

describe('customReaderTokens: styled blocks stay readable (§9.6)', () => {
	it.each([
		['dark green and cream', '#1f3d2b', '#f3ead3'],
		['white and the lightest AA grey', '#ffffff', '#767676'],
		['mid grey and black', '#777777', '#000000'],
		['black and white', '#000000', '#ffffff'],
		['white and black', '#ffffff', '#000000'],
		['blue and white', '#0000ff', '#ffffff'],
		['yellow and black', '#ffff00', '#000000'],
		['pale pink and plum', '#fbe3ea', '#5a1f3c']
	])('%s', (_, page, text) => {
		expect(derivedProblems(page, text, AA_TEXT)).toEqual([]);
		const t = customReaderTokens({ page, text }, PLACEHOLDER_SEED, HUES);
		expect(t['--reader-background']).toBe(page);
		expect(t['--reader-text']).toBe(text);
	});

	it.each(customColourSuggestions)('the suggestion $label', ({ page, text }) => {
		expect(contrastRatio(text, page)).toBeGreaterThanOrEqual(7);
		expect(derivedProblems(page, text, AA_TEXT)).toEqual([]);
	});

	it('holds for 400 random pairs that meet AA', () => {
		let tried = 0;
		const pages = [...colours(400, 11)];
		const texts = [...colours(400, 23)];
		pages.forEach((page, i) => {
			const text = nearestReadableColour(texts[i]!, page);
			tried++;
			expect(derivedProblems(page, text, AA_TEXT), `${text} on ${page}`).toEqual([]);
		});
		expect(tried).toBe(400);
	});

	it('keeps a pair kept below AA at least as readable on blocks and highlights', () => {
		for (const [page, text] of [
			['#777777', '#999999'],
			['#1f3d2b', '#3d6b50'],
			['#ffffff', '#cccccc']
		] as const) {
			const floor = contrastRatio(text, page);
			expect(floor).toBeLessThan(AA_TEXT);
			expect(derivedProblems(page, text, floor), `${text} on ${page}`).toEqual([]);
		}
	});
});

describe('the Custom theme mode', () => {
	const custom = { page: '#1f3d2b', text: '#f3ead3' };

	it('takes the scheme that suits the page', () => {
		const dark = themeFromPreferences({ mode: 'custom', contrast: 'standard', custom }, false);
		expect(dark).toEqual({
			seed: PLACEHOLDER_SEED,
			mode: 'dark',
			contrast: 'standard',
			sepia: false,
			custom
		});
		const light = themeFromPreferences(
			{ mode: 'custom', contrast: 'standard', custom: { page: '#f3ead3', text: '#1f3d2b' } },
			true
		);
		expect(light.mode).toBe('light');
	});

	it('follows the device until there is a pair, and ignores a pair in other modes', () => {
		expect(themeFromPreferences({ mode: 'custom', contrast: 'high' }, true).mode).toBe('dark');
		const sepia = themeFromPreferences({ mode: 'sepia', contrast: 'standard', custom }, false);
		expect(sepia.custom).toBeUndefined();
		expect(sepia.mode).toBe('light');
	});

	it('paints the reading page in the pair and leaves the app’s roles readable', () => {
		const tokens = generateTheme(
			themeFromPreferences({ mode: 'custom', contrast: 'standard', custom }, false)
		);
		expect(tokens['--reader-background']).toBe('#1f3d2b');
		expect(tokens['--reader-text']).toBe('#f3ead3');
		for (const [text, surface] of TEXT_ROLE_PAIRS) {
			expect(
				contrastRatio(tokens[`--md-sys-color-${text}`]!, tokens[`--md-sys-color-${surface}`]!),
				`${text} on ${surface}`
			).toBeGreaterThanOrEqual(AA_TEXT);
		}
	});
});
