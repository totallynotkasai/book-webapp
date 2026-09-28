import 'fake-indexeddb/auto';
import type { Locator, Stores } from '@book/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalStores } from './index';

const locator: Locator = {
	editionId: 'ed1',
	cfi: 'epubcfi(/6/4!/4/2)',
	paragraphId: 'p1',
	paragraphIndex: 1,
	charOffset: 0
};

let stores: Stores;

beforeEach(async () => {
	// A fresh database per test keeps them independent.
	stores = await createLocalStores(`test-${crypto.randomUUID()}`);
});

describe('bookmarks', () => {
	it('creates, lists by edition, updates and removes', async () => {
		const created = await stores.bookmarks.create({ editionId: 'ed1', locator, label: 'Start' });
		await stores.bookmarks.create({ editionId: 'ed2', locator: { ...locator, editionId: 'ed2' } });

		expect(created.id).toBeTruthy();
		expect(await stores.bookmarks.list('ed1')).toEqual([created]);

		const renamed = await stores.bookmarks.update(created.id, { label: 'Chapter 1' });
		expect(renamed.label).toBe('Chapter 1');
		expect(renamed.createdAt).toBe(created.createdAt);

		await stores.bookmarks.remove(created.id);
		expect(await stores.bookmarks.list('ed1')).toEqual([]);
	});

	it('rejects updates to missing records', async () => {
		await expect(stores.bookmarks.update('missing', { label: 'x' })).rejects.toThrow();
	});
});

describe('annotations', () => {
	it('stores highlights and notes against a range', async () => {
		const note = await stores.annotations.create({
			editionId: 'ed1',
			range: { start: locator, end: { ...locator, charOffset: 20 } },
			kind: 'note',
			colour: 2,
			body: 'Foreshadowing?'
		});
		expect(await stores.annotations.list('ed1')).toEqual([note]);
	});
});

describe('progress', () => {
	it('saves and overwrites per edition', async () => {
		const base = { editionId: 'ed1', locator, maxLocator: locator, updatedAt: '' };
		await stores.progress.save({ ...base, percent: 0.1 });
		await stores.progress.save({ ...base, percent: 0.2 });
		expect((await stores.progress.get('ed1'))?.percent).toBe(0.2);
		expect(await stores.progress.get('ed2')).toBeUndefined();
	});
});

describe('settings', () => {
	it('keeps global settings and per-book overrides separate', async () => {
		await stores.settings.save({ theme: 'dark' });
		await stores.settings.save({ theme: 'sepia' }, 'book1');
		expect(await stores.settings.get()).toEqual({ theme: 'dark' });
		expect(await stores.settings.get('book1')).toEqual({ theme: 'sepia' });
	});
});
