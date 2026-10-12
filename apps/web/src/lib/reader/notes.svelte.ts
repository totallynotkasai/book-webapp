/**
 * Annotations and Placed Bookmarks for the open Book (P1-RDR-06, P1-RDR-07; DESIGN.md §9.3),
 * kept in `Stores` and mirrored here so the page, the toolbar and the notes panel update together.
 *
 * Only records on the open Revision with a live Anchor are painted. The rest (orphaned by a new
 * Revision, §6.2) are listed with their quoted text so nothing a reader wrote disappears.
 */
import type {
	Annotation,
	HighlightColour,
	PlacedBookmark,
	PointAnchor,
	RangeAnchor,
	Stores
} from '@book/core';
import type { Decoration } from '@book/reader-core';
import { requestPersistentStorage } from '$lib/data/persistence';

export class BookNotes {
	annotations = $state.raw<Annotation[]>([]);
	bookmarks = $state.raw<PlacedBookmark[]>([]);

	readonly #stores: Stores;
	readonly #bookId: string;
	readonly #revisionId: string;

	constructor(stores: Stores, bookId: string, revisionId: string) {
		this.#stores = stores;
		this.#bookId = bookId;
		this.#revisionId = revisionId;
	}

	/** On the open Revision and not orphaned: these are painted and can be jumped to. */
	live = $derived(
		this.annotations
			.filter((a) => this.#isLive(a))
			.sort((a, b) => a.anchor.startOrdinal - b.anchor.startOrdinal)
	);
	orphaned = $derived(this.annotations.filter((a) => !this.#isLive(a)));
	liveBookmarks = $derived(
		this.bookmarks
			.filter((b) => this.#isLive(b))
			.sort((a, b) => a.anchor.ordinal - b.anchor.ordinal)
	);
	orphanedBookmarks = $derived(this.bookmarks.filter((b) => !this.#isLive(b)));

	/** Highlights in their colour; a note adds an underline, so notes can be seen on the page. */
	decorations = $derived<Decoration[]>(
		this.live.flatMap((a) => {
			const color = `highlight-${a.colour}`;
			const highlight: Decoration = { id: a.id, anchor: a.anchor, style: 'highlight', color };
			return a.note
				? [highlight, { id: `${a.id}:note`, anchor: a.anchor, style: 'underline', color }]
				: [highlight];
		})
	);

	#isLive(record: Annotation | PlacedBookmark): boolean {
		return record.anchorStatus !== 'orphaned' && record.anchor.revisionId === this.#revisionId;
	}

	async load() {
		const [annotations, bookmarks] = await Promise.all([
			this.#stores.annotations.list(this.#bookId),
			this.#stores.placedBookmarks.list(this.#bookId)
		]);
		this.annotations = annotations;
		this.bookmarks = bookmarks;
	}

	// ---- Annotations ----

	/** Live highlights sharing at least one Word with the range. */
	overlapping(anchor: RangeAnchor): Annotation[] {
		return this.live.filter(
			(a) =>
				a.anchor.startOrdinal <= anchor.endOrdinal && anchor.startOrdinal <= a.anchor.endOrdinal
		);
	}

	/** The highlight covering a Word; the most recent one when highlights overlap. */
	at(ordinal: number): Annotation | undefined {
		return this.live
			.filter((a) => a.anchor.startOrdinal <= ordinal && ordinal <= a.anchor.endOrdinal)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
	}

	async highlight(anchor: RangeAnchor, colour: HighlightColour, note?: string) {
		const created = await this.#stores.annotations.create({
			bookId: this.#bookId,
			anchor,
			anchorStatus: 'ok',
			colour,
			...(note ? { note } : {})
		});
		this.annotations = [...this.annotations, created];
		// The first thing a reader would hate to lose: ask the browser to keep it (§18).
		void requestPersistentStorage();
		return created;
	}

	async update(id: string, changes: { colour?: HighlightColour; note?: string | undefined }) {
		const updated = await this.#stores.annotations.update(id, changes);
		this.annotations = this.annotations.map((a) => (a.id === id ? updated : a));
		return updated;
	}

	/** Removes a highlight and returns it, so "Undo" can put it back. */
	async remove(id: string): Promise<Annotation | undefined> {
		const removed = this.annotations.find((a) => a.id === id);
		await this.#stores.annotations.remove(id);
		this.annotations = this.annotations.filter((a) => a.id !== id);
		return removed;
	}

	/** Puts back a removed highlight (as a new record: removal is a tombstone, §6.3). */
	async restore(annotation: Annotation) {
		const created = await this.#stores.annotations.create({
			bookId: annotation.bookId,
			anchor: annotation.anchor,
			anchorStatus: annotation.anchorStatus,
			colour: annotation.colour,
			...(annotation.note ? { note: annotation.note } : {})
		});
		this.annotations = [...this.annotations, created];
	}

	// ---- Placed Bookmarks ----

	/** Live bookmarks whose Word is on screen. */
	bookmarksBetween(first: number, last: number): PlacedBookmark[] {
		return this.liveBookmarks.filter((b) => first <= b.anchor.ordinal && b.anchor.ordinal <= last);
	}

	/** `designProductId`: the Bookmark Design to draw it with; the reader's default when unset. */
	async addBookmark(anchor: PointAnchor, label?: string, designProductId?: string) {
		const created = await this.#stores.placedBookmarks.create({
			bookId: this.#bookId,
			anchor,
			anchorStatus: 'ok',
			...(label ? { label } : {}),
			...(designProductId ? { bookmarkDesignProductId: designProductId } : {})
		});
		this.bookmarks = [...this.bookmarks, created];
		void requestPersistentStorage();
		return created;
	}

	async renameBookmark(id: string, label: string) {
		const updated = await this.#stores.placedBookmarks.update(id, {
			label: label.trim() || undefined
		});
		this.bookmarks = this.bookmarks.map((b) => (b.id === id ? updated : b));
	}

	/** Draws a Placed Bookmark with another Bookmark Design (P1-STO-03). */
	async designBookmark(id: string, designProductId: string) {
		const updated = await this.#stores.placedBookmarks.update(id, {
			bookmarkDesignProductId: designProductId
		});
		this.bookmarks = this.bookmarks.map((b) => (b.id === id ? updated : b));
	}

	async removeBookmark(id: string): Promise<PlacedBookmark | undefined> {
		const removed = this.bookmarks.find((b) => b.id === id);
		await this.#stores.placedBookmarks.remove(id);
		this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
		return removed;
	}

	async restoreBookmark(bookmark: PlacedBookmark) {
		const created = await this.#stores.placedBookmarks.create({
			bookId: bookmark.bookId,
			anchor: bookmark.anchor,
			anchorStatus: bookmark.anchorStatus,
			...(bookmark.label ? { label: bookmark.label } : {})
		});
		this.bookmarks = [...this.bookmarks, created];
	}
}
