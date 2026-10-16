/**
 * Narration for the open Book (P1-LAY-04; DESIGN.md §8.3): its Audio Track from
 * `Backend.layers`, the Chapters' Sync Maps, and the platform audio adapter (ADR-004). Audio
 * drives position: every frame while playing, the time is turned into the narrated Word (binary
 * search on the Sync Map), which the reader highlights and, if auto-turn is on, keeps on screen.
 *
 * Nothing plays until the reader presses play (Invariant 11).
 */
import { asset } from '$app/paths';
import {
	isBackendError,
	parseSyncMap,
	type AudioTrackSummaryDto,
	type Backend,
	type LayerSummaryDto,
	type OpenTrackDto,
	type RevisionManifest,
	type SleepTimerChoice,
	type SyncMap,
	type WordId
} from '@book/core';
import { sentenceAt } from '@book/domain';
import type { ChapterText } from '@book/reader-core';
import type { AudioAdapter, SleepState } from '$lib/platform';
import { sleepTimerOf } from './sleep-timer';
import {
	coverageLabel,
	makeTiming,
	startOf,
	TimingCache,
	wordAt,
	type NarratedWord,
	type Timing
} from './narration-timing';

export type TrackChapter = OpenTrackDto['chapters'][number];
export type { NarratedWord };

/** "Previous sentence" restarts the current one if it's been playing longer than this. */
const RESTART_MS = 1500;
/** Starting from a Word begins a breath before it. */
const LEAD_IN_MS = 250;

export class BookNarration {
	/** The Book's narration, held or not; null when it has none. */
	track = $state.raw<AudioTrackSummaryDto | null>(null);
	/** The Chapters it can play: aligned to the open Revision, in reading order. */
	chapters = $state.raw<TrackChapter[]>([]);
	/** True from the first press of play until the reader closes the player. */
	active = $state(false);
	playing = $state(false);
	/** Loading the first Chapter's audio and timings. */
	loading = $state(false);
	/** The Chapter playing, in `chapters`. */
	index = $state(0);
	/** For the player's clock: updated a few times a second, not every frame. */
	positionMs = $state(0);
	durationMs = $state(0);
	word = $state.raw<NarratedWord | null>(null);
	/** Off once the reader turns pages by hand; auto-turn waits until it's back on (§8.3). */
	following = $state(true);
	error = $state<string | null>(null);
	/** The sleep timer the reader set (P1-LAY-09), until it stops the narration or is turned off. */
	sleepChoice = $state<SleepTimerChoice | null>(null);

	readonly #backend: Backend;
	readonly #audio: AudioAdapter;
	readonly #manifest: RevisionManifest;
	readonly #textOf: (chapterId: string) => Promise<ChapterText>;
	#token = '';
	readonly #timings = new TimingCache();
	#entry = -1;
	#entryChapter = '';
	#frame = 0;
	#timer: ReturnType<typeof setInterval> | undefined;
	#clockAt = 0;
	#rate = 1;
	#offs: (() => void)[] = [];
	#destroyed = false;

	constructor(deps: {
		backend: Backend;
		audio: AudioAdapter;
		manifest: RevisionManifest;
		/** The Chapter's Words with their text (the engine's `chapterText`). */
		textOf: (chapterId: string) => Promise<ChapterText>;
	}) {
		this.#backend = deps.backend;
		this.#audio = deps.audio;
		this.#manifest = deps.manifest;
		this.#textOf = deps.textOf;
	}

	/** Whether there's anything the reader could play. */
	available = $derived(!!this.track?.entitled && this.chapters.length > 0);

	/** The track's coverage in words, for the disabled play button ("chapters 1–3"). */
	coverage = $derived(coverageLabel(this.chapters.map((c) => this.titleOf(c.chapterId))));

	current = $derived<TrackChapter | undefined>(this.chapters[this.index]);

	/** `layers`: the Book's Layers from `Backend.layers.list`; the first narration is used. */
	async load(layers: LayerSummaryDto[]) {
		const track = layers.find((l): l is AudioTrackSummaryDto => l.kind === 'audio_track');
		this.track = track ?? null;
		if (!track?.entitled) return;
		const opened = await this.#open(track.id);
		// Sync Maps on another Revision need re-aligning first (P1-STU-03); they're left out.
		this.chapters =
			opened.revisionId === this.#manifest.revisionId
				? opened.chapters.filter((c) => c.status !== 'stale')
				: [];
	}

	async #open(trackId: string): Promise<OpenTrackDto> {
		const opened = await this.#backend.layers.openTrack(trackId);
		this.#token = opened.contentToken;
		return opened;
	}

	covers(chapterId: string | undefined): boolean {
		return !!chapterId && this.chapters.some((c) => c.chapterId === chapterId);
	}

	titleOf(chapterId: string): string {
		const m = this.#manifest;
		return (
			m.toc.find((t) => t.chapterId === chapterId)?.label ||
			m.chapters.find((c) => c.chapterId === chapterId)?.title ||
			'Narration'
		);
	}

	// ---- timings ----

	#timing(chapterId: string): Promise<Timing> {
		return this.#timings.get(chapterId, async () => {
			const chapter = this.chapters.find((c) => c.chapterId === chapterId)!;
			const [map, text] = await Promise.all([this.#syncMap(chapter), this.#textOf(chapterId)]);
			return makeTiming(map, text);
		});
	}

	async #syncMap(chapter: TrackChapter): Promise<SyncMap> {
		const read = async () =>
			parseSyncMap(
				JSON.parse(await (await this.#backend.content.read(this.#token, chapter.syncMap)).text())
			);
		try {
			return await read();
		} catch (error) {
			// The token expired (an hour, §10.3): open the track again once.
			if (!isBackendError(error, 'UNAUTHENTICATED') || !this.track) throw error;
			await this.#open(this.track.id);
			return read();
		}
	}

	// ---- playing ----

	/**
	 * Starts narration the first time, from `from` (the first visible Word) when it's in a
	 * narrated Chapter, else from the first one; afterwards play and pause.
	 */
	async toggle(from?: { chapterId: string; ordinal: number }) {
		if (this.playing) {
			this.#audio.pause();
			return;
		}
		if (!this.active) await this.#start(from);
		this.error = null;
		try {
			await this.#audio.play();
		} catch (error) {
			// Autoplay rules or a file that won't play: say so, and stay paused.
			if (!this.#destroyed) this.error = this.#audio.error ?? describe(error);
		}
	}

	async #start(from?: { chapterId: string; ordinal: number }) {
		this.loading = true;
		try {
			const index = Math.max(
				0,
				this.chapters.findIndex((c) => c.chapterId === from?.chapterId)
			);
			const chapter = this.chapters[index]!;
			const timing = await this.#timing(chapter.chapterId);
			const position =
				from && from.chapterId === chapter.chapterId ? from.ordinal - timing.text.firstOrdinal : 0;
			// From the top of a Chapter, the recording's own introduction plays too.
			const startMs =
				position <= 0 ? 0 : Math.max(0, (startOf(timing, position) ?? 0) - LEAD_IN_MS);
			this.#listen();
			await this.#audio.load(
				this.chapters.map((c) => ({
					src: resolveAudio(c.audioUrl),
					title: this.titleOf(c.chapterId)
				})),
				{ artist: this.track?.narrator, album: this.#manifest.title },
				{ index, positionMs: startMs }
			);
			this.#audio.setRate(this.#rate);
			this.index = index;
			this.durationMs = chapter.durationMs;
			this.active = true;
			this.following = true;
			this.#update(true);
			// The other Chapters' timings load in the background, ready for the next one.
			for (const c of this.chapters) void this.#timing(c.chapterId).catch(() => {});
		} finally {
			this.loading = false;
		}
	}

	#listen() {
		if (this.#offs.length) return;
		const audio = this.#audio;
		this.#offs.push(
			audio.on('play', () => {
				this.playing = true;
				this.#loop();
			}),
			audio.on('pause', () => {
				this.playing = audio.playing;
				this.#update(true);
			}),
			audio.on('item', () => {
				this.index = audio.index;
				this.durationMs = this.chapters[audio.index]?.durationMs ?? 0;
				this.#entry = -1;
				const chapter = this.chapters[audio.index];
				if (chapter) void this.#timing(chapter.chapterId).then(() => this.#update(true));
			}),
			audio.on('ended', () => {
				this.playing = false;
				this.#update(true);
			}),
			audio.on('error', () => {
				this.error = audio.error;
				this.playing = audio.playing;
			}),
			audio.on('sleep', () => (this.sleepChoice = null))
		);
		const visibility = () => {
			if (document.visibilityState === 'visible') {
				this.playing = audio.playing;
				this.index = audio.index;
				this.#loop();
			}
		};
		document.addEventListener('visibilitychange', visibility);
		this.#offs.push(() => document.removeEventListener('visibilitychange', visibility));
	}

	/**
	 * Every frame while playing; and a timer as well, since frames stop when the window is hidden
	 * or covered, and position and auto-turn should be current when the reader looks again. The
	 * timer runs until the player closes: playing can resume without a `play` event (WebKit).
	 */
	#loop() {
		if (this.#destroyed) return;
		this.#timer ??= setInterval(() => {
			if (this.playing) this.#update(false);
		}, 250);
		if (this.#frame) return;
		const tick = () => {
			this.#frame = 0;
			this.#update(false);
			if (this.playing && !this.#destroyed) this.#frame = requestAnimationFrame(tick);
		};
		this.#frame = requestAnimationFrame(tick);
	}

	/** Time → Word (§8.3: binary search on the Sync Map). */
	#update(force: boolean) {
		const t = this.#audio.positionMs;
		const now = performance.now();
		if (force || now - this.#clockAt > 250) {
			this.positionMs = t;
			this.#clockAt = now;
		}
		const chapter = this.chapters[this.#audio.index];
		const timing = chapter && this.#timings.ready(chapter.chapterId);
		if (!timing) return;
		const { entry, word } = wordAt(timing, t);
		if (!force && entry === this.#entry && this.#entryChapter === timing.chapterId) return;
		this.#entry = entry;
		this.#entryChapter = timing.chapterId;
		// Before the first Word (the recording's introduction), nothing is highlighted.
		if (word?.wordId !== this.word?.wordId || word?.chapterId !== this.word?.chapterId) {
			this.word = word;
		}
	}

	/** Moves by `ms` within the Chapter (±15 s). */
	skip(ms: number) {
		this.seekTo(this.#audio.positionMs + ms);
	}

	/** Moves to a time in the Chapter playing. */
	seekTo(positionMs: number) {
		if (!this.active) return;
		const duration = this.#audio.durationMs || this.durationMs;
		this.#seek(Math.min(Math.max(0, positionMs), Math.max(0, duration - 250)));
	}

	#seek(positionMs: number, index?: number) {
		this.#audio.seek(positionMs, index);
		if (index !== undefined) this.index = index;
		this.#entry = -1;
		this.#update(true);
	}

	/** The previous (-1) or next (+1) sentence; "previous" restarts the current one first. */
	async sentence(dir: -1 | 1) {
		const chapter = this.chapters[this.index];
		if (!this.active || !chapter) return;
		const timing = await this.#timing(chapter.chapterId);
		const word = this.word;
		const position = word ? (timing.positionOf.get(word.wordId) ?? 0) : -1;
		let s = position < 0 ? (dir > 0 ? -1 : 0) : sentenceAt(timing.sentences, position);
		if (dir < 0 && s >= 0) {
			const start = startOf(timing, timing.sentences[s]![0]) ?? 0;
			if (this.#audio.positionMs - start < RESTART_MS) s -= 1;
		} else s += 1;
		if (s >= timing.sentences.length) {
			// Past the last sentence: the next Chapter, if there is one.
			if (this.index + 1 < this.chapters.length) this.#seek(0, this.index + 1);
			return;
		}
		const target = timing.sentences[Math.max(0, s)]!;
		// Exactly its start: any earlier is still the sentence before.
		this.#seek(startOf(timing, target[0]) ?? 0);
	}

	/** Tap to seek (§8.3): moves the narration to a Word, in this Chapter or another narrated one. */
	async seekToWord(chapterId: string, wordId: WordId) {
		const index = this.chapters.findIndex((c) => c.chapterId === chapterId);
		if (!this.active || index < 0) return false;
		const timing = await this.#timing(chapterId);
		const position = timing.positionOf.get(wordId);
		const start = position === undefined ? null : startOf(timing, position);
		if (start === null) return false;
		this.following = true;
		this.#seek(start, index === this.index ? undefined : index);
		return true;
	}

	setRate(rate: number) {
		this.#rate = rate;
		if (this.active) this.#audio.setRate(rate);
	}

	/** Arms the sleep timer (P1-LAY-09), or turns it off with null. */
	setSleep(choice: SleepTimerChoice | null) {
		if (!this.active) return;
		this.sleepChoice = choice;
		this.#audio.setSleep(choice === null ? null : sleepTimerOf(choice));
	}

	/** The sleep timer's countdown, current whenever it's read (not reactive: poll it). */
	get sleepLeft(): SleepState | null {
		return this.active && this.sleepChoice !== null ? this.#audio.sleep : null;
	}

	/** Closes the player: stops the audio, its lock-screen controls and any sleep timer. */
	stop() {
		if (this.active) this.#audio.unload();
		this.sleepChoice = null;
		this.active = false;
		this.playing = false;
		this.word = null;
		this.#entry = -1;
		cancelAnimationFrame(this.#frame);
		this.#frame = 0;
		clearInterval(this.#timer);
		this.#timer = undefined;
	}

	destroy() {
		this.#destroyed = true;
		this.stop();
		for (const off of this.#offs.splice(0)) off();
	}
}

/** The app's own static files (the PoC's demo audio) live under its base path. */
function resolveAudio(url: string): string {
	return url.startsWith('/') ? asset(url as `/${string}`) : url;
}

function describe(error: unknown): string {
	return error instanceof DOMException && error.name === 'NotAllowedError'
		? 'Your browser blocked the narration. Press play again.'
		: 'This narration couldn’t be played.';
}
