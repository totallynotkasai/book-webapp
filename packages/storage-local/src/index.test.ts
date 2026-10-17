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

		const upgraded = await openDB(dbName);
		expect([...upgraded.objectStoreNames].sort()).toEqual(STORES);
		upgraded.close();
	});
});

const STORES = [
	'annotations',
	'bookFinishes',
	'layerSelection',
	'libraryBooks',
	'libraryFiles',
	'libraryRevisions',
	'placedBookmarks',
	'preferences',
	'progress',
	'readingDays',
	'readingPace'
];

describe('IndexedDB upgrade from version 2 (P1-RDR-14, P1-RDR-15)', () => {
	it('adds the reading stores and keeps everything else', async () => {
		// A version 2 database, as Phase 1.3 to 1.15 made it, with a highlight in it.
		const dbName = `test-v2-${crypto.randomUUID()}`;
		const v2 = await openDB(dbName, 2, {
			upgrade(db) {
				db.createObjectStore('libraryBooks', { keyPath: 'id' });
				db.createObjectStore('libraryRevisions', { keyPath: 'id' }).createIndex('bookId', 'bookId');
				db.createObjectStore('libraryFiles', { keyPath: ['revisionId', 'path'] });
				db.createObjectStore('annotations', { keyPath: 'id' }).createIndex('bookId', 'bookId');
				db.createObjectStore('placedBookmarks', { keyPath: 'id' }).createIndex('bookId', 'bookId');
				db.createObjectStore('progress', { keyPath: 'bookId' });
				db.createObjectStore('preferences');
				db.createObjectStore('layerSelection', { keyPath: 'bookId' });
			}
		});
		const highlight = {
			id: 'h1',
			bookId: 'b',
			anchor: {
				kind: 'range',
				bookId: 'b',
				revisionId: 'r',
				startWordId: 1,
				endWordId: 2,
				startOrdinal: 0,
				endOrdinal: 1,
				quote: { exact: 'two words', prefix: '', suffix: '' }
			},
			anchorStatus: 'ok',
			colour: 1,
			createdAt: '2026-10-11T09:00:00.000Z',
			updatedAt: '2026-10-11T09:00:00.000Z',
			deletedAt: null
		};
		await v2.put('annotations', highlight);
		v2.close();

		const stores = await createLocalStores({ dbName });
		expect(await stores.annotations.list('b')).toEqual([highlight]);
		expect(await stores.readingStats.listDays()).toEqual([]);
		stores.close();
		const upgraded = await openDB(dbName);
		expect(upgraded.version).toBe(3);
		expect([...upgraded.objectStoreNames].sort()).toEqual(STORES);
		upgraded.close();
	});
});
