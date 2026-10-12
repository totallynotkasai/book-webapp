// SPIKE P0-10: checks the spike's generated theme is usable; deleted with the spike.
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_SEED, contrastRatio, generateRoleTokens } from './theme';

describe('spike theme generation', () => {
	it('emits every M3 role the components use as --md-sys-color-*', () => {
		const tokens = generateRoleTokens(PLACEHOLDER_SEED, 'light', 'standard');
		for (const role of [
			'primary',
			'on-primary',
			'secondary-container',
			'on-secondary-container',
			'surface',
			'surface-container',
			'surface-container-low',
			'on-surface',
			'on-surface-variant',
			'outline',
			'inverse-surface',
			'scrim'
		]) {
			expect(tokens[`--md-sys-color-${role}`]).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it('differs by mode and by contrast level', () => {
		const light = generateRoleTokens(PLACEHOLDER_SEED, 'light', 'standard');
		const dark = generateRoleTokens(PLACEHOLDER_SEED, 'dark', 'standard');
		const high = generateRoleTokens(PLACEHOLDER_SEED, 'light', 'high');
		expect(dark['--md-sys-color-surface']).not.toBe(light['--md-sys-color-surface']);
		expect(high['--md-sys-color-primary']).not.toBe(light['--md-sys-color-primary']);
	});

	it('meets AA for text roles, and AAA at high contrast', () => {
		for (const mode of ['light', 'dark'] as const) {
			const standard = generateRoleTokens(PLACEHOLDER_SEED, mode, 'standard');
			const high = generateRoleTokens(PLACEHOLDER_SEED, mode, 'high');
			for (const [fg, bg] of [
				['on-primary', 'primary'],
				['on-surface', 'surface'],
				['on-secondary-container', 'secondary-container']
			]) {
				const ratio = (t: typeof standard) =>
					contrastRatio(t[`--md-sys-color-${fg}`], t[`--md-sys-color-${bg}`]);
				expect(ratio(standard)).toBeGreaterThanOrEqual(4.5);
				expect(ratio(high)).toBeGreaterThanOrEqual(7);
			}
		}
	});
});
