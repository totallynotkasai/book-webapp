import type { AiUse, IngestReport, RevisionChangesDto } from '@book/core';
import type { EntitlementRecord } from '@book/domain';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
	AudioTrackRecord,
	BookmarkDesignRecord,
	BookRecord,
	CreatorRecord,
	FlagRecord,
	IllustrationPackRecord,
	PersonaRecord,
	PlanRecord,
	ProductRecord,
	ShelfRecord
} from './seed';
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
	illustrationPacks: { key: string; value: IllustrationPackRecord; indexes: { bookId: string } };
	audioTracks: { key: string; value: AudioTrackRecord; indexes: { bookId: string } };
	bookmarkDesigns: { key: string; value: BookmarkDesignRecord };
	plans: { key: string; value: PlanRecord; indexes: { creatorId: string } };
	shelves: { key: string; value: ShelfRecord & { order: number } };
	/** Simulated "server" records of what readers did (P1-STO-02, P1-STO-04). */
	orders: { key: string; value: OrderRecord; indexes: { userId: string } };
	subscriptions: { key: string; value: SubscriptionRecord; indexes: { userId: string } };
	tips: { key: string; value: TipRecord; indexes: { userId: string } };
	products: { key: string; value: ProductRecord };
	entitlements: { key: string; value: EntitlementRecord; indexes: { userId: string } };
	flags: { key: string; value: FlagRecord };
	/** Processed catalogue Revisions (derived from static files, so kept by "Reset demo data"). */
	revisions: { key: string; value: RevisionRecord; indexes: { bookId: string } };
	content: { key: [string, string]; value: ContentFile };
	/**
	 * Files the Studio keeps (P1-STU-01 to P1-STU-03, P1-LAY-05): packs' images and `pack.json`,
	 * tracks' audio, Sync Maps and `track.json`, and covers, keyed by Layer (or `cover:<bookId>`).
	 * Phase 2 keeps them in object storage (§6.7).
	 */
	layerFiles: { key: [string, string]; value: LayerFile };
}

export interface LayerFile {
	layerId: string;
	path: string;
	type: string;
	bytes: ArrayBuffer;
}

export interface OrderRecord {
	id: string;
	userId: string;
	/** Unique per user: the same key returns the same order (§10.1). */
	idempotencyKey: string;
	status: 'paid' | 'claimed' | 'refunded';
	/** What was asked for: the Bundle or single Product. */
	productId: string;
	items: { productId: string; priceMinor: number }[];
	currency: string;
	totalMinor: number;
	/** The Entitlement it created (a Bundle's parent). */
	entitlementId: string;
	createdAt: string;
	refundedAt: string | null;
}

export interface SubscriptionRecord {
	id: string;
	userId: string;
	planId: string;
	idempotencyKey: string;
	status: 'active' | 'cancelled' | 'ended';
	startedAt: string;
	currentPeriodEnd: string;
	cancelAtPeriodEnd: boolean;
	endedAt: string | null;
	/** Charges so far: the first month and each renewal (simulated). */
	payments: number;
}

export interface TipRecord {
	id: string;
	userId: string;
	idempotencyKey: string;
	creatorId: string;
	bookId: string | null;
	amountMinor: number;
	currency: string;
	message: string | null;
	createdAt: string;
}

export interface RevisionRecord {
	/** SHA-256 of the EPUB (§6.3). */
	id: string;
	bookId: string;
	/** Empty while a Studio upload is still processing. */
	processedAt: string;
	/** Absent on a seeded Book's Revision, processed from its `epubUrl` on first open. */
	studio?: {
		state: 'processing' | 'ready' | 'failed' | 'published' | 'superseded';
		uploadedAt: string;
		/** The Book's uploads in order (0, 1, …): ties on `uploadedAt` keep their order. */
		seq: number;
		publishedAt: string | null;
		aiUse: AiUse | null;
		failure: string | null;
		changes: RevisionChangesDto | null;
	};
	/** The ingest report (§7.1 step 7); absent until processed. */
	report?: IngestReport;
}

/** A processed file, as bytes plus a media type (some WebKit builds can't store Blobs). */
export interface ContentFile {
	revisionId: string;
	path: string;
	type: string;
	bytes: ArrayBuffer;
}

export type BackendDatabase = IDBPDatabase<BackendDB>;

/** Small values the simulated backend keeps between sessions. */
interface Meta {
	seedVersion: number;
	/** The build profile the seed was written for (tester builds start with more, plan §6 1.6). */
	seedProfile: 'owner' | 'tester';
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

/**
 * The stores "Reset demo data" clears: the seeded ones, and what readers did with them (orders,
 * subscriptions, Tips), which only make sense against that seed.
 */
export const SEEDED_STORES = [
	'personas',
	'creators',
	'books',
	'illustrationPacks',
	'audioTracks',
	'bookmarkDesigns',
	'plans',
	'shelves',
	'products',
	'entitlements',
	'flags',
	'orders',
	'subscriptions',
	'tips',
	'layerFiles'
] as const;

/** Bump when the schema changes, and add a matching step in `upgrade`. */
const VERSION = 7;

export async function openBackendDB(name = DEFAULT_BACKEND_DB_NAME): Promise<BackendDatabase> {
	const db = await openDB<BackendDB>(name, VERSION, {
		// Another tab (or "Wipe device data") wants to delete or upgrade this database: let it.
		blocking() {
			db.close();
		},
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
			if (oldVersion < 2) {
				// P1-APP-01: the admin review queue. Re-seeded with everything else on a seed change.
				db.createObjectStore('flags', { keyPath: 'id' });
			}
			if (oldVersion < 3) {
				// P1-APP-03: catalogue Books processed by text-pipeline, cached per Revision.
				db.createObjectStore('revisions', { keyPath: 'id' }).createIndex('bookId', 'bookId');
				db.createObjectStore('content', { keyPath: ['revisionId', 'path'] });
			}
			if (oldVersion < 4) {
				// P1-LAY-01: Illustration Packs. Seeded like Books, so a new seed version fills it.
				db.createObjectStore('illustrationPacks', { keyPath: 'id' }).createIndex(
					'bookId',
					'bookId'
				);
			}
			if (oldVersion < 5) {
				// P1-LAY-04: narration Audio Tracks, seeded like packs.
				db.createObjectStore('audioTracks', { keyPath: 'id' }).createIndex('bookId', 'bookId');
			}
			if (oldVersion < 6) {
				// P1-STO-01 to P1-STO-04: the store's seeded records, and orders, subscriptions and Tips.
				db.createObjectStore('bookmarkDesigns', { keyPath: 'id' });
				db.createObjectStore('plans', { keyPath: 'id' }).createIndex('creatorId', 'creatorId');
				db.createObjectStore('shelves', { keyPath: 'id' });
				db.createObjectStore('orders', { keyPath: 'id' }).createIndex('userId', 'userId');
				db.createObjectStore('subscriptions', { keyPath: 'id' }).createIndex('userId', 'userId');
				db.createObjectStore('tips', { keyPath: 'id' }).createIndex('userId', 'userId');
			}
			if (oldVersion < 7) {
				// P1-STU-01 to P1-STU-03, P1-LAY-05: files the Studio keeps.
				db.createObjectStore('layerFiles', { keyPath: ['layerId', 'path'] });
			}
		}
	});
	return db;
}
