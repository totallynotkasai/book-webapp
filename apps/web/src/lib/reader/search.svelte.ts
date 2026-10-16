/**
 * Search in the open Book (P1-RDR-10; plan §6 Phase 1.12): the query, and its results grouped by
 * Chapter. Chapters are readied a Chapter at a time with a pause between them, so typing and
 * page turns stay responsive while a long Book is read for the first search (§12.3), and results
 * appear Chapter by Chapter as they're found.
 */
import type { RevisionManifest } from '@book/core';
import type { ChapterText } from '@book/reader-core';
import { findInChapter, queryWords, SearchIndex, type SearchHit } from './search';

export interface SearchGroup {
	chapterId: string;
	title: string;
	hits: SearchHit[];
}

/** Lets the page paint and take input between Chapters. */
function yieldToPage(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Typing pauses this long before a search starts. */
const DEBOUNCE_MS = 150;

export class BookSearch {
	query = $state('');
	groups = $state.raw<SearchGroup[]>([]);
	total = $state(0);
	/** Searching: some Chapters haven't been looked in yet. */
	searching = $state(false);
	/** How many Chapters have been looked in so far, of `chapterCount`. */
	searched = $state(0);
	error = $state<string | null>(null);

	readonly #manifest: RevisionManifest;
	readonly #index: SearchIndex;
	/** Chapters with Words, in reading order (locked ones aren't in the manifest). */
	readonly #chapterIds: string[];
	#run = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;
	/** Waiting for a first result, or for the search to end without one. */
	#waiters: (() => void)[] = [];

	constructor(deps: {
		manifest: RevisionManifest;
		/** The Chapter's Words with their text (the engine's `chapterText`). */
		textOf: (chapterId: string) => Promise<ChapterText>;
	}) {
		this.#manifest = deps.manifest;
		this.#index = new SearchIndex(deps.textOf);
		this.#chapterIds = deps.manifest.chapters
			.filter((c) => c.wordCount > 0)
			.map((c) => c.chapterId);
	}

	get chapterCount(): number {
		return this.#chapterIds.length;
	}

	titleOf(chapterId: string): string {
		const m = this.#manifest;
		return (
			m.toc.find((t) => t.chapterId === chapterId && !t.fragment)?.label ||
			m.toc.find((t) => t.chapterId === chapterId)?.label ||
			m.chapters.find((c) => c.chapterId === chapterId)?.title ||
			'Untitled'
		);
	}

	/** Reads the Chapters ahead of the first search, so its results come at once. */
	async prepare() {
		for (const id of this.#chapterIds) {
			try {
				await this.#index.chapter(id);
			} catch {
				// Tried again when searched.
			}
			await yieldToPage();
		}
	}

	/** Searches for `query` once typing pauses (at once with `now`). */
	set(query: string, now = false) {
		this.query = query;
		// Searching from the first keystroke: never "No results" for a search not yet run.
		this.searching = queryWords(query).length > 0;
		this.searched = 0;
		clearTimeout(this.#timer);
		this.#timer = undefined;
		if (now) void this.#search();
		else {
			this.#timer = setTimeout(() => {
				this.#timer = undefined;
				void this.#search();
			}, DEBOUNCE_MS);
		}
	}

	async #search() {
		const run = ++this.#run;
		const words = queryWords(this.query);
		this.error = null;
		if (!words.length) {
			this.groups = [];
			this.total = 0;
			this.searching = false;
			this.searched = 0;
			this.#wake();
			return;
		}
		this.searching = true;
		this.searched = 0;
		// The last query's results go (the first Chapter's new ones replace them in the same task).
		this.groups = [];
		this.total = 0;
		const groups: SearchGroup[] = [];
		let total = 0;
		let first = true;
		for (const id of this.#chapterIds) {
			try {
				const chapter = await this.#index.chapter(id);
				if (run !== this.#run) return;
				const hits = findInChapter(chapter, words);
				if (hits.length) {
					groups.push({ chapterId: id, title: this.titleOf(id), hits });
					total += hits.length;
				}
			} catch {
				if (run !== this.#run) return;
				this.error = 'Some chapters couldn’t be searched.';
			}
			this.searched++;
			// Results show as they're found; the first Chapter's straight away.
			if (first || groups.length !== this.groups.length) {
				this.groups = [...groups];
				this.total = total;
				first = false;
				if (groups.length) this.#wake();
			}
			await yieldToPage();
			if (run !== this.#run) return;
		}
		this.groups = groups;
		this.total = total;
		this.searching = false;
		this.#wake();
	}

	#wake() {
		for (const wake of this.#waiters.splice(0)) wake();
	}

	/**
	 * The first result for `query` (Enter in the search field): searches now if typing hasn't
	 * paused yet, and waits for the first Chapter with a result rather than the whole Book.
	 */
	async first(query: string): Promise<SearchHit | undefined> {
		if (query !== this.query || this.#timer !== undefined) this.set(query, true);
		while (!this.groups.length && this.searching) {
			await new Promise<void>((resolve) => this.#waiters.push(resolve));
		}
		return query === this.query ? this.groups[0]?.hits[0] : undefined;
	}

	destroy() {
		clearTimeout(this.#timer);
		this.#run++;
		this.#wake();
	}
}
