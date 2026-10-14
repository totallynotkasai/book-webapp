import { describe, expect, it } from 'vitest';
import {
	AREAS_KEY,
	areasFromLink,
	flagForRoute,
	isRouteEnabled,
	rememberAreas,
	resolveFlags,
	resolveProfile
} from './flags';

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

describe('facilitator links (D-031)', () => {
	const link = (query: string) => new URL(`https://example.test/book-webapp/${query}`);

	function memoryStorage(): Storage {
		const items = new Map<string, string>();
		return {
			get length() {
				return items.size;
			},
			clear: () => items.clear(),
			getItem: (key) => items.get(key) ?? null,
			key: (i) => [...items.keys()][i] ?? null,
			removeItem: (key) => void items.delete(key),
			setItem: (key, value) => void items.set(key, String(value))
		};
	}

	it('reads the areas a link asks for, in a fixed order, without the dev panel', () => {
		expect(areasFromLink(link('?areas=community,store'))).toBe('store,community');
		expect(areasFromLink(link('?areas=devPanel,admin,nonsense'))).toBe('admin');
		expect(areasFromLink(link('?areas=none'))).toBe('');
		expect(areasFromLink(link('?areas='))).toBe('');
		expect(areasFromLink(link(''))).toBeUndefined();
	});

	it('remembers them on the device and says when that changed anything', () => {
		const storage = memoryStorage();
		expect(rememberAreas(link('?areas=store'), storage)).toBe(true);
		expect(storage.getItem(AREAS_KEY)).toBe('store');
		expect(rememberAreas(link('?areas=store'), storage)).toBe(false);
		expect(rememberAreas(link('?other=1'), storage)).toBe(false);
		expect(storage.getItem(AREAS_KEY)).toBe('store');
		expect(rememberAreas(link('?areas=none'), storage)).toBe(true);
		expect(storage.getItem(AREAS_KEY)).toBe('');
	});

	it('turns the remembered areas into flags, never the dev panel', () => {
		expect(resolveFlags('tester', ',store,community').store).toBe(true);
		expect(resolveFlags('tester', ',store,community,devPanel').devPanel).toBe(false);
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

	it('ignores route groups such as (app)', () => {
		expect(flagForRoute('/(app)/store')).toBe('store');
		expect(flagForRoute('/(app)/admin/flags/[flagId]')).toBe('admin');
		expect(flagForRoute('/(app)/library')).toBeUndefined();
		expect(flagForRoute('/(app)')).toBeUndefined();
	});

	it('keeps the reader and Library open in every profile', () => {
		const tester = resolveFlags('tester');
		expect(isRouteEnabled('/', tester)).toBe(true);
		expect(isRouteEnabled('/read/[bookId]', tester)).toBe(true);
		expect(isRouteEnabled('/dev', tester)).toBe(false);
		expect(isRouteEnabled('/studio', tester)).toBe(false);
	});
});
