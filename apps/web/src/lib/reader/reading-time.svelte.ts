/**
 * Your reading, in the reader (P1-RDR-14, P1-RDR-15; DESIGN.md §4.9): how long the reader spends
 * on each page and listening. It teaches their pace (for time left) and adds to the day's stats,
 * on this device only. The rules are `@book/domain`'s (`withPage`, `localDate`).
 *
 * - **Reading time** runs while the reader is on a page with the app in view, until they've done
 *   nothing for `IDLE_MS` (a tap, a key, a turn or a scroll is something): a page left open on
 *   the table doesn't count.
 * - **Listening time** runs while narration or the device voice plays, with the screen off too:
 *   a gap the reader couldn't see counts in full if it's still playing when the app looks again,
 *   else only its first `LISTEN_TAIL_MS` (it stopped, by the sleep timer or a Chapter's end, at
 *   some point in between).
 * - **The pace** learns from forward page turns and scrolls the reader made themselves, at a
 *   reading pace (not a skim, not a pause), never while narration or the voice sets it.
 * - **Words** are those passed going forward, reading or listening; jumps don't count.
 */
import type { PointAnchor, Stores } from '@book/core';
import { defaultPace, localDate, withPage, type Pace } from '@book/domain';
import type { VisibleRange } from '@book/reader-core';
import { getPlatform } from '$lib/platform';

/** No sign of the reader for this long, and reading time stops. */
export const IDLE_MS = 5 * 60_000;
/** How much of an unseen gap counts when listening had stopped by the end of it. */
export const LISTEN_TAIL_MS = 2 * 60_000;
/** How often time is counted while the reader is on a page, and stats are written. */
const TICK_MS = 15_000;
const FLUSH_EVERY = 4;
/** Written this long after a page turn too, as Reading Progress is (§9.5): unload may not wait. */
const FLUSH_AFTER_TURN_MS = 2_000;
/** A forward move of more than this many Words is a jump, not reading on. */
const MAX_STEP_WORDS = 5_000;

export interface ReadingTimeOptions {
	stores: Stores;
	bookId: string;
	/** Time left is on: learn the pace. */
	learnPace: () => boolean;
	/** Reading stats are on: keep the day's time and Words. */
	keepStats: () => boolean;
	/** Narration or the device voice is playing. */
	listening: () => boolean;
	/** The pace saved before, if any. */
	pace?: Pace;
	now?: () => number;
}

export class ReadingTime {
	/** The reader's pace, for time left. */
	pace = $state.raw<Pace>(defaultPace());

	#options: ReadingTimeOptions;
	#now: () => number;
	#lastAt: number;
	#lastActivityAt: number;
	#wasListening = false;
	#hidden = false;
	/** Reading time on the page in view, for the pace. */
	#pageMs = 0;
	#at: PointAnchor | null = null;
	/** Not yet written to the day. */
	#readMs = 0;
	#listenedMs = 0;
	#words = 0;
	#paceChanged = false;
	#finished = false;
	#ticks = 0;
	#timer: ReturnType<typeof setInterval>;
	#flushTimer: ReturnType<typeof setTimeout> | undefined;
	#offHide: () => void;
	#onVisibility = () => {
		if (document.visibilityState === 'hidden') this.#hide();
		else this.#observe();
	};

	constructor(options: ReadingTimeOptions) {
		this.#options = options;
		this.#now = options.now ?? (() => Date.now());
		if (options.pace) this.pace = options.pace;
		this.#lastAt = this.#now();
		this.#lastActivityAt = this.#lastAt;
		this.#timer = setInterval(() => this.#tick(), TICK_MS);
		this.#offHide = getPlatform().lifecycle.onHide(() => this.#hide());
		document.addEventListener('visibilitychange', this.#onVisibility);
	}

	/** Every `relocated`: `auto` when narration or the device voice turned the page. */
	relocated(range: VisibleRange, auto: boolean) {
		const listening = this.#options.listening();
		this.#observe();
		if (!auto) this.#lastActivityAt = this.#lastAt;
		const before = this.#at;
		const step =
			before && before.revisionId === range.first.revisionId
				? range.first.ordinal - before.ordinal
				: 0;
		const onward =
			step > 0 && step <= MAX_STEP_WORDS && (range.cause === 'turn' || range.cause === 'scroll');
		if (onward) {
			this.#words += step;
			if (!auto && !listening && this.#options.learnPace()) {
				const next = withPage(this.pace, step, this.#pageMs);
				if (next !== this.pace) {
					this.pace = next;
					this.#paceChanged = true;
				}
			}
		}
		this.#at = range.first;
		this.#pageMs = 0;
		clearTimeout(this.#flushTimer);
		this.#flushTimer = setTimeout(() => void this.flush(), FLUSH_AFTER_TURN_MS);
	}

	/** A tap, a key, a selection: the reader is there. */
	activity() {
		this.#observe();
		this.#lastActivityAt = this.#lastAt;
	}

	/** The reader reached the Book's last Word (P1-RDR-15): it's finished, once. */
	finished() {
		if (this.#finished || !this.#options.keepStats()) return;
		this.#finished = true;
		void this.#options.stores.readingStats.finish(this.#options.bookId, localDate(this.#now()));
	}

	/** Counts the time since the last look. */
	#observe() {
		const now = this.#now();
		const gap = Math.max(0, now - this.#lastAt);
		const listening = this.#options.listening();
		if (this.#wasListening) {
			// Narration plays on with the screen off (§8.3).
			this.#listenedMs += listening ? gap : Math.min(gap, LISTEN_TAIL_MS);
		} else if (!this.#hidden) {
			const until = Math.min(now, this.#lastActivityAt + IDLE_MS);
			const read = Math.max(0, until - this.#lastAt);
			this.#readMs += read;
			this.#pageMs += read;
		}
		this.#hidden = false;
		this.#wasListening = listening;
		this.#lastAt = now;
	}

	#tick() {
		if (document.visibilityState === 'hidden') return;
		this.#observe();
		if (++this.#ticks % FLUSH_EVERY === 0) void this.flush();
	}

	#hide() {
		if (this.#hidden) return;
		this.#observe();
		this.#hidden = true;
		void this.flush();
	}

	/** Writes the day's reading and the pace (when they're on). */
	async flush(): Promise<void> {
		const { stores, bookId } = this.#options;
		const entry = {
			date: localDate(this.#now()),
			bookId,
			readMs: Math.round(this.#readMs),
			listenedMs: Math.round(this.#listenedMs),
			words: this.#words
		};
		this.#readMs = 0;
		this.#listenedMs = 0;
		this.#words = 0;
		// Off stops collecting: what's counted since is dropped, not kept for later.
		const writes: Promise<unknown>[] = [];
		if (this.#options.keepStats() && entry.readMs + entry.listenedMs + entry.words > 0) {
			writes.push(stores.readingStats.addToDay(entry));
		}
		if (this.#paceChanged && this.#options.learnPace()) {
			this.#paceChanged = false;
			writes.push(stores.readingStats.savePace(this.pace));
		}
		await Promise.all(writes);
	}

	async close() {
		clearInterval(this.#timer);
		clearTimeout(this.#flushTimer);
		this.#offHide();
		document.removeEventListener('visibilitychange', this.#onVisibility);
		this.#observe();
		await this.flush();
	}
}
