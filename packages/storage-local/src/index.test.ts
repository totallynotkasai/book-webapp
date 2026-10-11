import 'fake-indexeddb/auto';
import { describeStoresContract } from '@book/contract-tests';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { createLocalStores } from './index';

// A fresh database per call keeps tests independent.
describeStoresContract('storage-local', ({ clock }) =>
	createLocalStores({ dbName: `test-${crypto.randomUUID()}`, clock })
);

describe('IndexedDB upgrade from version 1', () => {
	it('drops the v0.1 Locator stores and creates the version 2 stores', async () => {
		const dbName = `test-v1-${crypto.randomUUID()}`;
		const v1 = await openDB(dbName, 1, {
			upgrade(db) {
				db.createObjectStore('bookmarks', { keyPath: 'id' }).createIndex('editionId', 'editionId');
				db.createObjectStore('annotations', { keyPath: 'id' }).createIndex(
					'editionId',
					'editionId'
				);
				db.createObjectStore('progress', { keyPath: 'editionId' });
				db.createObjectStore('settings');
			}
		});
		await v1.put('bookmarks', { id: 'old', editionId: 'ed1', locator: { cfi: 'epubcfi(/6/4)' } });
		v1.close();

		const stores = await createLocalStores({ dbName });
		expect(await stores.annotations.list('ed1')).toEqual([]);

		const v2 = await openDB(dbName);
		expect([...v2.objectStoreNames].sort()).toEqual([
			'annotations',
			'layerSelection',
			'libraryBooks',
			'libraryFiles',
			'libraryRevisions',
			'placedBookmarks',
			'preferences',
			'progress'
		]);
		v2.close();
	});
});
