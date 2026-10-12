/**
 * `Backend`: server-authoritative operations (docs/DESIGN.md §5.6, Invariant 7). The app reaches
 * them only through this interface, chosen in `apps/web/src/lib/services.ts`: `backend-local`
 * (simulated in the browser) now, `backend-http` from Phase 2. Every implementation must pass
 * `describeBackendContract` from `@book/contract-tests`.
 *
 * Modules mirror the planned API modules (IMPLEMENTATION-PLAN.md §4.2). Each task adds the
 * methods it needs, with schemas in `contract.ts` and cases in the contract suite: P0-08 starts
 * `session`, `catalogue`, `library`, `studio` and `events`; `moderation` (P1-APP-01, extended
 * by P1-ADM-02), `content` (P1-APP-03), `checkout` (P1-STO-02), `support` (P1-STO-04), `layers`
 * (P1-LAY-01) and `community` (P1-COM-01) follow.
 *
 * Every method can reject with a `BackendError`. Lists are paged as `{ items, nextCursor }`.
 */
import type {
	BookDetailDto,
	BookSummaryDto,
	CreatorDto,
	FlagDto,
	LibraryEntryDto,
	PersonaDto,
	SessionDto,
	StudioBookDto
} from './dto';
import type { Page, PageRequest } from './paging';

export interface SessionApi {
	current(): Promise<SessionDto>;
	/** PoC only: the seeded Personas that stand in for sign-in (§2). */
	listPersonas(): Promise<PersonaDto[]>;
	/** PoC only. Phase 2 replaces this with the auth provider. Emits `session`. */
	signInAs(personaId: string): Promise<SessionDto>;
}

export interface CatalogueApi {
	listBooks(page?: PageRequest): Promise<Page<BookSummaryDto>>;
	/** Rejects with `NOT_FOUND`. */
	getBook(slug: string): Promise<BookDetailDto>;
	/** Rejects with `NOT_FOUND`. */
	getCreator(handle: string): Promise<CreatorDto>;
	/** A Creator's listed Books, for their profile. Rejects with `NOT_FOUND`. */
	listCreatorBooks(handle: string, page?: PageRequest): Promise<Page<BookSummaryDto>>;
}

export interface LibraryApi {
	/** The signed-in user's Entitlements, grouped by Book. Rejects with `UNAUTHENTICATED`. */
	list(page?: PageRequest): Promise<Page<LibraryEntryDto>>;
}

export interface StudioApi {
	/** The signed-in Creator's own Books. Rejects with `FORBIDDEN` for non-Creators (§10.6). */
	listBooks(page?: PageRequest): Promise<Page<StudioBookDto>>;
}

export interface ModerationApi {
	/**
	 * The admin review queue: open Flags, highest priority first (§10.6). Rejects with
	 * `FORBIDDEN` for anyone who isn't a moderator or admin, inside the backend (P1-ADM-02).
	 */
	listQueue(page?: PageRequest): Promise<Page<FlagDto>>;
}

/** Topics screens can refresh on. Phase 2 drives them from sync pulls, later push. */
export const backendTopics = [
	'session',
	'catalogue',
	'entitlements',
	'studio',
	'moderation'
] as const;
export type BackendTopic = (typeof backendTopics)[number];

export interface BackendEvents {
	/** Returns an unsubscribe function. Never rejects and is never simulated. */
	on(topic: BackendTopic, callback: () => void): () => void;
}

export interface Backend {
	session: SessionApi;
	catalogue: CatalogueApi;
	library: LibraryApi;
	studio: StudioApi;
	moderation: ModerationApi;
	events: BackendEvents;
}
