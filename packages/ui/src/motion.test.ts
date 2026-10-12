import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { media } from '../../../tests/setup-dom';
import { motionDuration, prefersReducedMotion } from './motion';

const here = dirname(fileURLToPath(import.meta.url));
const components = readdirSync(here).filter((f) => f.endsWith('.svelte'));

/**
 * Reduced motion (Invariant 12) for every component: CSS motion may only use the `--duration-*`
 * tokens, which are 0 under `prefers-reduced-motion` (tokens.css), never a literal time.
 */
describe('reduced motion', () => {
	afterEach(() => {
		media.reducedMotion = false;
	});

	it.each(components)('%s times every transition and animation with duration tokens', (file) => {
		const source = readFileSync(join(here, file), 'utf8');
		const style = source.slice(source.indexOf('<style>'));
		const declarations = [...style.matchAll(/(?:transition|animation)(?:-duration)?:([^;]+);/g)]
			.map((m) => m[1]!)
			.join(',');
		// Strip token references, then no time literal (e.g. 200ms, 0.3s) may remain.
		const withoutTokens = declarations.replace(/var\(--duration-[a-z]+\)/g, '');
		expect(withoutTokens).not.toMatch(/(?<![\w-])\d*\.?\d+m?s\b/);
	});

	it('script-driven motion asks before animating', () => {
		expect(prefersReducedMotion()).toBe(false);
		expect(motionDuration(240)).toBe(240);
		media.reducedMotion = true;
		expect(prefersReducedMotion()).toBe(true);
		expect(motionDuration(240)).toBe(0);
	});
});
