/**
 * The Backend contract (docs/DESIGN.md §5.6, IMPLEMENTATION-PLAN.md §4.5). Run it against every
 * `Backend`: `backend-local` now, `backend-http` against the Docker API in Phase 2. It checks
 * behaviour and validates every response against `backendContract` itself, so an implementation
 * can't pass by skipping its own validation.
 *
 * It assumes only what any seeded environment provides: at least one Persona per role (reader,
 * creator, moderator), at least two listed Books, and a library entry for the reader Persona.
 */
import {
	BackendError,
	backendContract,
	type Backend,
	type Clock,
	type ErrorCode,
	type PersonaDto,
	type Role
} from '@book/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ManualClock } from './clock';

/** Must return a freshly seeded, independent backend on every call, signed in as the default. */
export type MakeBackend = (context: { clock: Clock }) => Promise<Backend>;

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

		const personaWithRole = (role: Role) => {
			const persona = personas.find((p) => p.user.role === role);
			if (!persona) throw new Error(`The seed needs a ${role} Persona`);
			return persona;
		};

		beforeEach(async () => {
			backend = await makeBackend({ clock: new ManualClock() });
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
