import { describe, expect, it } from 'vitest';
import { flagForRoute, isRouteEnabled, resolveFlags, resolveProfile } from './flags';

describe('profiles', () => {
	it('defaults to owner', () => {
		expect(resolveProfile(undefined)).toBe('owner');
		expect(resolveProfile('nonsense')).toBe('owner');
		expect(resolveProfile('tester')).toBe('tester');
	});

	it('gives owners every area', () => {
		expect(Object.values(resolveFlags('owner')).every(Boolean)).toBe(true);
	});

	it('gives testers only the reading experience by default', () => {
		expect(Object.values(resolveFlags('tester')).some(Boolean)).toBe(false);
	});

	it('lets a tester session add simulated areas, but never the dev panel', () => {
		const flags = resolveFlags('tester', 'store, community,devPanel');
		expect(flags).toEqual({
			store: true,
			studio: false,
			community: true,
			admin: false,
			devPanel: false
		});
	});
});

describe('route gating', () => {
	it('maps routes to the flag that guards them', () => {
		expect(flagForRoute('/dev')).toBe('devPanel');
		expect(flagForRoute('/store')).toBe('store');
		expect(flagForRoute('/book/[slug]')).toBe('store');
		expect(flagForRoute('/book/[slug]/community')).toBe('community');
		expect(flagForRoute('/studio/books/[bookId]')).toBe('studio');
		expect(flagForRoute('/admin/flags/[flagId]')).toBe('admin');
		expect(flagForRoute('/')).toBeUndefined();
		expect(flagForRoute('/read/[bookId]')).toBeUndefined();
		expect(flagForRoute('/developer')).toBeUndefined();
	});

	it('keeps the reader and Library open in every profile', () => {
		const tester = resolveFlags('tester');
		expect(isRouteEnabled('/', tester)).toBe(true);
		expect(isRouteEnabled('/read/[bookId]', tester)).toBe(true);
		expect(isRouteEnabled('/dev', tester)).toBe(false);
		expect(isRouteEnabled('/studio', tester)).toBe(false);
	});
});
