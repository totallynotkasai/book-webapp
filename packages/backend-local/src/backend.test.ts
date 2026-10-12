import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendError, backendContract, type Backend, type Clock } from '@book/core';
import { describeBackendContract, expectBackendError, ManualClock } from '@book/contract-tests';
import { describe, expect, it } from 'vitest';
import { createLocalBackend, type LocalBackendOptions } from './backend';
import { SeedError } from './seed';
import { testSimulationDefaults } from './simulation';
import seedFile from '../../../fixtures/seed/seed.json';

const seedJson: unknown = seedFile;

/** Catalogue EPUBs come from the web app's static folder, as the app fetches them. */
const loadFile = async (url: string) =>
	new Uint8Array(
		readFileSync(join(fileURLToPath(new URL('../../../apps/web/static', import.meta.url)), url))
	);

/** Processing a Book takes a moment, so tests share the result per Book. */
const processed = new Map<string, ReturnType<NonNullable<LocalBackendOptions['ingest']>>>();
const ingest: NonNullable<LocalBackendOptions['ingest']> = (bytes, options) => {
	let result = processed.get(options.bookId);
	if (!result) {
		result = import('@book/text-pipeline').then(({ ingestEpub }) => ingestEpub(bytes, options));
		processed.set(options.bookId, result);
	}
	return result;
};

function makeLocal(options: Partial<LocalBackendOptions> & { clock?: Clock } = {}) {
	return createLocalBackend({
		dbName: `test-backend-${crypto.randomUUID()}`,
		loadSeed: async () => structuredClone(seedJson),
		baseClock: options.clock ?? new ManualClock(),
		simulationDefaults: testSimulationDefaults,
		validate: true,
		loadFile,
		ingest,
		...options
	});
}

describeBackendContract('backend-local', async ({ clock }) => (await makeLocal({ clock })).backend);

/** Calls every method in the contract with plausible arguments. */
function everyCall(backend: Backend): [string, () => Promise<unknown>][] {
	const calls: [string, () => Promise<unknown>][] = [];
	for (const [moduleName, methods] of Object.entries(backendContract)) {
		for (const methodName of Object.keys(methods)) {
			const module = backend[moduleName as keyof typeof backendContract] as unknown as Record<
				string,
				(...args: unknown[]) => Promise<unknown>
			>;
			const args =
				methodName.startsWith('get') || methodName === 'signInAs' || methodName === 'open'
					? ['reader']
					: methodName === 'read'
						? ['token', 'manifest.json']
						: [];
			calls.push([`${moduleName}.${methodName}`, () => module[methodName]!(...args)]);
		}
	}
	return calls;
}

describe('simulation controls', () => {
	it('at a 100% failure rate, every Backend call rejects with a typed BackendError', async () => {
		const { backend, controls } = await makeLocal();
		await controls.setSimulation({ failureRate: 1 });
		const calls = everyCall(backend);
		expect(calls.length).toBeGreaterThanOrEqual(8);
		for (const [name, call] of calls) {
			const error = await call().catch((e: unknown) => e);
			expect(error, name).toBeInstanceOf(BackendError);
			// Content files are served like a CDN's: no random failures (they still go offline).
			if (name !== 'content.read') expect((error as BackendError).code, name).toBe('SERVER_ERROR');
		}
	});

	it('serves content files without simulated latency or failures, but not offline', async () => {
		const { backend, controls } = await makeLocal();
		const opened = await backend.content.open('book-alice');
		await controls.setSimulation({ failureRate: 1, latencyMs: { min: 5000, max: 5000 } });
		const started = performance.now();
		await expect(
			backend.content.read(opened.contentToken, 'manifest.json')
		).resolves.toBeInstanceOf(Blob);
		expect(performance.now() - started).toBeLessThan(2000);
		await controls.setSimulation({ offline: true });
		await expectBackendError(
			backend.content.read(opened.contentToken, 'manifest.json'),
			'NETWORK_ERROR'
		);
	}, 60_000);

	it('offline makes every call fail with NETWORK_ERROR, and events still work', async () => {
		const { backend, controls } = await makeLocal();
		await controls.setSimulation({ offline: true });
		for (const [name, call] of everyCall(backend)) {
			const error = await call().catch((e: unknown) => e);
			expect((error as BackendError).code, name).toBe('NETWORK_ERROR');
		}
		expect(typeof backend.events.on('session', () => {})).toBe('function');
	});

	it('empties every paged list when asked, leaving other calls alone', async () => {
		const { backend, controls } = await makeLocal();
		await controls.setSimulation({ emptyLists: true });
		expect(await backend.catalogue.listBooks()).toEqual({ items: [], nextCursor: null });
		expect((await backend.library.list()).items).toEqual([]);
		expect((await backend.session.current()).user).not.toBeNull();
		await controls.setSimulation({ emptyLists: false });
		expect((await backend.catalogue.listBooks()).items.length).toBeGreaterThan(0);
	});

	it('adds latency within the configured range', async () => {
		const { backend, controls } = await makeLocal({ random: () => 1 });
		await controls.setSimulation({ latencyMs: { min: 30, max: 60 } });
		const started = performance.now();
		await backend.session.current();
		expect(performance.now() - started).toBeGreaterThanOrEqual(55);
	});

	it('persists simulation settings and the clock offset across sessions', async () => {
		const dbName = `test-backend-${crypto.randomUUID()}`;
		const clock = new ManualClock('2026-10-11T00:00:00.000Z');
		const first = await makeLocal({ dbName, clock });
		await first.controls.setSimulation({ failureRate: 0.5 });
		await first.controls.advanceClock(30 * 86_400_000);
		expect(first.controls.clock.now().toISOString()).toBe('2026-11-10T00:00:00.000Z');
		first.controls.close();

		const second = await makeLocal({ dbName, clock });
		expect(second.controls.simulation().failureRate).toBe(0.5);
		expect(second.controls.clock.now().toISOString()).toBe('2026-11-10T00:00:00.000Z');
	});

	it('rejects invalid settings', async () => {
		const { controls } = await makeLocal();
		await expect(controls.setSimulation({ failureRate: 2 })).rejects.toThrow();
		await expect(controls.setSimulation({ latencyMs: { min: 500, max: 100 } })).rejects.toThrow();
	});
});

describe('Personas and per-user data', () => {
	it('starts as the default Persona and switches without simulation', async () => {
		const { backend, controls } = await makeLocal();
		expect(controls.currentUserId()).toBe('user-reader');
		await controls.setSimulation({ failureRate: 1 });
		await controls.switchPersona('author');
		expect(controls.currentUserId()).toBe('user-author');
		await controls.setSimulation({ failureRate: 0 });
		expect((await backend.session.current()).user?.role).toBe('creator');
	});

	it('gives each Persona their own library', async () => {
		const { backend } = await makeLocal();
		const titles = async () => (await backend.library.list()).items.map((e) => e.book.id);
		expect(await titles()).toEqual(['book-alice']);
		await backend.session.signInAs('author');
		expect(await titles()).toEqual(['book-alice', 'book-lamplighters-ledger']);
	});

	it('remembers the signed-in Persona across sessions', async () => {
		const dbName = `test-backend-${crypto.randomUUID()}`;
		const first = await makeLocal({ dbName });
		await first.controls.switchPersona('moderator');
		first.controls.close();
		const second = await makeLocal({ dbName });
		expect(second.controls.currentUserId()).toBe('user-moderator');
	});
});

describe('seed', () => {
	it('fails with a readable error when the seed file is invalid', async () => {
		const broken = structuredClone(seedJson) as {
			personas: { user: { role: string } }[];
			products: { price: { amountMinor: number } }[];
		};
		broken.personas[0]!.user.role = 'superuser';
		broken.products[0]!.price.amountMinor = 4.99;
		const error = await makeLocal({ loadSeed: async () => broken }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SeedError);
		const message = (error as SeedError).message;
		expect(message).toContain('The demo seed data is invalid');
		expect(message).toContain('personas.0.user.role');
		expect(message).toContain('products.0.price.amountMinor');
	});

	it('reports broken references between records', async () => {
		const broken = structuredClone(seedJson) as { entitlements: { productId: string }[] };
		broken.entitlements[0]!.productId = 'product-missing';
		const error = (await makeLocal({ loadSeed: async () => broken }).catch((e) => e)) as SeedError;
		expect(error.problems).toEqual(['entitlements.0.productId: no product "product-missing"']);
	});

	it('re-seeds when the seed version changes, and resets on demand', async () => {
		const dbName = `test-backend-${crypto.randomUUID()}`;
		const first = await makeLocal({ dbName });
		await first.controls.switchPersona('author');
		first.controls.close();

		const bumped = { ...(structuredClone(seedJson) as object), version: 999 };
		const second = await makeLocal({ dbName, loadSeed: async () => bumped });
		expect(second.controls.currentUserId()).toBe('user-reader');

		await second.controls.switchPersona('illustrator');
		await second.controls.advanceClock(1000);
		await second.controls.resetDemoData();
		expect(second.controls.currentUserId()).toBe('user-reader');
		expect(second.controls.simulation().clockOffsetMs).toBe(0);
	});
});

describe('contract validation', () => {
	it('rejects invalid input with VALIDATION_FAILED', async () => {
		const { backend } = await makeLocal();
		await expectBackendError(backend.catalogue.listBooks({ limit: 0 }), 'VALIDATION_FAILED');
		await expectBackendError(backend.catalogue.getBook(''), 'VALIDATION_FAILED');
	});

	it('returns only contract fields, never internal records', async () => {
		const { backend } = await makeLocal();
		const book = await backend.catalogue.getBook('alices-adventures-in-wonderland');
		expect(book).not.toHaveProperty('listingState');
		expect(book.products[0]).not.toHaveProperty('refId');
	});
});
