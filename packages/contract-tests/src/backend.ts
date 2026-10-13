/**
 * The Backend contract (docs/DESIGN.md §5.6, IMPLEMENTATION-PLAN.md §4.5). Run it against every
 * `Backend`: `backend-local` now, `backend-http` against the Docker API in Phase 2. It checks
 * behaviour and validates every response against `backendContract` itself, so an implementation
 * can't pass by skipping its own validation.
 *
 * It assumes only what any seeded environment provides: at least one Persona per role (reader,
 * creator, moderator), at least two listed Books, a library entry for the reader Persona whose
 * text opens, a listed Book the reader doesn't own, and in the reader's library a Book with an
 * Illustration Pack and one with a narration Audio Track, each of which some Persona lacks.
 */
import {
	BackendError,
	backendContract,
	parseSyncMap,
	type Backend,
	type ErrorCode,
	type PersonaDto,
	type Role
} from '@book/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ManualClock } from './clock';

/** Must return a freshly seeded, independent backend on every call, signed in as the default. */
export type MakeBackend = (context: { clock: ManualClock }) => Promise<Backend>;

export async function expectBackendError(promise: Promise<unknown>, code: ErrorCode) {
	const error = await promise.then(
		() => undefined,
		(e: unknown) => e
	);
	expect(error, `expected a BackendError ${code}`).toBeInstanceOf(BackendError);
	expect((error as BackendError).code).toBe(code);
}

function conforms<M extends keyof typeof backendContract>(
	module: M,
	method: keyof (typeof backendContract)[M],
	value: unknown
) {
	const contract = backendContract[module][method] as {
		output: { safeParse(v: unknown): { success: boolean; error?: unknown } };
	};
	const result = contract.output.safeParse(value);
	expect(
		result.success,
		`${String(module)}.${String(method)} output: ${String(result.error)}`
	).toBe(true);
}

export function describeBackendContract(name: string, makeBackend: MakeBackend): void {
	describe(`Backend contract: ${name}`, () => {
		let backend: Backend;
		let personas: PersonaDto[];
		let clock: ManualClock;

		const personaWithRole = (role: Role) => {
			const persona = personas.find((p) => p.user.role === role);
			if (!persona) throw new Error(`The seed needs a ${role} Persona`);
			return persona;
		};

		beforeEach(async () => {
			clock = new ManualClock();
			backend = await makeBackend({ clock });
			personas = await backend.session.listPersonas();
		});

		describe('session', () => {
			it('lists Personas and starts signed in', async () => {
				conforms('session', 'listPersonas', personas);
				expect(personas.length).toBeGreaterThan(0);
				const session = await backend.session.current();
				conforms('session', 'current', session);
				expect(session.user).not.toBeNull();
			});

			it('signs in as a Persona and notifies `session` listeners', async () => {
				const creator = personaWithRole('creator');
				let notified = 0;
				const off = backend.events.on('session', () => notified++);
				const session = await backend.session.signInAs(creator.id);
				off();
				conforms('session', 'signInAs', session);
				expect(session.user).toEqual(creator.user);
				expect((await backend.session.current()).user).toEqual(creator.user);
				expect(notified).toBe(1);
			});

			it('rejects an unknown Persona with NOT_FOUND', async () => {
				await expectBackendError(backend.session.signInAs('no-such-persona'), 'NOT_FOUND');
			});
		});

		describe('catalogue', () => {
			it('pages through every listed Book exactly once', async () => {
				const all = await backend.catalogue.listBooks({ limit: 100 });
				conforms('catalogue', 'listBooks', all);
				expect(all.items.length).toBeGreaterThanOrEqual(2);
				expect(all.nextCursor).toBeNull();

				const seen: string[] = [];
				let cursor: string | undefined;
				do {
					const page = await backend.catalogue.listBooks({ limit: 1, cursor });
					conforms('catalogue', 'listBooks', page);
					expect(page.items.length).toBeLessThanOrEqual(1);
					seen.push(...page.items.map((b) => b.id));
					cursor = page.nextCursor ?? undefined;
				} while (cursor);
				expect(seen).toEqual(all.items.map((b) => b.id));
			});

			it('uses integer minor units and ISO 4217 codes for prices (Invariant 17)', async () => {
				const { items } = await backend.catalogue.listBooks({ limit: 100 });
				for (const book of items) {
					expect(Number.isInteger(book.price.amountMinor)).toBe(true);
					expect(book.price.currency).toMatch(/^[A-Z]{3}$/);
				}
			});

			it('opens a Book page by slug and its Creator by handle', async () => {
				const [first] = (await backend.catalogue.listBooks()).items;
				const book = await backend.catalogue.getBook(first!.slug);
				conforms('catalogue', 'getBook', book);
				expect(book.id).toBe(first!.id);
				expect(book.products.some((p) => p.kind === 'book')).toBe(true);

				const creator = await backend.catalogue.getCreator(book.creator.handle);
				conforms('catalogue', 'getCreator', creator);
				expect(creator.id).toBe(book.creatorId);
			});

			it('rejects unknown slugs and handles with NOT_FOUND', async () => {
				await expectBackendError(backend.catalogue.getBook('no-such-book'), 'NOT_FOUND');
				await expectBackendError(backend.catalogue.getCreator('no-such-creator'), 'NOT_FOUND');
			});

			it('lists a Creator’s own listed Books for their profile', async () => {
				const [first] = (await backend.catalogue.listBooks()).items;
				const book = await backend.catalogue.getBook(first!.slug);
				const books = await backend.catalogue.listCreatorBooks(book.creator.handle);
				conforms('catalogue', 'listCreatorBooks', books);
				expect(books.items.map((b) => b.id)).toContain(book.id);
				for (const b of books.items) expect(b.creatorId).toBe(book.creatorId);
				await expectBackendError(
					backend.catalogue.listCreatorBooks('no-such-creator'),
					'NOT_FOUND'
				);
			});

			it('rejects a malformed cursor with VALIDATION_FAILED', async () => {
				await expectBackendError(
					backend.catalogue.listBooks({ cursor: 'not-a-cursor' }),
					'VALIDATION_FAILED'
				);
			});
		});

		describe('library', () => {
			it('lists the reader’s Books with the Entitlements that grant them', async () => {
				await backend.session.signInAs(personaWithRole('reader').id);
				const library = await backend.library.list();
				conforms('library', 'list', library);
				expect(library.items.length).toBeGreaterThan(0);
				for (const entry of library.items) expect(entry.entitlements.length).toBeGreaterThan(0);
			});
		});

		describe('content (Entitlements first, Invariants 15 and 16)', () => {
			async function ownedAndNot() {
				await backend.session.signInAs(personaWithRole('reader').id);
				const owned = (await backend.library.list({ limit: 100 })).items.map((e) => e.book.id);
				const all = (await backend.catalogue.listBooks({ limit: 100 })).items;
				const notOwned = all.find((b) => !owned.includes(b.id));
				if (!notOwned) throw new Error('The seed needs a Book the reader does not own');
				return { owned: owned[0]!, notOwned: notOwned.id };
			}

			it('opens an owned Book and reads its files with the token', async () => {
				const { owned } = await ownedAndNot();
				const opened = await backend.content.open(owned);
				conforms('content', 'open', opened);
				expect(opened.bookId).toBe(owned);
				const manifestFile = await backend.content.read(opened.contentToken, 'manifest.json');
				conforms('content', 'read', manifestFile);
				const manifest = JSON.parse(await manifestFile.text()) as {
					bookId: string;
					revisionId: string;
				};
				expect(manifest).toMatchObject({ bookId: owned, revisionId: opened.revisionId });
				await expectBackendError(
					backend.content.read(opened.contentToken, 'no/such/file'),
					'NOT_FOUND'
				);
			}, 60_000);

			it('refuses a Book without an Entitlement, and unknown Books', async () => {
				const { notOwned } = await ownedAndNot();
				await expectBackendError(backend.content.open(notOwned), 'ENTITLEMENT_REQUIRED');
				await expectBackendError(backend.content.open('no-such-book'), 'NOT_FOUND');
			});

			it('stops honouring a token once it expires, or one it never issued', async () => {
				const { owned } = await ownedAndNot();
				const opened = await backend.content.open(owned);
				await expectBackendError(
					backend.content.read('f'.repeat(48), 'manifest.json'),
					'UNAUTHENTICATED'
				);
				clock.advance(Date.parse(opened.expiresAt) - clock.now().getTime() + 1);
				await expectBackendError(
					backend.content.read(opened.contentToken, 'manifest.json'),
					'UNAUTHENTICATED'
				);
			}, 60_000);
		});

		describe('layers (Entitlements first, §8.1, Invariants 15 and 16)', () => {
			/** The first Book in the reader's library with a Layer of this kind. */
			async function bookWith(kind: 'illustration_pack' | 'audio_track') {
				await backend.session.signInAs(personaWithRole('reader').id);
				const library = await backend.library.list();
				for (const entry of library.items) {
					const layers = await backend.layers.list(entry.book.id);
					if (layers.some((l) => l.kind === kind)) return { bookId: entry.book.id, layers };
				}
				throw new Error(`The seed needs a Book with a ${kind} in the reader’s library.`);
			}
			async function bookWithPacks() {
				const { bookId, layers } = await bookWith('illustration_pack');
				return { bookId, packs: layers.filter((l) => l.kind === 'illustration_pack') };
			}

			it('lists a Book’s Layers, packs then tracks, official first, saying which the user holds', async () => {
				const { layers } = await bookWith('illustration_pack');
				conforms('layers', 'list', layers);
				const kinds = layers.map((l) => l.kind);
				expect(kinds).toEqual([...kinds].sort((a, b) => a.localeCompare(b)).reverse());
				for (const kind of new Set(kinds)) {
					const official = layers.filter((l) => l.kind === kind).map((l) => l.isOfficial);
					expect(official).toEqual([...official].sort((a, b) => Number(b) - Number(a)));
				}
				expect(layers.some((p) => p.entitled)).toBe(true);
				expect(await backend.layers.list('no-such-book')).toEqual([]);
			});

			it('opens a pack: Illustrations on Anchors, in reading order, images through content.read', async () => {
				const { packs } = await bookWithPacks();
				const opened = await backend.layers.openPack(packs.find((p) => p.entitled)!.id);
				conforms('layers', 'openPack', opened);
				expect(opened.illustrations.length).toBeGreaterThan(0);
				const starts = opened.illustrations.map((i) => i.anchor.startOrdinal);
				expect(starts).toEqual([...starts].sort((a, b) => a - b));
				for (const ill of opened.illustrations) {
					expect(ill.alt.trim()).not.toBe('');
					expect(ill.anchor.revisionId).toBe(opened.revisionId);
				}
				const image = await backend.content.read(
					opened.contentToken,
					opened.illustrations[0]!.image.variants[0]!.path
				);
				expect(image.type).toMatch(/^image\//);
				expect(image.size).toBeGreaterThan(0);
				// A pack's token opens that pack's files and nothing else.
				await expectBackendError(
					backend.content.read(opened.contentToken, '../../books/alice.epub'),
					'NOT_FOUND'
				);
			});

			it('rejects packs the user doesn’t hold, and unknown ones', async () => {
				const { bookId } = await bookWithPacks();
				let rejected = false;
				for (const persona of await backend.session.listPersonas()) {
					await backend.session.signInAs(persona.id);
					const missing = (await backend.layers.list(bookId)).find(
						(p) => p.kind === 'illustration_pack' && !p.entitled
					);
					if (!missing) continue;
					await expectBackendError(backend.layers.openPack(missing.id), 'ENTITLEMENT_REQUIRED');
					rejected = true;
					break;
				}
				expect(rejected, 'the seed needs a Persona without some pack').toBe(true);
				await expectBackendError(backend.layers.openPack('no-such-pack'), 'NOT_FOUND');
			});

			it('opens an Audio Track: per Chapter a Sync Map through content.read, and its audio', async () => {
				const { bookId, layers } = await bookWith('audio_track');
				const track = layers.find((l) => l.kind === 'audio_track' && l.entitled)!;
				const opened = await backend.layers.openTrack(track.id);
				conforms('layers', 'openTrack', opened);
				expect(opened.track.id).toBe(track.id);
				expect(opened.chapters.length).toBeGreaterThan(0);
				const book = await backend.content.open(bookId);
				const first = opened.chapters[0]!;
				const map = parseSyncMap(
					JSON.parse(await (await backend.content.read(opened.contentToken, first.syncMap)).text())
				);
				expect(map.trackId).toBe(track.id);
				expect(map.chapterId).toBe(first.chapterId);
				expect(map.revisionId).toBe(opened.revisionId);
				expect(map.durationMs).toBe(first.durationMs);
				// Aligned to the Revision readers open, so every Chapter is ready (§7.2).
				expect(opened.revisionId).toBe(book.revisionId);
				for (const chapter of opened.chapters) {
					expect(chapter.status).toBe(chapter.coverage < 0.9 ? 'needs_review' : 'ready');
					expect(chapter.audioUrl).not.toBe('');
				}
				await expectBackendError(
					backend.content.read(opened.contentToken, '../../books/alice.epub'),
					'NOT_FOUND'
				);
			}, 60_000);

			it('rejects Audio Tracks the user doesn’t hold, and unknown ones', async () => {
				const { bookId } = await bookWith('audio_track');
				let rejected = false;
				for (const persona of await backend.session.listPersonas()) {
					await backend.session.signInAs(persona.id);
					const missing = (await backend.layers.list(bookId)).find(
						(l) => l.kind === 'audio_track' && !l.entitled
					);
					if (!missing) continue;
					await expectBackendError(backend.layers.openTrack(missing.id), 'ENTITLEMENT_REQUIRED');
					rejected = true;
					break;
				}
				expect(rejected, 'the seed needs a Persona without some Audio Track').toBe(true);
				await expectBackendError(backend.layers.openTrack('no-such-track'), 'NOT_FOUND');
				// A pack isn't a track, and the other way round.
				const { packs } = await bookWithPacks();
				await expectBackendError(backend.layers.openTrack(packs[0]!.id), 'NOT_FOUND');
			});
		});

		describe('studio (authorisation enforced in the backend, §10.6)', () => {
			it('rejects non-Creators with FORBIDDEN', async () => {
				await backend.session.signInAs(personaWithRole('reader').id);
				await expectBackendError(backend.studio.listBooks(), 'FORBIDDEN');
				await backend.session.signInAs(personaWithRole('moderator').id);
				await expectBackendError(backend.studio.listBooks(), 'FORBIDDEN');
			});

			it('lists only the signed-in Creator’s own Books', async () => {
				const creator = personaWithRole('creator');
				await backend.session.signInAs(creator.id);
				const books = await backend.studio.listBooks();
				conforms('studio', 'listBooks', books);
				for (const book of books.items) expect(book.creatorId).toBe(creator.user.creatorId);
			});
		});

		describe('moderation (authorisation enforced in the backend, §10.6)', () => {
			it('rejects readers and Creators with FORBIDDEN', async () => {
				await backend.session.signInAs(personaWithRole('reader').id);
				await expectBackendError(backend.moderation.listQueue(), 'FORBIDDEN');
				await backend.session.signInAs(personaWithRole('creator').id);
				await expectBackendError(backend.moderation.listQueue(), 'FORBIDDEN');
			});

			it('gives moderators the open Flags, highest priority first', async () => {
				await backend.session.signInAs(personaWithRole('moderator').id);
				const queue = await backend.moderation.listQueue();
				conforms('moderation', 'listQueue', queue);
				for (const flag of queue.items) expect(flag.state).toBe('open');
				const priorities = queue.items.map((f) => f.priority);
				expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
			});
		});
	});
}
