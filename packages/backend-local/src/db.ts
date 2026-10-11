import type { EntitlementRecord } from '@book/domain';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BookRecord, CreatorRecord, PersonaRecord, ProductRecord } from './seed';
import type { SimulationSettings } from './simulation';

/**
 * backend-local's own database: the simulated "server", kept apart from the user's `Stores`
 * so the app can't read server tables by accident and "Reset demo data" can just wipe it.
 */
export interface BackendDB extends DBSchema {
	meta: { key: MetaKey; value: { key: MetaKey; value: Meta[MetaKey] } };
	personas: { key: string; value: PersonaRecord };
	creators: { key: string; value: CreatorRecord; indexes: { handle: string } };
	books: { key: string; value: BookRecord; indexes: { slug: string; creatorId: string } };
	products: { key: string; value: ProductRecord };
	entitlements: { key: string; value: EntitlementRecord; indexes: { userId: string } };
}

export type BackendDatabase = IDBPDatabase<BackendDB>;

/** Small values the simulated backend keeps between sessions. */
interface Meta {
	seedVersion: number;
	currentPersonaId: string;
	simulation: SimulationSettings;
}
type MetaKey = keyof Meta;

export async function getMeta<K extends MetaKey>(
	db: BackendDatabase,
	key: K
): Promise<Meta[K] | undefined> {
	return (await db.get('meta', key))?.value as Meta[K] | undefined;
}

export async function setMeta<K extends MetaKey>(
	db: BackendDatabase,
	key: K,
	value: Meta[K]
): Promise<void> {
	await db.put('meta', { key, value });
}

export const DEFAULT_BACKEND_DB_NAME = 'book-backend-local';

/** The stores "Reset demo data" clears and re-seeds. */
export const SEEDED_STORES = ['personas', 'creators', 'books', 'products', 'entitlements'] as const;

const VERSION = 1;

export function openBackendDB(name = DEFAULT_BACKEND_DB_NAME): Promise<BackendDatabase> {
	return openDB<BackendDB>(name, VERSION, {
		upgrade(db, oldVersion) {
			if (oldVersion < 1) {
				db.createObjectStore('meta', { keyPath: 'key' });
				db.createObjectStore('personas', { keyPath: 'id' });
				db.createObjectStore('creators', { keyPath: 'id' }).createIndex('handle', 'handle', {
					unique: true
				});
				const books = db.createObjectStore('books', { keyPath: 'id' });
				books.createIndex('slug', 'slug', { unique: true });
				books.createIndex('creatorId', 'creatorId');
				db.createObjectStore('products', { keyPath: 'id' });
				db.createObjectStore('entitlements', { keyPath: 'id' }).createIndex('userId', 'userId');
			}
		}
	});
}
