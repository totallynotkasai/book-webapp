import { readFileSync } from 'node:fs';
import { fontIds } from '@book/core';
import { describe, expect, it } from 'vitest';
import { fontStacks } from './index';

describe('font stacks', () => {
	it('match the --font-* tokens in tokens.css', () => {
		const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
		for (const id of fontIds) {
			if (id === 'publisher') continue;
			const token = new RegExp(`--font-${id}: ([^;]+);`).exec(css)?.[1];
			expect(token, id).toBe(fontStacks[id]);
		}
		expect(fontStacks.publisher).toBeNull();
	});
});

describe('fonts.css', () => {
	it('has a value for every declaration scripts/write-fonts-css.mjs writes', () => {
		const css = readFileSync(new URL('./fonts.css', import.meta.url), 'utf8');
		expect(css).not.toMatch(/:\s*undefined\b/);
	});
});
