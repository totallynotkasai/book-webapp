/**
 * The store part of the Backend contract (P1-STO-01 to P1-STO-04, DESIGN.md §6.5): shelves and
 * search, Book pages and their offers, claims and purchases (idempotent, Bundles granting their
 * children), samples, early access through Creator Subscriptions, Tips, Bookmark Designs and
 * store previews. Payments succeed here: declined payments are an implementation's simulation
 * control, tested with it.
 *
 * Seed assumptions: a reader Persona with at least one free and one paid Book they don't own,
 * a Book with a Complete edition (a Bundle including Layers) they don't fully own, a serial
 * with early access and a Creator Subscription plan, and a Book with spoiler-safe Illustrations
 * and an official narration.
 */
import type { Backend, BookPageDto, PersonaDto, Role } from '@book/core';
import { describe, expect, it } from 'vitest';
import { expectBackendError } from './backend';
import type { ManualClock } from './clock';

interface Context {
	backend(): Backend;
	clock(): ManualClock;
	personas(): PersonaDto[];
	conforms(module: string, method: string, value: unknown): void;
}

const DAY = 24 * 60 * 60 * 1000;
let keys = 0;
const key = () => `contract-key-${Date.now()}-${keys++}`;

export function describeStoreContract(ctx: Context): void {
	const { conforms } = ctx;

	async function asReader() {
		const reader = ctx.personas().find((p) => p.user.role === ('reader' satisfies Role));
		if (!reader) throw new Error('The seed needs a reader Persona');
		await ctx.backend().session.signInAs(reader.id);
	}

	/** The listed Book pages, as the reader sees them. */
	async function pages(): Promise<BookPageDto[]> {
		const backend = ctx.backend();
		const { items } = await backend.catalogue.listBooks({ limit: 100 });
		return Promise.all(items.map((b) => backend.catalogue.getBook(b.slug)));
	}

	async function pageWhere(what: string, test: (page: BookPageDto) => boolean) {
		const page = (await pages()).find(test);
		if (!page) throw new Error(`The seed needs ${what}`);
		return page;
	}

	const bookOffer = (page: BookPageDto) => page.offers.find((o) => o.kind === 'book')!;

	describe('store: catalogue (P1-STO-01)', () => {
		it('lists shelves of listed Books, and searches title, creator and description', async () => {
			const backend = ctx.backend();
			const shelves = await backend.catalogue.listShelves();
			conforms('catalogue', 'listShelves', shelves);
			expect(shelves.length).toBeGreaterThan(0);
			const listed = new Set(
				(await backend.catalogue.listBooks({ limit: 100 })).items.map((b) => b.id)
			);
			for (const shelf of shelves)
				for (const id of shelf.bookIds) expect(listed.has(id)).toBe(true);

			const [first] = (await backend.catalogue.listBooks()).items;
			const word = first!.title.split(/\s+/).find((w) => w.length > 3) ?? first!.title;
			const found = await backend.catalogue.search(word.toUpperCase());
			conforms('catalogue', 'search', found);
			expect(found.items.map((b) => b.id)).toContain(first!.id);
			const byCreator = await backend.catalogue.search(first!.creatorName);
			expect(byCreator.items.map((b) => b.id)).toContain(first!.id);
			expect((await backend.catalogue.search('zzqx nothing matches this')).items).toEqual([]);
		});

		it('offers the Complete edition first, priced for what the reader already owns', async () => {
			await asReader();
			const page = await pageWhere(
				'a Book with a Complete edition',
				(p) => p.offers[0]?.kind === 'bundle'
			);
			conforms('catalogue', 'getBook', page);
			const [bundle, book] = page.offers;
			expect(book!.kind).toBe('book');
			expect(bundle!.includes).toContain(book!.productId);
			expect(bundle!.priceForYou.amountMinor).toBeLessThanOrEqual(bundle!.price.amountMinor);
			// What the Bundle includes besides the Book are this Book's Layers.
			const layerIds = new Set(page.layers.map((l) => l.productId));
			for (const id of bundle!.includes.filter((i) => i !== book!.productId)) {
				expect(layerIds.has(id)).toBe(true);
			}
		});

		it('lists Bookmark Designs: one default everyone owns, and others to get', async () => {
			await asReader();
			const designs = await ctx.backend().catalogue.listBookmarkDesigns();
			conforms('catalogue', 'listBookmarkDesigns', designs);
			const defaults = designs.filter((d) => d.isDefault);
			expect(defaults).toHaveLength(1);
			expect(defaults[0]!.owned).toBe(true);
			expect(designs.some((d) => !d.owned)).toBe(true);
		});
	});

	describe('store: checkout (P1-STO-02, Invariants 15 and 17)', () => {
		it('"Add to library" claims a free Book; claiming again gives the same order', async () => {
			await asReader();
			const backend = ctx.backend();
			const page = await pageWhere(
				'a free Book the reader doesn’t own',
				(p) => !p.inLibrary && bookOffer(p).price.amountMinor === 0
			);
			const order = await backend.checkout.claim(bookOffer(page).productId);
			conforms('checkout', 'claim', order);
			expect(order).toMatchObject({
				status: 'claimed',
				total: { amountMinor: 0 },
				bookId: page.id
			});
			expect((await backend.checkout.claim(bookOffer(page).productId)).id).toBe(order.id);
			expect((await backend.catalogue.getBook(page.slug)).inLibrary).toBe(true);
			const library = (await backend.library.list({ limit: 100 })).items;
			const entry = library.find((e) => e.book.id === page.id)!;
			expect(entry.entitlements.map((e) => e.source)).toContain('free_claim');
		});

		it('buys once per idempotency key, even when the button is pressed twice', async () => {
			await asReader();
			const backend = ctx.backend();
			const page = await pageWhere(
				'a paid Book the reader doesn’t own',
				(p) => !p.inLibrary && bookOffer(p).price.amountMinor > 0
			);
			const productId = bookOffer(page).productId;
			await expectBackendError(backend.checkout.claim(productId), 'CONFLICT');
			const k = key();
			const [a, b] = await Promise.all([
				backend.checkout.purchase(productId, k),
				backend.checkout.purchase(productId, k)
			]);
			conforms('checkout', 'purchase', a);
			expect(b.id).toBe(a.id);
			expect(a).toMatchObject({ status: 'paid', total: bookOffer(page).price });
			const orders = await backend.checkout.listOrders({ limit: 100 });
			conforms('checkout', 'listOrders', orders);
			expect(orders.items.filter((o) => o.items[0]!.productId === productId)).toHaveLength(1);
			expect((await backend.checkout.purchase(productId, k)).id).toBe(a.id);
			await expectBackendError(backend.checkout.purchase(productId, key()), 'CONFLICT');
			await expect(backend.content.open(page.id)).resolves.toMatchObject({ access: 'full' });
		});

		it('the Complete edition grants the Book’s Layers, which then open', async () => {
			await asReader();
			const backend = ctx.backend();
			const page = await pageWhere(
				'a Complete edition the reader doesn’t fully own',
				(p) => p.offers[0]?.kind === 'bundle' && !p.offers[0].owned
			);
			const bundle = page.offers[0]!;
			const inBundle = page.layers.filter((l) => bundle.includes.includes(l.productId));
			expect(inBundle.length).toBeGreaterThan(0);
			expect(inBundle.some((l) => !l.entitled)).toBe(true);
			const order = await backend.checkout.purchase(bundle.productId, key());
			expect(order.total).toEqual(bundle.priceForYou);
			const after = await backend.layers.list(page.id);
			for (const layer of after.filter((l) => bundle.includes.includes(l.productId))) {
				expect(layer.entitled).toBe(true);
				if (layer.kind === 'illustration_pack') await backend.layers.openPack(layer.id);
				else await backend.layers.openTrack(layer.id);
			}
			expect((await backend.catalogue.getBook(page.slug)).offers[0]!.owned).toBe(true);
			const library = (await backend.library.list({ limit: 100 })).items;
			const sources = library.find((e) => e.book.id === page.id)!.entitlements;
			expect(sources.some((e) => e.source === 'bundle' && e.parentId)).toBe(true);
		}, 60_000);
	});

	describe('store: samples (P1-STO-01)', () => {
		it('a reader who doesn’t own a Book reads its sample; the rest is locked and refused', async () => {
			await asReader();
			const backend = ctx.backend();
			const page = await pageWhere('a Book with a sample', (p) => p.hasSample && !p.inLibrary);
			await expectBackendError(backend.content.open(page.id), 'ENTITLEMENT_REQUIRED');
			const opened = await backend.content.open(page.id, { sample: true });
			conforms('content', 'open', opened);
			expect(opened.access).toBe('sample');
			expect(opened.locked.length).toBeGreaterThan(0);
			for (const l of opened.locked) expect(l.reason).toBe('sample');
			const manifest = JSON.parse(
				await (await backend.content.read(opened.contentToken, 'manifest.json')).text()
			) as { chapters: { chapterId: string; href: string }[] };
			const locked = new Set(opened.locked.map((l) => l.chapterId));
			const open = manifest.chapters.filter((c) => !locked.has(c.chapterId));
			const shut = manifest.chapters.find((c) => locked.has(c.chapterId))!;
			expect(open.length).toBeGreaterThan(0);
			await backend.content.read(opened.contentToken, `content/${open.at(-1)!.href}`);
			await expectBackendError(
				backend.content.read(opened.contentToken, `content/${shut.href}`),
				'ENTITLEMENT_REQUIRED'
			);
		}, 60_000);
	});

	describe('store: support (P1-STO-04)', () => {
		it('Tips are one-off, idempotent and grant nothing', async () => {
			await asReader();
			const backend = ctx.backend();
			const page = await pageWhere('a Book whose Creator has a plan', (p) => p.planIds.length > 0);
			const plans = await backend.support.listPlans(page.creator.handle);
			conforms('support', 'listPlans', plans);
			expect(plans.map((p) => p.id)).toEqual(page.planIds);
			const before = (await backend.library.list({ limit: 100 })).items.length;
			const input = {
				creatorId: page.creatorId,
				bookId: page.id,
				amount: { amountMinor: 300, currency: 'GBP' },
				message: 'Lovely chapter.',
				idempotencyKey: key()
			};
			const [a, b] = await Promise.all([backend.support.tip(input), backend.support.tip(input)]);
			conforms('support', 'tip', a);
			expect(b.id).toBe(a.id);
			const tips = await backend.support.listTips();
			conforms('support', 'listTips', tips);
			expect(tips.filter((t) => t.id === a.id)).toHaveLength(1);
			expect((await backend.library.list({ limit: 100 })).items.length).toBe(before);
		});

		it('a subscription opens early access until its paid period ends; purchases stay', async () => {
			await asReader();
			const backend = ctx.backend();
			const serial = await pageWhere(
				'a serial with a plan',
				(p) => p.isSerial && p.planIds.length > 0
			);
			if (!serial.inLibrary) {
				const offer = bookOffer(serial);
				if (offer.price.amountMinor > 0) await backend.checkout.purchase(offer.productId, key());
				else await backend.checkout.claim(offer.productId);
			}
			const early = (await backend.content.open(serial.id)).locked;
			expect(early.length).toBeGreaterThan(0);
			for (const l of early) {
				expect(l).toMatchObject({ reason: 'early_access', planId: serial.planIds[0] });
				expect(l.freeAt).not.toBeNull();
			}

			const sub = await backend.support.subscribe(serial.planIds[0]!, key());
			conforms('support', 'subscribe', sub);
			expect(sub.status).toBe('active');
			await expectBackendError(backend.support.subscribe(serial.planIds[0]!, key()), 'CONFLICT');
			expect((await backend.content.open(serial.id)).locked).toEqual([]);

			const cancelled = await backend.support.cancel(sub.id);
			conforms('support', 'cancel', cancelled);
			expect(cancelled.status).toBe('cancelled');
			// Still open until the end of the paid period.
			expect((await backend.content.open(serial.id)).locked).toEqual([]);

			ctx.clock().advance(Date.parse(sub.currentPeriodEnd) - ctx.clock().now().getTime() + DAY);
			const subs = await backend.support.listSubscriptions();
			conforms('support', 'listSubscriptions', subs);
			expect(subs.find((s) => s.id === sub.id)!.status).toBe('ended');
			expect((await backend.content.open(serial.id)).locked.map((l) => l.chapterId)).toEqual(
				early.map((l) => l.chapterId)
			);
			const library = (await backend.library.list({ limit: 100 })).items.map((e) => e.book.id);
			expect(library).toContain(serial.id);
		}, 60_000);
	});

	describe('store: previews (Invariant 6)', () => {
		it('a Book page’s Illustration previews are spoiler-safe, under a token that reads only them', async () => {
			await asReader();
			const backend = ctx.backend();
			const page = await pageWhere('a Book with Illustrations', (p) => p.hasIllustrations);
			const previews = await backend.layers.previews(page.id);
			conforms('layers', 'previews', previews);
			expect(previews.illustrations.length).toBeGreaterThan(0);
			const image = await backend.content.read(
				previews.contentToken,
				previews.illustrations[0]!.image.variants[0]!.path
			);
			expect(image.type).toMatch(/^image\//);

			// Compare with the packs as a Persona who holds them: every preview is spoiler-safe.
			for (const persona of ctx.personas()) {
				await backend.session.signInAs(persona.id);
				const packs = (await backend.layers.list(page.id)).filter(
					(l) => l.kind === 'illustration_pack' && l.entitled
				);
				if (!packs.length) continue;
				const safe = new Set<string>();
				let unsafe: string | undefined;
				for (const pack of packs) {
					const opened = await backend.layers.openPack(pack.id);
					for (const ill of opened.illustrations) {
						if (ill.spoilerSafe) safe.add(ill.id);
						else unsafe ??= `${pack.id}/${ill.image.variants[0]!.path}`;
					}
				}
				const fromHeldPacks = previews.illustrations.filter((p) =>
					packs.some((pack) => pack.id === p.packId)
				);
				for (const p of fromHeldPacks) expect(safe.has(p.id)).toBe(true);
				if (unsafe) {
					await expectBackendError(
						backend.content.read(previews.contentToken, unsafe),
						'NOT_FOUND'
					);
				}
				break;
			}
		}, 60_000);

		it('a Book page plays a short sample of its official narration', async () => {
			await asReader();
			const backend = ctx.backend();
			const page = await pageWhere('a Book with narration', (p) => p.hasNarration);
			const sample = await backend.layers.narrationSample(page.id);
			conforms('layers', 'narrationSample', sample);
			expect(sample).not.toBeNull();
			expect(sample!.track.bookId).toBe(page.id);
			expect(sample!.durationMs).toBeGreaterThan(0);
			const none = (await pages()).find((p) => !p.hasNarration)!;
			expect(await backend.layers.narrationSample(none.id)).toBeNull();
		});
	});
}
