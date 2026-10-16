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
	SessionDto
} from './dto';
import type {
	BookSettingsInput,
	ChapterNarrationInput,
	ChapterReviewDto,
	EarningsDto,
	IllustrationChanges,
	IllustrationInput,
	LayerDetailsInput,
	MigrateAnchorsInput,
	MigrateAnchorsResult,
	PlanInput,
	PublishRevisionInput,
	StudioBookDetailDto,
	StudioBookDto,
	StudioPackDto,
	StudioRevisionDto,
	StudioTrackDto,
	TrackDetailsInput
} from '../studio';
import type {
	ActInput,
	CommunityHubDto,
	CreatorProfileDto,
	CurationDto,
	FlagDetailDto,
	InboxMessageDto,
	ModerationActionLogDto,
	ReportInput,
	StudioLayerDto
} from '../community';
import type { LayerSummaryDto, OpenPackDto, OpenTrackDto } from '../layers';
import type {
	GlossaryEntryInput,
	PublishStoryInput,
	RecapInput,
	StorySoFarDto,
	StudioStoryDto
} from '../story';
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
	/**
	 * Moves Anchors on an older Revision of a Book to its current one (§6.2, P1-STU-01): readers'
	 * Annotations, Placed Bookmarks and Reading Progress, when they next open it. Needs the Book
	 * (`ENTITLEMENT_REQUIRED`). Phase 2 runs the same `migrateAnchors` on the server.
	 */
	migrateAnchors(bookId: string, input: MigrateAnchorsInput): Promise<MigrateAnchorsResult>;
	/**
	 * The Book's published recaps and glossary on its current Revision (P1-RDR-13), or null when its
	 * author hasn't published any. Like `open`: an owner, or a sample reader of a listed Book, and
	 * only what's in Chapters they can open. The reader shows what's at or before how far they've
	 * read (Invariant 6, `storySoFarAt` in `@book/domain`). Rejects with `ENTITLEMENT_REQUIRED`.
	 */
	storySoFar(bookId: string): Promise<StorySoFarDto | null>;
}

/**
 * Creator Studio (DESIGN.md §4.7, P1-STU-01 to P1-STU-04, P1-LAY-05). Every method rejects with
 * `FORBIDDEN` for non-Creators and for another Creator's Books and Layers, inside the backend
 * (§10.6), and with `NOT_FOUND` for unknown IDs. Each change emits `studio`.
 */
export interface StudioApi {
	/** The signed-in Creator's own Books. */
	listBooks(page?: PageRequest): Promise<Page<StudioBookDto>>;
	getBook(bookId: string): Promise<StudioBookDetailDto>;
	/**
	 * Starts processing an EPUB: a new Book (a draft), or with `bookId` a new Revision of one,
	 * carried forward from its current Revision (§6.2). Returns the Revision while it is
	 * `processing`; it becomes `ready` or `failed` (with a reason) and `studio` is emitted. The
	 * same file again returns the Revision it made before. Rejects with `UPLOAD_TOO_LARGE`.
	 */
	upload(file: Blob, options?: { bookId?: string }): Promise<StudioRevisionDto>;
	updateBook(bookId: string, changes: BookSettingsInput): Promise<StudioBookDetailDto>;
	/**
	 * Makes a `ready` Revision current and lists the Book. The AI answer is required (§10.6).
	 * Illustrations move to it (or are marked orphaned) and changed Chapters' Sync Maps become
	 * `stale`; readers' own Anchors move when they next open it (`content.migrateAnchors`).
	 * Rejects with `CONFLICT` if the Revision isn't ready.
	 */
	publishRevision(bookId: string, input: PublishRevisionInput): Promise<StudioBookDetailDto>;
	/** Opens one of the Creator's own Revisions (the newest when omitted) to preview or build in. */
	previewRevision(bookId: string, revisionId?: string): Promise<OpenBookDto>;

	createPack(bookId: string, details: LayerDetailsInput): Promise<StudioPackDto>;
	getPack(packId: string): Promise<StudioPackDto>;
	updatePack(packId: string, details: LayerDetailsInput): Promise<StudioPackDto>;
	/** Attaches an Illustration to a passage of the Revision the pack is built on. */
	addIllustration(packId: string, input: IllustrationInput): Promise<StudioPackDto>;
	updateIllustration(
		packId: string,
		illustrationId: string,
		changes: IllustrationChanges
	): Promise<StudioPackDto>;
	removeIllustration(packId: string, illustrationId: string): Promise<StudioPackDto>;
	/**
	 * Lists the pack. Rejects with `VALIDATION_FAILED` while any Illustration lacks alt text
	 * (P1-LAY-05) or the AI question is unanswered.
	 */
	publishPack(packId: string): Promise<StudioPackDto>;

	createTrack(bookId: string, details: TrackDetailsInput): Promise<StudioTrackDto>;
	getTrack(trackId: string): Promise<StudioTrackDto>;
	updateTrack(trackId: string, details: TrackDetailsInput): Promise<StudioTrackDto>;
	/**
	 * A Chapter's audio and Sync Map (§7.2). Rejects with `VALIDATION_FAILED` when the Sync Map
	 * isn't one, or is for another Revision or Chapter, or names Words the Chapter doesn't have.
	 */
	setChapterNarration(trackId: string, input: ChapterNarrationInput): Promise<StudioTrackDto>;
	/** The review screen: every low-confidence region, each one tap away (P1-STU-03). */
	reviewChapter(trackId: string, chapterId: string): Promise<ChapterReviewDto>;
	markReviewed(
		trackId: string,
		chapterId: string,
		regionIndex: number,
		reviewed: boolean
	): Promise<ChapterReviewDto>;
	/** Lists the track. Rejects with `VALIDATION_FAILED` without a Chapter or an AI answer. */
	publishTrack(trackId: string): Promise<StudioTrackDto>;

	/** The Creator's Creator Subscription plans (P1-STU-04). */
	listPlans(): Promise<PlanDto[]>;
	/** Creates a plan (`planId` null) or changes one. */
	savePlan(planId: string | null, input: PlanInput): Promise<PlanDto>;
	/** Simulated earnings with placeholder revenue splits (OPEN-08 stays open). */
	earnings(): Promise<EarningsDto>;

	/** The Creator's packs and narrations on any Book, their community work included (P1-COM-01). */
	listLayers(): Promise<StudioLayerDto[]>;
	/** Curation for one of the author's own Books: submissions, community Layers, Flags (P1-ADM-02). */
	curation(bookId: string): Promise<CurationDto>;
	/** Approves or declines a community submission on the author's Book; the creator is told why. */
	decide(layerId: string, decision: 'approve' | 'decline', reason: string): Promise<CurationDto>;
	/** "Author-endorsed": endorsed community Layers sort first in the hub (§4.8). */
	endorse(layerId: string, endorsed: boolean): Promise<CurationDto>;
	/** Hides (delists) or relists a community Layer on the author's Book (§10.6). */
	setCommunityListing(layerId: string, listed: boolean): Promise<CurationDto>;

	/**
	 * The story so far being written for one of the Creator's own Books (P1-STU-05): a recap per
	 * Chapter and glossary entries with their first appearances, on the Revision readers have (or,
	 * before the Book is out, its newest processed upload). Rejects with `CONFLICT` before any text
	 * is processed. Changes are a draft until `publishStory`.
	 */
	getStory(bookId: string): Promise<StudioStoryDto>;
	/** Writes (or, with empty text, removes) a Chapter's recap in the draft. */
	saveRecap(bookId: string, input: RecapInput): Promise<StudioStoryDto>;
	/**
	 * Adds an entry (`entryId` null) or changes one in the draft; its names' first appearances are
	 * found in the text. Rejects with `VALIDATION_FAILED` when another entry has the same name, or
	 * a picture has no alt text.
	 */
	saveGlossaryEntry(
		bookId: string,
		entryId: string | null,
		input: GlossaryEntryInput
	): Promise<StudioStoryDto>;
	removeGlossaryEntry(bookId: string, entryId: string): Promise<StudioStoryDto>;
	/**
	 * Makes the draft what readers see. The AI answer is required (§10.6); rejects with
	 * `VALIDATION_FAILED` while an entry's name isn't in the text, or there's nothing to publish.
	 */
	publishStory(bookId: string, input: PublishStoryInput): Promise<StudioStoryDto>;
}

/**
 * Community Layers (DESIGN.md §4.8, §6.6; P1-COM-01, P1-COM-02): a Book's hub, ratings, follows,
 * Creator profiles and readers' reports. Making and submitting a community Layer is in `studio`
 * (createPack/createTrack on another author's Book), where the author's policy is enforced
 * (Invariant 19).
 */
export interface CommunityApi {
	/** Rejects with `NOT_FOUND` for a Book that isn't listed. */
	hub(bookId: string): Promise<CommunityHubDto>;
	/**
	 * One rating per reader per Layer; rating again replaces it. Needs the Layer
	 * (`ENTITLEMENT_REQUIRED`). Returns the Layer with its new average.
	 */
	rate(layerId: string, stars: number): Promise<LayerSummaryDto>;
	profile(creatorHandle: string): Promise<CreatorProfileDto>;
	follow(creatorHandle: string, following: boolean): Promise<CreatorProfileDto>;
	/** A reader's report (reason required) raises a `report` Flag; more reports raise its priority. */
	report(input: ReportInput): Promise<void>;
}

/** A user's in-app inbox: moderation outcomes, submissions, approvals (plan §4.7). */
export interface InboxApi {
	/** Newest first. */
	list(): Promise<InboxMessageDto[]>;
	markRead(messageId: string): Promise<void>;
}

export interface ModerationApi {
	/**
	 * The admin review queue: open Flags, highest priority first (§10.6). Rejects with
	 * `FORBIDDEN` for anyone who isn't a moderator or admin, inside the backend (P1-ADM-02).
	 */
	listQueue(page?: PageRequest): Promise<Page<FlagDto>>;
	/** A Flag with its content, evidence and the creator's history. */
	getFlag(flagId: string): Promise<FlagDetailDto>;
	/**
	 * Approve, require relabelling, hide, remove, warn or suspend, with a reason. Written to the
	 * append-only action log, and the creator is told in their inbox how to appeal.
	 */
	act(flagId: string, input: ActInput): Promise<FlagDetailDto>;
	/** The append-only action log, newest first. */
	listActions(page?: PageRequest): Promise<Page<ModerationActionLogDto>>;
}

/** Topics screens can refresh on. Phase 2 drives them from sync pulls, later push. */
export const backendTopics = [
	'session',
	'catalogue',
	'entitlements',
	/** Tips and subscriptions. */
	'support',
	'studio',
	'moderation',
	/** Community hubs, ratings and follows. */
	'community',
	'inbox'
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
	community: CommunityApi;
	inbox: InboxApi;
	events: BackendEvents;
}
