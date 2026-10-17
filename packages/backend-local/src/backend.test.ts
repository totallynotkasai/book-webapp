import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendError, backendContract, type Backend, type Clock } from '@book/core';
import { describeBackendContract, expectBackendError, ManualClock } from '@book/contract-tests';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createLocalBackend, type LocalBackendOptions } from './backend';
import { inThreadPipeline, type Pipeline } from './pipeline';
import { SeedError } from './seed';
import { testSimulationDefaults } from './simulation';
import seedFile from '../../../fixtures/seed/seed.json';

const seedJson: unknown = seedFile;

/** Catalogue EPUBs come from the web app's static folder, as the app fetches them. */
const loadFile = async (url: string) =>
	new Uint8Array(
		readFileSync(join(fileURLToPath(new URL('../../../apps/web/static', import.meta.url)), url))
	);

/**
 * Processing a Book takes a moment, so tests share each Book's first Revision. A later one
 * (a Studio upload carried forward from another) is always processed afresh.
 */
const processed = new Map<string, ReturnType<Pipeline['ingest']>>();
const pipeline: Partial<Pipeline> = {
	ingest(bytes, options) {
		if (options.previous) return inThreadPipeline.ingest(bytes, options);
		const key = `${options.bookId}|${bytes.length}`;
		let result = processed.get(key);
		if (!result) {
			result = inThreadPipeline.ingest(bytes, options);
			processed.set(key, result);
		}
		return result;
	}
};

function makeLocal(options: Partial<LocalBackendOptions> & { clock?: Clock } = {}) {
	return createLocalBackend({
		dbName: `test-backend-${crypto.randomUUID()}`,
		loadSeed: async () => structuredClone(seedJson),
		baseClock: options.clock ?? new ManualClock(),
		simulationDefaults: testSimulationDefaults,
		validate: true,
		loadFile,
		pipeline,
		...options
	});
}

/** The status-window fixture, and a copy with one paragraph of Chapter 1 changed (P1-STU-01). */
const statusWindow = new Uint8Array(
	readFileSync(
		join(fileURLToPath(new URL('../../../fixtures/epub', import.meta.url)), 'status-window.epub')
	)
);
function editedStatusWindow(): Uint8Array {
	const files = unzipSync(statusWindow);
	const out: Zippable = { mimetype: [files.mimetype!, { level: 0 }] };
	for (const [path, data] of Object.entries(files)) {
		if (path === 'mimetype') continue;
		out[path] = path.endsWith('chapter-1.xhtml')
			? strToU8(strFromU8(data).replace('She blinked. The colour stayed.', 'She blinked twice.'))
			: data;
	}
	return zipSync(out);
}

/** The status-window fixture with a third Chapter at the end: a serial's next one (P1-STU-06). */
function extendedStatusWindow(): Uint8Array {
	const files = unzipSync(statusWindow);
	const out: Zippable = { mimetype: [files.mimetype!, { level: 0 }] };
	const edit = (path: string, from: string, to: string) => {
		const text = strFromU8(files[path]!);
		if (!text.includes(from)) throw new Error(`${path} has no ${from}`);
		return strToU8(text.replace(from, to));
	};
	for (const [path, data] of Object.entries(files)) {
		if (path === 'mimetype') continue;
		out[path] = path.endsWith('.opf')
			? edit(
					path,
					'<itemref idref="chapter-2"/>',
					'<itemref idref="chapter-2"/><itemref idref="chapter-3"/>'
				)
			: path.endsWith('nav.xhtml')
				? edit(path, '</ol>', '<li><a href="text/chapter-3.xhtml">3. The Next Map</a></li></ol>')
				: data;
	}
	const opf = Object.keys(out).find((p) => p.endsWith('.opf'))!;
	out[opf] = strToU8(
		strFromU8(out[opf] as Uint8Array).replace(
			'</manifest>',
			'<item id="chapter-3" href="text/chapter-3.xhtml" media-type="application/xhtml+xml"/></manifest>'
		)
	);
	out['OEBPS/text/chapter-3.xhtml'] = strToU8(
		'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html>' +
			'<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en"><head><title>Chapter 3</title></head>' +
			'<body><section><h1>Chapter 3: The Next Map</h1>' +
			'<p>Mara unrolled a clean sheet and began the map of the mill road, one careful line at a time.</p>' +
			'</section></body></html>'
	);
	return zipSync(out);
}

describeBackendContract(
	'backend-local',
	async ({ clock }) => (await makeLocal({ clock })).backend,
	{
		studio: {
			book: statusWindow,
			edited: editedStatusWindow(),
			extended: extendedStatusWindow(),
			names: { inFirstChapter: 'Mara Quill', inSecondChapter: 'Mill Floor' }
		}
	}
);

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

describe('store simulation (P1-STO-02, P1-STO-04)', () => {
	const ALICE_BUNDLE = 'product-bundle-alice-complete';

	it('a declined payment creates nothing; a failed one says nothing was charged', async () => {
		const { backend, controls } = await makeLocal();
		await controls.setSimulation({ paymentOutcome: 'decline' });
		await expectBackendError(
			backend.checkout.purchase(ALICE_BUNDLE, 'key-declined-1'),
			'PAYMENT_DECLINED'
		);
		await expectBackendError(
			backend.support.subscribe('plan-lamplighters-circle', 'key-declined-2'),
			'PAYMENT_DECLINED'
		);
		await controls.setSimulation({ paymentOutcome: 'fail' });
		const failed = await backend.checkout.purchase(ALICE_BUNDLE, 'key-failed-1').catch((e) => e);
		expect((failed as BackendError).code).toBe('SERVER_ERROR');
		expect((failed as BackendError).message).toMatch(/Nothing was charged/);
		expect((await backend.checkout.listOrders()).items).toEqual([]);
		// Trying again once payments work buys it.
		await controls.setSimulation({ paymentOutcome: 'succeed' });
		await backend.checkout.purchase(ALICE_BUNDLE, 'key-ok-1');
		expect((await backend.checkout.listOrders()).items).toHaveLength(1);
	});

	it('refunding a Bundle (dev panel) revokes the Book’s Layers it granted', async () => {
		const { backend, controls } = await makeLocal();
		const order = await backend.checkout.purchase(ALICE_BUNDLE, 'key-refund-1');
		const held = async () =>
			(await backend.layers.list('book-alice')).filter((l) => l.entitled).map((l) => l.id);
		expect(await held()).toEqual(['pack-alice-tenniel', 'track-alice-librivox-shallenberg']);
		await controls.refundOrder(order.id);
		expect(await held()).toEqual([]);
		// The Book itself came free before the Bundle, so it stays.
		await expect(backend.content.open('book-alice')).resolves.toMatchObject({ access: 'full' });
		expect((await controls.orders())[0]).toMatchObject({ id: order.id, status: 'refunded' });
	}, 60_000);

	it('renewals follow the dev clock and stop when a renewal is declined', async () => {
		const clock = new ManualClock();
		const { backend, controls } = await makeLocal({ clock });
		const sub = await backend.support.subscribe('plan-lamplighters-circle', 'key-renew-1');
		await controls.advanceClock(40 * 24 * 60 * 60 * 1000);
		const renewed = (await backend.support.listSubscriptions())[0]!;
		expect(renewed).toMatchObject({ id: sub.id, status: 'active' });
		expect(Date.parse(renewed.currentPeriodEnd)).toBeGreaterThan(Date.parse(sub.currentPeriodEnd));
		await controls.setSimulation({ paymentOutcome: 'decline' });
		await controls.advanceClock(40 * 24 * 60 * 60 * 1000);
		expect((await backend.support.listSubscriptions())[0]).toMatchObject({
			status: 'ended',
			endedAt: renewed.currentPeriodEnd
		});
	});

	it('tester builds start the Reader with Alice’s Layers; owner builds leave them to get', async () => {
		const owner = await makeLocal();
		const tester = await makeLocal({ profile: 'tester' });
		const entitled = async (b: Backend) =>
			(await b.layers.list('book-alice')).filter((l) => l.entitled).map((l) => l.id);
		expect(await entitled(owner.backend)).toEqual([]);
		expect(await entitled(tester.backend)).toEqual([
			'pack-alice-tenniel',
			'pack-alice-rackham',
			'track-alice-librivox-shallenberg'
		]);
	});

	describe('moderation in backend-local (P1-ADM-01)', () => {
		const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

		/** As the Illustrator: a published community pack for Alice (policy `open`). */
		async function packForAlice(backend: Backend, aiUse: 'none' | 'generated') {
			const opened = await backend.content.open('book-alice');
			const manifest = JSON.parse(
				await (await backend.content.read(opened.contentToken, 'manifest.json')).text()
			) as { chapters: { chapterId: string; wordCount: number }[] };
			const chapter = manifest.chapters.find((c) => c.wordCount > 0)!;
			const index = JSON.parse(
				await (
					await backend.content.read(opened.contentToken, `index/${chapter.chapterId}.words.json`)
				).text()
			) as { firstOrdinal: number; words: [number, number, number, number][] };
			const pack = await backend.studio.createPack('book-alice', { aiUse });
			await backend.studio.addIllustration(pack.id, {
				anchor: {
					kind: 'range',
					bookId: 'book-alice',
					revisionId: opened.revisionId,
					startWordId: index.words[0]![0],
					endWordId: index.words[1]![0],
					startOrdinal: index.firstOrdinal,
					endOrdinal: index.firstOrdinal + 1,
					quote: { exact: 'x', prefix: '', suffix: '' }
				},
				placement: 'inline',
				span: 'single',
				alt: 'A picture',
				spoilerSafe: false,
				image: {
					width: 1,
					height: 1,
					dominant: '#808080',
					variants: [{ width: 1, file: new Blob([PNG]) }]
				}
			});
			return backend.studio.publishPack(pack.id);
		}

		it('holds unlabelled work the stub detector suspects, and a suspension stops the creator', async () => {
			const { backend, controls } = await makeLocal();
			await controls.setSimulation({ aiDetectorVerdict: 'suspect' });
			await backend.session.signInAs('illustrator');
			const held = await packForAlice(backend, 'none');
			expect(held.listingState).toBe('held');
			expect((await backend.layers.list('book-alice')).map((l) => l.id)).not.toContain(held.id);
			// Labelled AI is never suspected of being unlabelled.
			expect((await packForAlice(backend, 'generated')).listingState).toBe('listed');

			await backend.session.signInAs('moderator');
			const flag = (await backend.moderation.listQueue()).items.find(
				(f) => f.targetId === held.id && f.rule === 'ai_untagged_suspected'
			)!;
			const detail = await backend.moderation.getFlag(flag.id);
			expect(detail.detectorScore).toBeGreaterThanOrEqual(0.8);
			await backend.moderation.act(flag.id, {
				action: 'suspend',
				reason: 'Repeated mislabelling.'
			});
			await backend.session.signInAs('illustrator');
			await expectBackendError(backend.studio.createPack('book-alice', {}), 'FORBIDDEN');
		});

		it('ten packs in thirty days raise upload_volume; labelled AI stays listed', async () => {
			const { backend } = await makeLocal();
			await backend.session.signInAs('illustrator');
			for (let i = 0; i < 10; i++) {
				expect((await packForAlice(backend, 'generated')).listingState).toBe('listed');
			}
			await backend.session.signInAs('moderator');
			const queue = (await backend.moderation.listQueue()).items;
			expect(
				queue.filter((f) => f.rule === 'upload_volume' && f.targetId === 'creator-ink-and-quill')
			).toHaveLength(1);
		});
	});
});

describe('the seeded story so far (P1-STU-05, P1-RDR-13)', () => {
	it('is the Ledger’s, found in its text the first time it’s read', async () => {
		const { backend } = await makeLocal();
		await backend.session.signInAs('author');
		const story = (await backend.content.storySoFar('book-lamplighters-ledger'))!;
		expect(story.aiUse).toBe('generated');
		expect(story.recaps).toHaveLength(6);
		expect(story.revisionId).toBe(
			(await backend.content.open('book-lamplighters-ledger')).revisionId
		);
		const cobb = story.glossary.find((e) => e.id === 'entry-mister-cobb')!;
		expect(cobb.names.map((n) => n.name)).toEqual(['Mister Cobb', 'Ezra Cobb']);
		expect(cobb.names[1]!.firstAppearance.startOrdinal).toBeGreaterThan(
			cobb.names[0]!.firstAppearance.startOrdinal
		);
		// The Studio sees the same, as its draft.
		const studio = await backend.studio.getStory('book-lamplighters-ledger');
		expect(studio).toMatchObject({ aiUse: 'generated', unpublishedChanges: false, problems: [] });
		// Every Chapter with Words can have one, front matter too (left empty here).
		expect(studio.recaps.map((r) => r.title)).toEqual([
			'About This Serial',
			'1. Dusk Shift',
			'2. The Ledger',
			'3. Murk on Saltgate Bridge',
			'4. Sigil-Lights',
			'5. The Lamp That Remembers',
			'6. Balancing the Ledger'
		]);
		expect(studio.glossary.every((e) => e.names[0]!.firstAppearance)).toBe(true);
	});

	it('gives a sample reader only what their sample Chapters hold', async () => {
		const { backend } = await makeLocal();
		const story = (await backend.content.storySoFar('book-lamplighters-ledger'))!;
		const opened = await backend.content.open('book-lamplighters-ledger', { sample: true });
		const locked = new Set(opened.locked.map((l) => l.chapterId));
		expect(locked.size).toBeGreaterThan(0);
		expect(story.recaps.length).toBe(6 - locked.size);
		expect(story.recaps.some((r) => locked.has(r.chapterId))).toBe(false);
		expect(story.glossary.map((e) => e.id)).not.toContain('entry-isolde-vell');
		await expectBackendError(backend.content.storySoFar('book-unknown'), 'NOT_FOUND');
	});
});
