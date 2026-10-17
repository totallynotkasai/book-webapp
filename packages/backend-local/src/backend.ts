import {
	BackendError,
	backendContract,
	backendTopics,
	systemClock,
	type Backend,
	type BackendEvents,
	type BackendTopic,
	type Clock,
	type MethodContract,
	type OrderDto,
	type PersonaDto,
	type UserDto
} from '@book/core';
import { activeEntitlements, can, type Permission } from '@book/domain';
import {
	DEFAULT_BACKEND_DB_NAME,
	getMeta,
	openBackendDB,
	SEEDED_STORES,
	setMeta,
	type BackendDatabase
} from './db';
import { createCatalogueApi } from './catalogue';
import { createCheckoutApi } from './checkout';
import { createContentApi } from './content';
import { createStoredFiles, parseStudioUrl } from './files';
import { createLayersApi } from './layers';
import { paginate } from './paging';
import { inThreadPipeline, type Pipeline } from './pipeline';
import { parseSeed, type Seed } from './seed';
import { createCommunityApi } from './community';
import { createInboxApi } from './inbox';
import { createModerationApi } from './moderation';
import { createReleases } from './releases';
import { createReviewsApi } from './reviews';
import { createWishlistApi } from './wishlist';
import { createStoryModule, seededStory } from './story';
import { createStudioApi } from './studio';
import { createSupportApi } from './support';
import {
	ownerSimulationDefaults,
	SimulatedClock,
	simulationSchema,
	type SimulationSettings
} from './simulation';

export interface LocalBackendOptions {
	/** Fetches the raw seed JSON. In the app it's fetched from a URL, never bundled (plan §4.3). */
	loadSeed: () => Promise<unknown>;
	dbName?: string;
	/** Real time; the simulated clock runs ahead of it by the dev panel's offset. */
	baseClock?: Clock;
	/** Used until the dev panel changes them. */
	simulationDefaults?: SimulationSettings;
	/** Validate every input and output against the contract. On in dev builds and tests. */
	validate?: boolean;
	/** Randomness for latency and failures (tests pass a fixed one). */
	random?: () => number;
	/** Fetches a seeded Book's EPUB from its static path (the app fetches; tests read files). */
	loadFile?: (url: string) => Promise<Uint8Array>;
	/**
	 * Content work: processing EPUBs (catalogue Books and Studio uploads), migrating Anchors and
	 * reading Words. The app runs text-pipeline in a Web Worker; by default each part runs in this
	 * thread (fine for tests).
	 */
	pipeline?: Partial<Pipeline>;
	/**
	 * The build profile. Tester builds have no store, so their seed starts the Reader with what
	 * owner builds leave them to get (plan §6 Phase 1.6). Owner by default.
	 */
	profile?: Profile;
}

type Profile = 'owner' | 'tester';

/** Owner-only controls for the dev panel. Never part of `Backend`; there is no Phase 2 equal. */
export interface LocalBackendControls {
	/** The signed-in Persona's user ID, synchronously and never simulated, for per-user Stores. */
	currentUserId(): string;
	/** The seeded Personas, never simulated, so the dev panel works at a 100% failure rate. */
	personas(): Promise<PersonaDto[]>;
	/** Switch Persona without simulated latency or failures. The app reloads afterwards. */
	switchPersona(personaId: string): Promise<void>;
	simulation(): SimulationSettings;
	setSimulation(changes: Partial<SimulationSettings>): Promise<SimulationSettings>;
	/** The simulated clock: real time plus the offset. */
	readonly clock: Clock;
	advanceClock(ms: number): Promise<void>;
	/** Wipes the simulated backend and loads the seed again. */
	resetDemoData(): Promise<void>;
	/** Every Persona's orders, newest first (P1-STO-02). */
	orders(): Promise<(OrderDto & { userId: string })[]>;
	/** Refunds an order: what it granted is revoked, a Bundle's children too (§6.5). */
	refundOrder(orderId: string): Promise<void>;
	close(): void;
}

export interface LocalBackend {
	backend: Backend;
	controls: LocalBackendControls;
}

function eventHub(): BackendEvents & { emit(topic: BackendTopic): void } {
	const listeners = new Map<BackendTopic, Set<() => void>>();
	return {
		on(topic, callback) {
			const set = listeners.get(topic) ?? new Set();
			set.add(callback);
			listeners.set(topic, set);
			return () => set.delete(callback);
		},
		emit(topic) {
			for (const callback of listeners.get(topic) ?? []) callback();
		}
	};
}

async function writeSeed(db: BackendDatabase, seed: Seed, profile: Profile): Promise<void> {
	const tx = db.transaction([...SEEDED_STORES, 'meta', 'revisions', 'content'], 'readwrite');
	for (const name of SEEDED_STORES) await tx.objectStore(name).clear();
	// Studio uploads go with the Books they belonged to; seeded Books' processed text stays cached.
	for (const revision of await tx.objectStore('revisions').getAll()) {
		if (!revision.studio) continue;
		await tx
			.objectStore('content')
			.delete(IDBKeyRange.bound([revision.id, ''], [revision.id, '￿']));
		await tx.objectStore('revisions').delete(revision.id);
	}
	for (const persona of seed.personas) await tx.objectStore('personas').put(persona);
	for (const creator of seed.creators) await tx.objectStore('creators').put(creator);
	for (const book of seed.books) await tx.objectStore('books').put(book);
	for (const pack of seed.illustrationPacks) await tx.objectStore('illustrationPacks').put(pack);
	for (const track of seed.audioTracks) await tx.objectStore('audioTracks').put(track);
	for (const design of seed.bookmarkDesigns) await tx.objectStore('bookmarkDesigns').put(design);
	for (const plan of seed.plans) await tx.objectStore('plans').put(plan);
	for (const [order, shelf] of seed.shelves.entries()) {
		await tx.objectStore('shelves').put({ ...shelf, order });
	}
	for (const product of seed.products) await tx.objectStore('products').put(product);
	for (const { profiles, ...entitlement } of seed.entitlements) {
		// Tester builds have no store, so they start with what owner builds leave to buy.
		if (!profiles || profiles.includes(profile)) {
			await tx.objectStore('entitlements').put(entitlement);
		}
	}
	for (const flag of seed.flags) await tx.objectStore('flags').put(flag);
	for (const story of seed.stories) await tx.objectStore('stories').put(seededStory(story));
	// Other readers' ratings and follows (plan §4.7: "other people" come from seed data).
	for (const rating of seed.ratings) {
		await tx.objectStore('ratings').put({
			...rating,
			id: `${rating.layerId}|${rating.userId}`,
			createdAt: '2026-01-01T00:00:00.000Z'
		});
	}
	for (const follow of seed.follows) {
		await tx.objectStore('follows').put({
			...follow,
			id: `${follow.userId}|${follow.creatorId}`,
			createdAt: '2026-01-01T00:00:00.000Z'
		});
	}
	for (const review of seed.reviews) {
		await tx.objectStore('reviews').put({
			...review,
			id: `${review.userId}|${review.bookId}`,
			state: 'visible',
			updatedAt: review.createdAt
		});
	}
	await tx.objectStore('meta').put({ key: 'seedVersion', value: seed.version });
	await tx.objectStore('meta').put({ key: 'seedProfile', value: profile });
	await tx.objectStore('meta').put({ key: 'currentPersonaId', value: seed.defaultPersonaId });
	await tx.done;
}

function isPage(value: unknown): value is { items: unknown[]; nextCursor: string | null } {
	return (
		typeof value === 'object' &&
		value !== null &&
		Array.isArray((value as { items?: unknown }).items)
	);
}

function delay(ms: number): Promise<void> {
	return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function describeIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
	return error.issues
		.map((i) => `${i.path.map(String).join('.') || '(value)'}: ${i.message}`)
		.join('; ');
}

/**
 * Creates the simulated backend. Loads (and validates) the seed when the database is new or the
 * seed version has changed; otherwise keeps the simulated state from earlier sessions.
 */
export async function createLocalBackend(options: LocalBackendOptions): Promise<LocalBackend> {
	const db = await openBackendDB(options.dbName ?? DEFAULT_BACKEND_DB_NAME);
	const random = options.random ?? Math.random;
	const validate = options.validate ?? false;
	const events = eventHub();

	// The seed is validated before anything is written, so a bad file can't leave a half-seeded DB.
	const seed = parseSeed(await options.loadSeed());
	const profile: Profile = options.profile ?? 'owner';
	const storedVersion = await getMeta(db, 'seedVersion');
	const storedProfile = (await getMeta(db, 'seedProfile')) ?? 'owner';
	if (storedVersion !== seed.version || storedProfile !== profile) {
		await writeSeed(db, seed, profile);
	}

	const storedSimulation = simulationSchema.safeParse(await getMeta(db, 'simulation'));
	let simulation: SimulationSettings = storedSimulation.success
		? storedSimulation.data
		: (options.simulationDefaults ?? ownerSimulationDefaults);
	let currentPersonaId = (await getMeta(db, 'currentPersonaId')) ?? seed.defaultPersonaId;
	let currentUser: UserDto | null = (await db.get('personas', currentPersonaId))?.user ?? null;

	const clock = new SimulatedClock(
		options.baseClock ?? systemClock,
		() => simulation.clockOffsetMs
	);

	// ---- helpers over the simulated "server" tables ----

	function requireUser(): UserDto {
		if (!currentUser) throw new BackendError('UNAUTHENTICATED', 'Sign in to continue.');
		return currentUser;
	}

	function requirePermission(permission: Permission): UserDto {
		const user = requireUser();
		if (!can(user.role, permission)) {
			throw new BackendError('FORBIDDEN', `Your account can't use ${permission}.`);
		}
		return user;
	}

	const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);

	async function signIn(personaId: string) {
		const persona = await db.get('personas', personaId);
		if (!persona) throw new BackendError('NOT_FOUND', `There is no persona "${personaId}".`);
		await setMeta(db, 'currentPersonaId', persona.id);
		currentPersonaId = persona.id;
		currentUser = persona.user;
		events.emit('session');
		events.emit('entitlements');
		return { user: currentUser };
	}

	// ---- module implementations (no simulation; that's applied below) ----

	// Modules defined below this object are added to the Backend separately.
	const implementation: Omit<
		Backend,
		| 'events'
		| 'moderation'
		| 'content'
		| 'layers'
		| 'catalogue'
		| 'checkout'
		| 'support'
		| 'studio'
		| 'community'
		| 'inbox'
		| 'wishlist'
		| 'reviews'
	> = {
		session: {
			async current() {
				return { user: currentUser };
			},
			async listPersonas(): Promise<PersonaDto[]> {
				const personas = await db.getAll('personas');
				return personas.map(({ id, label, description, user }) => ({
					id,
					label,
					description,
					user
				}));
			},
			signInAs: signIn
		},
		library: {
			async list(page) {
				const user = requireUser();
				const entitlements = activeEntitlements(
					await db.getAllFromIndex('entitlements', 'userId', user.id),
					user.id,
					clock.now()
				);
				const products = new Map((await db.getAll('products')).map((p) => [p.id, p]));
				const byBook = new Map<string, typeof entitlements>();
				for (const entitlement of entitlements) {
					const bookId = products.get(entitlement.productId)?.bookId;
					if (!bookId) continue; // e.g. Bookmark Designs: owned, but not a Book in the library
					byBook.set(bookId, [...(byBook.get(bookId) ?? []), entitlement]);
				}
				const entries = [];
				for (const [bookId, owned] of byBook) {
					const book = await db.get('books', bookId);
					// A Creator's unpublished drafts live in the Studio, not their library.
					if (!book || book.listingState === 'draft') continue;
					entries.push({
						book: (await catalogue.summaries([book]))[0]!,
						entitlements: owned.map(({ id, productId, source, grantedAt, parentId }) => ({
							id,
							productId,
							source,
							grantedAt,
							parentId: parentId ?? null
						}))
					});
				}
				entries.sort((a, b) => byTitle(a.book, b.book));
				return paginate(entries, page);
			}
		}
	};

	const paymentOutcome = () => simulation.paymentOutcome;
	const checkout = createCheckoutApi({
		db,
		clock,
		requireUser,
		paymentOutcome,
		changed: () => events.emit('entitlements')
	});
	const support = createSupportApi({
		db,
		clock,
		requireUser,
		paymentOutcome,
		changed: () => events.emit('entitlements'),
		supportChanged: () => events.emit('support')
	});
	const files = createStoredFiles(db);
	const pipeline: Pipeline = { ...inThreadPipeline, ...options.pipeline };
	/** Static files from the app, or `studio:` files the backend keeps itself. */
	async function loadFile(url: string): Promise<Uint8Array> {
		const stored = parseStudioUrl(url);
		if (stored) {
			const bytes = await files.read(stored.layerId, stored.path);
			if (!bytes) throw new Error(`No Studio file ${url}`);
			return bytes;
		}
		if (!options.loadFile) {
			throw new Error('backend-local was created without loadFile, so it can’t open books.');
		}
		return options.loadFile(url);
	}
	const story = createStoryModule({
		db,
		clock,
		pipeline,
		files,
		changed: (...topics) => {
			for (const topic of topics) events.emit(topic);
		}
	});
	const content = createContentApi({
		db,
		clock,
		requireUser,
		beforeAccess: async (userId) => {
			await support.refresh(userId);
			await releases.refresh();
		},
		loadFile,
		pipeline,
		files,
		story
	});
	const layers = createLayersApi({ db, clock, requireUser, loadFile, content, files });
	const inbox = createInboxApi({
		db,
		clock,
		requireUser,
		changed: () => events.emit('inbox'),
		beforeList: () => releases.refresh()
	});
	const releases = createReleases({
		db,
		clock,
		content,
		inbox,
		changed: (...topics) => {
			for (const topic of topics) events.emit(topic);
		}
	});
	const reviews = createReviewsApi({
		db,
		clock,
		requireUser,
		currentUser: () => currentUser,
		changed: () => events.emit('reviews')
	});
	const moderation = createModerationApi({
		db,
		clock,
		requirePermission,
		simulation: () => simulation,
		inbox,
		reviews,
		changed: () => {
			events.emit('moderation');
			events.emit('catalogue');
			events.emit('studio');
			events.emit('community');
		}
	});
	const community = createCommunityApi({
		db,
		clock,
		requireUser,
		layers,
		moderation,
		changed: () => events.emit('community')
	});
	const catalogue = createCatalogueApi({
		db,
		clock,
		currentUser: () => currentUser,
		layers,
		files,
		nextChapterAt: async (book) => {
			await releases.refresh();
			return releases.nextChapterAt(book);
		},
		wishlisted: (userId, bookId) => wishlist.has(userId, bookId)
	});
	const wishlist = createWishlistApi({
		db,
		clock,
		requireUser,
		summaries: (books) => catalogue.summaries(books),
		inbox,
		changed: () => events.emit('wishlist')
	});
	const studio = createStudioApi({
		db,
		clock,
		requirePermission,
		pipeline,
		files,
		content,
		catalogue,
		support,
		moderation,
		inbox,
		story,
		releases,
		wishlist,
		changed: (...topics) => {
			for (const topic of topics) events.emit(topic);
		}
	});

	// ---- simulation and contract validation, applied to every method ----

	/**
	 * Content files are fetched like static files from a CDN (and cached by the reader), so they get
	 * no simulated latency or random failures; offline still stops them.
	 */
	const UNDELAYED = new Set(['content.read']);

	async function simulate<T>(
		name: string,
		contract: MethodContract,
		args: unknown[],
		run: () => Promise<T>
	) {
		if (simulation.offline) {
			throw new BackendError('NETWORK_ERROR', 'You’re offline (simulated).');
		}
		const undelayed = UNDELAYED.has(name);
		const { min, max } = simulation.latencyMs;
		if (!undelayed) await delay(min + Math.round(random() * (max - min)));
		if (!undelayed && simulation.failureRate > 0 && random() < simulation.failureRate) {
			throw new BackendError('SERVER_ERROR', 'The server had a problem (simulated failure).');
		}
		if (validate) {
			const input = contract.input.safeParse(args);
			if (!input.success) {
				throw new BackendError(
					'VALIDATION_FAILED',
					describeIssues(input.error),
					input.error.issues
				);
			}
		}
		let output: T;
		try {
			output = await run();
		} catch (error) {
			if (error instanceof BackendError) throw error;
			throw new BackendError('SERVER_ERROR', 'The server had a problem.', String(error));
		}
		if (simulation.emptyLists && isPage(output)) output = { items: [], nextCursor: null } as T;
		if (!validate) return output;
		const parsed = contract.output.safeParse(output);
		if (!parsed.success) {
			throw new BackendError(
				'SERVER_ERROR',
				`The response didn’t match the contract: ${describeIssues(parsed.error)}`
			);
		}
		// Return the parsed copy, so callers only ever see contract fields (plan §4.6 rule 3).
		return parsed.data as T;
	}

	function wrapModule<M extends object>(
		moduleName: string,
		module: M,
		contracts: Record<string, MethodContract>
	): M {
		const wrapped: Record<string, unknown> = {};
		for (const [name, contract] of Object.entries(contracts)) {
			const method = (module as Record<string, (...args: unknown[]) => Promise<unknown>>)[name];
			if (!method) throw new Error(`backend-local is missing ${name}`);
			wrapped[name] = (...args: unknown[]) =>
				simulate(`${moduleName}.${name}`, contract, args, () => method.apply(module, args));
		}
		return wrapped as M;
	}

	const backend: Backend = {
		session: wrapModule('session', implementation.session, backendContract.session),
		catalogue: wrapModule('catalogue', catalogue, backendContract.catalogue),
		library: wrapModule('library', implementation.library, backendContract.library),
		checkout: wrapModule('checkout', checkout, backendContract.checkout),
		support: wrapModule('support', support, backendContract.support),
		content: wrapModule('content', content, backendContract.content),
		layers: wrapModule('layers', layers, backendContract.layers),
		studio: wrapModule('studio', studio, backendContract.studio),
		moderation: wrapModule('moderation', moderation, backendContract.moderation),
		community: wrapModule('community', community, backendContract.community),
		inbox: wrapModule('inbox', inbox, backendContract.inbox),
		wishlist: wrapModule('wishlist', wishlist, backendContract.wishlist),
		reviews: wrapModule('reviews', reviews, backendContract.reviews),
		events: { on: events.on }
	};

	const controls: LocalBackendControls = {
		currentUserId() {
			return currentUser?.id ?? `persona:${currentPersonaId}`;
		},
		personas: () => implementation.session.listPersonas(),
		async switchPersona(personaId) {
			await signIn(personaId);
		},
		simulation() {
			return simulation;
		},
		async setSimulation(changes) {
			simulation = simulationSchema.parse({ ...simulation, ...changes });
			await setMeta(db, 'simulation', simulation);
			return simulation;
		},
		clock,
		async advanceClock(ms) {
			await controls.setSimulation({ clockOffsetMs: simulation.clockOffsetMs + Math.round(ms) });
			events.emit('entitlements');
			// Chapters whose time has come are out, and followers told (P1-STU-06).
			await releases.refresh();
		},
		async resetDemoData() {
			await writeSeed(db, seed, profile);
			currentPersonaId = seed.defaultPersonaId;
			currentUser = (await db.get('personas', currentPersonaId))?.user ?? null;
			await controls.setSimulation({ clockOffsetMs: 0 });
			for (const topic of backendTopics) events.emit(topic);
		},
		orders: () => checkout.allOrders(),
		refundOrder: (orderId) => checkout.refund(orderId),
		close() {
			db.close();
		}
	};

	return { backend, controls };
}
