/**
 * The one place the app chooses its implementations (DESIGN.md Invariant 7). Phase 2 swaps
 * `backend-local` for `backend-http` and wraps `storage-local` in `storage-remote` here, once
 * both pass the contract suites. ESLint stops anything else in apps/web importing them.
 */
import type { Backend, Stores } from '@book/core';
import type { LocalBackend, LocalBackendControls, SimulationSettings } from '@book/backend-local';
import type { LocalStores } from '@book/storage-local';
import { asset } from '$app/paths';
import { profile } from '$lib/flags';
import { ingestInWorker, migrateInWorker, wordsInWorker } from '$lib/import/ingest';
// Fetched at runtime, never bundled, to protect the reader route's JavaScript budget (plan §4.3).
import seedUrl from '../../../../fixtures/seed/seed.json?url';

declare global {
	/** Playwright sets this before the app loads, so E2E runs instantly and reliably (plan §9). */
	var __BOOK_E2E_SIMULATION__: SimulationSettings | undefined;
}

let local: Promise<LocalBackend> | undefined;
let stores: Promise<LocalStores> | undefined;

function localBackend(): Promise<LocalBackend> {
	local ??= import('@book/backend-local').then(({ createLocalBackend, ownerSimulationDefaults }) =>
		createLocalBackend({
			loadSeed: async () => {
				const response = await fetch(seedUrl);
				if (!response.ok) throw new Error(`Couldn't load the demo seed (${response.status}).`);
				return response.json();
			},
			simulationDefaults: globalThis.__BOOK_E2E_SIMULATION__ ?? ownerSimulationDefaults,
			validate: import.meta.env.DEV,
			// Tester builds have no store, so the seed starts them with Alice's Layers (plan §6 1.6).
			profile,
			// Seeded EPUBs are static files; text-pipeline processes them, and Studio uploads, in a Web
			// Worker (§5.4).
			loadFile: async (url) => {
				const response = await fetch(asset(url as `/${string}`));
				if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status}).`);
				return new Uint8Array(await response.arrayBuffer());
			},
			pipeline: {
				ingest: (bytes, { bookId, firstWordId, previous }) =>
					ingestInWorker(bytes, {
						bookId,
						firstWordId,
						previous: previous ? { files: previous, anchors: [], progress: [] } : undefined
					}),
				migrate: (input) => migrateInWorker(input),
				words: (revision) => wordsInWorker(revision)
			}
		})
	);
	return local;
}

export async function getBackend(): Promise<Backend> {
	return (await localBackend()).backend;
}

/**
 * User-owned data for whoever is signed in. In the PoC each Persona has its own database
 * (`book-reader:<userId>`), which rehearses Phase 2's per-account data (DESIGN.md §6.3).
 */
export function getStores(): Promise<Stores> {
	stores ??= (async () => {
		const [{ controls }, { createLocalStores }] = await Promise.all([
			localBackend(),
			import('@book/storage-local')
		]);
		return createLocalStores({ dbName: `book-reader:${controls.currentUserId()}` });
	})();
	return stores;
}

export type { LocalBackendControls as DevControls, SimulationSettings };

/** The dev panel's controls (owner builds only). Not part of `Backend`; no Phase 2 equivalent. */
export async function getDevControls(): Promise<LocalBackendControls> {
	return (await localBackend()).controls;
}

/** Deletes everything this app stores on the device: every Persona's data and the demo backend. */
export async function wipeDeviceData(): Promise<void> {
	// Close this page's own connections first, or the deletes wait on them (other tabs close theirs
	// when they see the delete coming).
	(await stores)?.close();
	(await local)?.controls.close();
	const databases = await indexedDB.databases();
	await Promise.all(
		databases
			.map((db) => db.name)
			.filter((name): name is string => !!name && name.startsWith('book-'))
			.map(
				(name) =>
					new Promise<void>((resolve, reject) => {
						const request = indexedDB.deleteDatabase(name);
						request.onsuccess = () => resolve();
						request.onerror = () => reject(request.error);
					})
			)
	);
	localStorage.clear();
}
