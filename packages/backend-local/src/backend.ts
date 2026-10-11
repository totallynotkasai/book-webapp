import {
	BackendError,
	backendContract,
	systemClock,
	type Backend,
	type BackendEvents,
	type BackendTopic,
	type BookSummaryDto,
	type Clock,
	type MethodContract,
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
import { paginate } from './paging';
import { parseSeed, type BookRecord, type Seed } from './seed';
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
}

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

async function writeSeed(db: BackendDatabase, seed: Seed): Promise<void> {
	const tx = db.transaction([...SEEDED_STORES, 'meta'], 'readwrite');
	for (const name of SEEDED_STORES) await tx.objectStore(name).clear();
	for (const persona of seed.personas) await tx.objectStore('personas').put(persona);
	for (const creator of seed.creators) await tx.objectStore('creators').put(creator);
	for (const book of seed.books) await tx.objectStore('books').put(book);
	for (const product of seed.products) await tx.objectStore('products').put(product);
	for (const entitlement of seed.entitlements)
		await tx.objectStore('entitlements').put(entitlement);
	await tx.objectStore('meta').put({ key: 'seedVersion', value: seed.version });
	await tx.objectStore('meta').put({ key: 'currentPersonaId', value: seed.defaultPersonaId });
	await tx.done;
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
	const storedVersion = await getMeta(db, 'seedVersion');
	if (storedVersion !== seed.version) await writeSeed(db, seed);

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

	async function toSummary(book: BookRecord): Promise<BookSummaryDto> {
		const [creator, products] = await Promise.all([
			db.get('creators', book.creatorId),
			db.getAll('products')
		]);
		const product = products.find((p) => p.kind === 'book' && p.refId === book.id);
		if (!product) throw new BackendError('SERVER_ERROR', `Book ${book.id} has no Product.`);
		return {
			id: book.id,
			slug: book.slug,
			title: book.title,
			creatorId: book.creatorId,
			creatorName: creator?.displayName ?? '',
			lang: book.lang,
			aiUse: book.aiUse,
			coverUrl: book.coverUrl,
			price: product.price
		};
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

	const implementation: Omit<Backend, 'events'> = {
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
		catalogue: {
			async listBooks(page) {
				const books = (await db.getAll('books')).filter((b) => b.listingState === 'listed');
				const summaries = await Promise.all(books.sort(byTitle).map(toSummary));
				return paginate(summaries, page);
			},
			async getBook(slug) {
				const book = await db.getFromIndex('books', 'slug', slug);
				if (!book || book.listingState !== 'listed') {
					throw new BackendError('NOT_FOUND', 'That book isn’t in the store.');
				}
				const [summary, creator, products] = await Promise.all([
					toSummary(book),
					db.get('creators', book.creatorId),
					db.getAll('products')
				]);
				if (!creator) throw new BackendError('SERVER_ERROR', `Book ${book.id} has no Creator.`);
				return {
					...summary,
					description: book.description,
					creator,
					products: products
						.filter((p) => p.bookId === book.id && p.status === 'active')
						.map(({ id, kind, bookId, creatorId, isOfficial, price }) => ({
							id,
							kind,
							bookId,
							creatorId,
							isOfficial,
							price
						}))
				};
			},
			async getCreator(handle) {
				const creator = await db.getFromIndex('creators', 'handle', handle);
				if (!creator) throw new BackendError('NOT_FOUND', 'There is no creator with that name.');
				return creator;
			}
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
					if (!book) continue;
					entries.push({
						book: await toSummary(book),
						entitlements: owned.map(({ id, productId, source, grantedAt }) => ({
							id,
							productId,
							source,
							grantedAt
						}))
					});
				}
				entries.sort((a, b) => byTitle(a.book, b.book));
				return paginate(entries, page);
			}
		},
		studio: {
			async listBooks(page) {
				const user = requirePermission('studio');
				const books = user.creatorId
					? await db.getAllFromIndex('books', 'creatorId', user.creatorId)
					: [];
				const result = await Promise.all(
					books.sort(byTitle).map(async (b) => ({
						...(await toSummary(b)),
						listingState: b.listingState
					}))
				);
				return paginate(result, page);
			}
		}
	};

	// ---- simulation and contract validation, applied to every method ----

	async function simulate<T>(contract: MethodContract, args: unknown[], run: () => Promise<T>) {
		if (simulation.offline) {
			throw new BackendError('NETWORK_ERROR', 'You’re offline (simulated).');
		}
		const { min, max } = simulation.latencyMs;
		await delay(min + Math.round(random() * (max - min)));
		if (simulation.failureRate > 0 && random() < simulation.failureRate) {
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

	function wrapModule<M extends object>(module: M, contracts: Record<string, MethodContract>): M {
		const wrapped: Record<string, unknown> = {};
		for (const [name, contract] of Object.entries(contracts)) {
			const method = (module as Record<string, (...args: unknown[]) => Promise<unknown>>)[name];
			if (!method) throw new Error(`backend-local is missing ${name}`);
			wrapped[name] = (...args: unknown[]) =>
				simulate(contract, args, () => method.apply(module, args));
		}
		return wrapped as M;
	}

	const backend: Backend = {
		session: wrapModule(implementation.session, backendContract.session),
		catalogue: wrapModule(implementation.catalogue, backendContract.catalogue),
		library: wrapModule(implementation.library, backendContract.library),
		studio: wrapModule(implementation.studio, backendContract.studio),
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
		},
		async resetDemoData() {
			await writeSeed(db, seed);
			currentPersonaId = seed.defaultPersonaId;
			currentUser = (await db.get('personas', currentPersonaId))?.user ?? null;
			await controls.setSimulation({ clockOffsetMs: 0 });
			for (const topic of ['session', 'catalogue', 'entitlements', 'studio'] as const) {
				events.emit(topic);
			}
		},
		close() {
			db.close();
		}
	};

	return { backend, controls };
}
