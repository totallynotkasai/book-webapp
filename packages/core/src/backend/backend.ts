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
	BookSummaryDto,
	CreatorDto,
	FlagDto,
	LibraryEntryDto,
	OpenBookDto,
	PersonaDto,
	SessionDto,
	StudioBookDto
} from './dto';
import type { LayerSummaryDto, OpenPackDto, OpenTrackDto } from '../layers';
import type {
	BookmarkDesignDto,
	BookPageDto,
	NarrationSampleDto,
	OrderDto,
	PlanDto,
	PreviewsDto,
	ShelfDto,
	SubscriptionDto,
	TipDto,
	TipInput
} from '../store';
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
	/** The store's curated shelves, in order (P1-STO-01). */
	listShelves(): Promise<ShelfDto[]>;
	/** Listed Books whose title, creator or description contains every word of `query`. */
	search(query: string, page?: PageRequest): Promise<Page<BookSummaryDto>>;
	/** A Book page: its Layers, offers and the reader's place in it. Rejects with `NOT_FOUND`. */
	getBook(slug: string): Promise<BookPageDto>;
	/** Rejects with `NOT_FOUND`. */
	getCreator(handle: string): Promise<CreatorDto>;
	/** A Creator's listed Books, for their profile. Rejects with `NOT_FOUND`. */
	listCreatorBooks(handle: string, page?: PageRequest): Promise<Page<BookSummaryDto>>;
	/** Every Bookmark Design on sale, saying which the reader owns (P1-STO-03). */
	listBookmarkDesigns(): Promise<BookmarkDesignDto[]>;
}

/**
 * Getting Products (P1-STO-02, §6.5). Simulated: no card details and no money; the dev panel
 * chooses whether payments succeed. Entitlements are created only here and by subscriptions.
 */
export interface CheckoutApi {
	/**
	 * "Add to library" for a free Product (or a Bundle that's free for this reader): an
	 * Entitlement with `source: 'free_claim'`. Claiming again returns the same order. Rejects
	 * with `CONFLICT` when it isn't free.
	 */
	claim(productId: string): Promise<OrderDto>;
	/**
	 * Buys a Product, a Bundle's children included, at its price for this reader. The same
	 * `idempotencyKey` always gives the same order, so a double tap buys once. Rejects with
	 * `PAYMENT_DECLINED`, or `CONFLICT` when it's all owned already.
	 */
	purchase(productId: string, idempotencyKey: string): Promise<OrderDto>;
	/** The reader's orders, newest first. */
	listOrders(page?: PageRequest): Promise<Page<OrderDto>>;
}

/** Supporting Creators (P1-STO-04, §6.5): Tips and Creator Subscriptions. */
export interface SupportApi {
	/** A Creator's plans. Rejects with `NOT_FOUND` for an unknown Creator. */
	listPlans(creatorHandle: string): Promise<PlanDto[]>;
	/**
	 * Starts a monthly subscription; while it's active its benefits are Entitlements with
	 * `source: 'subscription'`. Idempotent like `purchase`. Rejects with `CONFLICT` if
	 * already subscribed, `PAYMENT_DECLINED` if the first payment fails.
	 */
	subscribe(planId: string, idempotencyKey: string): Promise<SubscriptionDto>;
	/** Stops renewal: the benefits last until the end of the paid period, then end. */
	cancel(subscriptionId: string): Promise<SubscriptionDto>;
	/** The reader's subscriptions, renewed or ended as of now. */
	listSubscriptions(): Promise<SubscriptionDto[]>;
	/** A one-off Tip. Idempotent. Rejects with `PAYMENT_DECLINED`. */
	tip(input: TipInput): Promise<TipDto>;
	/** The reader's Tips, newest first. */
	listTips(): Promise<TipDto[]>;
}

export interface LibraryApi {
	/** The signed-in user's Entitlements, grouped by Book. Rejects with `UNAUTHENTICATED`. */
	list(page?: PageRequest): Promise<Page<LibraryEntryDto>>;
}

export interface LayersApi {
	/** A Book's listed Layers, each saying whether the user holds an Entitlement to it (§8.1). */
	list(bookId: string): Promise<LayerSummaryDto[]>;
	/**
	 * A pack's Illustrations and a content token for its images, read with `content.read`.
	 * Checks Entitlements first (Invariant 15): `ENTITLEMENT_REQUIRED` if not held, `NOT_FOUND`
	 * for an unknown pack.
	 */
	openPack(packId: string): Promise<OpenPackDto>;
	/**
	 * An Audio Track's Chapters: each one's Sync Map, read with `content.read` under the returned
	 * token, and a URL for its audio (§8.3). Checks Entitlements first, like `openPack`.
	 */
	openTrack(trackId: string): Promise<OpenTrackDto>;
	/**
	 * A Book's spoiler-safe Illustrations for its store page (Invariant 6), from every listed
	 * pack, with a token that reads only their images. No Entitlement needed.
	 */
	previews(bookId: string): Promise<PreviewsDto>;
	/** A short piece of the Book's official narration for its store page, or null. */
	narrationSample(bookId: string): Promise<NarrationSampleDto | null>;
}

export interface ContentApi {
	/**
	 * Checks Entitlements first (Invariant 15) and rejects with `ENTITLEMENT_REQUIRED`; then gives
	 * the current Revision and a content token. Rejects with `NOT_FOUND` for an unknown Book.
	 * With `sample`, a reader who doesn't own the Book gets its sample Chapters; `locked` lists
	 * the rest (and early-access Chapters for owners, P1-STO-04).
	 */
	open(bookId: string, options?: { sample?: boolean }): Promise<OpenBookDto>;
	/**
	 * A file of the opened Revision by its path (§6.7), under the token (Invariant 16). Rejects
	 * with `UNAUTHENTICATED` when the token is unknown or expired, `NOT_FOUND` for a missing file.
	 */
	read(contentToken: string, path: string): Promise<Blob>;
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
	/** Tips and subscriptions. */
	'support',
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
	checkout: CheckoutApi;
	support: SupportApi;
	content: ContentApi;
	layers: LayersApi;
	studio: StudioApi;
	moderation: ModerationApi;
	events: BackendEvents;
}
