import { describe, expect, it } from 'vitest';
import {
	clampFontScale,
	defaultReaderPreferences,
	mergePreferencesPatch,
	resolvePreferences
} from './preferences';

describe('defaultReaderPreferences (§9.4)', () => {
	it('matches the documented defaults', () => {
		expect(defaultReaderPreferences).toEqual({
			layout: 'auto',
			fontFamily: 'literata',
			fontScale: 1,
			lineHeight: 1.6,
			paragraphSpacing: 0.8,
			margins: 'normal',
			justify: false,
			hyphenate: false,
			theme: { mode: 'system', contrast: 'standard' },
			pageTurn: 'slide',
			illustrations: 'popup',
			narration: { rate: 1, autoTurn: true, highlight: 'word' },
			hintsSeen: [],
			hideAiGenerated: false
		});
	});
});

describe('resolvePreferences', () => {
	it('falls back to defaults when nothing is stored', () => {
		expect(resolvePreferences()).toEqual(defaultReaderPreferences);
		expect(resolvePreferences(undefined, null)).toEqual(defaultReaderPreferences);
	});

	it('layers global preferences, then the per-Book override', () => {
		const resolved = resolvePreferences(
			{ fontScale: 1.2, theme: { mode: 'dark' } },
			{ theme: { contrast: 'high' }, layout: 'scroll' }
		);
		expect(resolved.fontScale).toBe(1.2);
		expect(resolved.layout).toBe('scroll');
		expect(resolved.theme).toEqual({ mode: 'dark', contrast: 'high' });
		expect(resolved.fontFamily).toBe('literata');
	});

	it('drops invalid or outdated fields instead of failing', () => {
		const resolved = resolvePreferences({
			fontScale: 99,
			theme: { mode: 'high-contrast', seedColor: 'teal' },
			pageTurn: 'curl',
			layout: 'overview',
			narration: 'loud',
			unknownField: true
		});
		expect(resolved.fontScale).toBe(1);
		expect(resolved.theme).toEqual({ mode: 'system', contrast: 'standard' });
		expect(resolved.pageTurn).toBe('slide');
		expect(resolved.layout).toBe('auto');
		expect(resolved.narration).toEqual(defaultReaderPreferences.narration);
		expect(resolved).not.toHaveProperty('unknownField');
	});

	it('keeps a valid seed colour', () => {
		expect(resolvePreferences({ theme: { seedColor: '#1b6b6b' } }).theme.seedColor).toBe('#1b6b6b');
	});
});

describe('mergePreferencesPatch', () => {
	it('merges nested groups without dropping siblings', () => {
		const patch = mergePreferencesPatch(
			{ theme: { mode: 'dark' }, fontScale: 1.1 },
			{ theme: { contrast: 'medium' } }
		);
		expect(patch).toEqual({ theme: { mode: 'dark', contrast: 'medium' }, fontScale: 1.1 });
	});
});

describe('clampFontScale', () => {
	it('snaps to the 0.05 step inside 0.75–2.5', () => {
		expect(clampFontScale(1.234)).toBe(1.25);
		expect(clampFontScale(0.1)).toBe(0.75);
		expect(clampFontScale(9)).toBe(2.5);
	});
});
