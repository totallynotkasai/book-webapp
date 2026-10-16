/**
 * The device voice for the open Book (P1-LAY-08; DESIGN.md §4.4, ADR-006): any Book read aloud
 * by the device's own text-to-speech, a sentence at a time, with narration's highlighting,
 * auto-turn and tap-to-seek. The `speech` platform adapter queues a Chapter's sentences (and the
 * next Chapter's, once that one starts) and reports the sentence and Word it has reached, which
 * this turns back into the Word on the page.
 *
 * Never starts by itself (Invariant 11): only the play button starts it. Labelled "Device voice"
 * wherever it shows, never as narration.
 */
import type { RevisionManifest, SleepTimerChoice, WordId } from '@book/core';
import type { ChapterText } from '@book/reader-core';
import type { SleepState, SpeechAdapter, SpeechPosition, SpeechVoice } from '$lib/platform';
import type { ReadWord } from './narration-timing';
import { sleepTimerOf } from './sleep-timer';
import {
	charOfWord,
	SpokenChapters,
	utterancesOf,
	voiceFor,
	wordAtChar,
	type SpokenChapter,
	type SpokenSentence
} from './speech-text';

/** "Previous sentence" restarts the current one unless it has only just begun. */
const RESTART_AFTER_WORDS = 2;

export class BookSpeech {
	/** Whether this device can read aloud at all, in this Book's language. */
	available = $state(false);
	/** The device's on-device voices (D-036). */
	voices = $state.raw<SpeechVoice[]>([]);
	/** The voice in use: the reader's choice for this language, or the device's default. */
	voice = $state.raw<SpeechVoice | null>(null);
	/** True from the first press of play until the reader closes the player. */
	active = $state(false);
	playing = $state(false);
	loading = $state(false);
	/** The Chapter being read. */
	chapterId = $state<string | null>(null);
	word = $state.raw<ReadWord | null>(null);
	/** Off once the reader turns pages by hand; auto-turn waits until it's back on (§8.3). */
	following = $state(true);
	/**
	 * Whether the voice reports each Word. Some don't (or Android before 8), and then the
	 * highlight is the sentence, whatever the preference.
	 */
	wordTiming = $state(false);
	error = $state<string | null>(null);
	/** The sleep timer the reader set (P1-LAY-09), until it stops the voice or is turned off. */
	sleepChoice = $state<SleepTimerChoice | null>(null);

	readonly #speech: SpeechAdapter;
	readonly #manifest: RevisionManifest;
	readonly #chapters: SpokenChapters;
	/** Chapters handed to the adapter, in order. */
	#queued: string[] = [];
	#rate = 1;
	#offs: (() => void)[] = [];
	#destroyed = false;

	constructor(deps: {
		speech: SpeechAdapter;
		manifest: RevisionManifest;
		/** The Chapter's Words with their text (the engine's `chapterText`). */
		textOf: (chapterId: string) => Promise<ChapterText>;
	}) {
		this.#speech = deps.speech;
		this.#manifest = deps.manifest;
		this.#chapters = new SpokenChapters(deps.textOf);
	}

	/** Finds out whether the device can read this Book, and its voices. */
	async load(chosenVoice: string | undefined) {
		if (!(await this.#speech.available())) return;
		this.voices = await this.#speech.voices();
		this.voice = voiceFor(this.voices, this.#manifest.lang, chosenVoice);
		this.available = this.voice !== null;
	}

	/** The voices that can read this Book: its language's, or every voice when it has none. */
	get bookVoices(): SpeechVoice[] {
		const voice = this.voice;
		if (!voice) return [];
		return this.voices.filter((v) => voiceFor([v], this.#manifest.lang, undefined) !== null);
	}

	/** A Chapter it can read: one with Words (locked Chapters aren't in the manifest). */
	covers(chapterId: string | undefined): boolean {
		return this.#manifest.chapters.some((c) => c.chapterId === chapterId && c.wordCount > 0);
	}

	titleOf(chapterId: string): string {
		const m = this.#manifest;
		return (
			m.toc.find((t) => t.chapterId === chapterId)?.label ||
			m.chapters.find((c) => c.chapterId === chapterId)?.title ||
			m.title
		);
	}

	// ---- Chapters as sentences ----

	#chapter(chapterId: string): Promise<SpokenChapter> {
		return this.#chapters.get(chapterId);
	}

	/** The Chapter after this one in reading order that has Words to read. */
	#nextChapter(chapterId: string): string | null {
		const chapters = this.#manifest.chapters;
		const i = chapters.findIndex((c) => c.chapterId === chapterId);
		return chapters.slice(i + 1).find((c) => c.linear && c.wordCount > 0)?.chapterId ?? null;
	}

	#previousChapter(chapterId: string): string | null {
		const chapters = this.#manifest.chapters;
		const i = chapters.findIndex((c) => c.chapterId === chapterId);
		return (
			chapters.slice(0, Math.max(0, i)).findLast((c) => c.linear && c.wordCount > 0)?.chapterId ??
			null
		);
	}

	// ---- playing ----

	/**
	 * Starts reading the first time, from `from` (the first visible Word); afterwards play and
	 * pause.
	 */
	async toggle(from?: { chapterId: string; ordinal: number }) {
		if (this.playing) {
			this.#speech.pause();
			return;
		}
		this.error = null;
		try {
			if (this.active) await this.#speech.resume();
			else await this.#startAt(from);
		} catch (error) {
			if (!this.#destroyed) this.error = this.#speech.error ?? describe(error);
		}
	}

	/** Starts speaking at a Word (by Ordinal) in a Chapter, replacing whatever was queued. */
	async #startAt(from?: { chapterId: string; ordinal: number }) {
		const chapterId =
			from && this.covers(from.chapterId)
				? from.chapterId
				: (this.#manifest.chapters.find((c) => c.linear && c.wordCount > 0)?.chapterId ?? null);
		if (!chapterId) return;
		this.loading = true;
		try {
			const chapter = await this.#chapter(chapterId);
			const position =
				from && from.chapterId === chapterId ? from.ordinal - chapter.text.firstOrdinal : 0;
			await this.#speakFrom(
				chapter,
				Math.max(0, Math.min(position, chapter.text.wordIds.length - 1))
			);
		} finally {
			this.loading = false;
		}
	}

	async #speakFrom(chapter: SpokenChapter, position: number) {
		const s = Math.max(
			0,
			chapter.sentences.findIndex((x) => position >= x.first && position <= x.last)
		);
		const sentence = chapter.sentences[s];
		if (!sentence) return;
		this.#listen();
		this.#queued = [chapter.chapterId];
		this.active = true;
		this.following = true;
		this.chapterId = chapter.chapterId;
		await this.#speech.speak(
			utterancesOf(chapter, s),
			{ voiceId: this.voice?.id, lang: this.#manifest.lang, rate: this.#rate },
			{
				title: this.titleOf(chapter.chapterId),
				artist: 'Device voice',
				album: this.#manifest.title
			},
			{ id: chapter.ids[s]!, charIndex: charOfWord(sentence, position) }
		);
		this.#update();
		void this.#queueNext();
	}

	/** Hands the adapter the next Chapter as soon as this one starts, so speech never waits. */
	async #queueNext() {
		const last = this.#queued.at(-1);
		const next = last ? this.#nextChapter(last) : null;
		if (!next || this.#queued.includes(next)) return;
		this.#queued.push(next);
		try {
			const chapter = await this.#chapter(next);
			if (!this.active || !this.#queued.includes(next)) return;
			this.#speech.enqueue(utterancesOf(chapter), this.titleOf(next));
		} catch {
			this.#queued = this.#queued.filter((c) => c !== next);
		}
	}

	#listen() {
		if (this.#offs.length) return;
		const speech = this.#speech;
		this.#offs.push(
			speech.on('progress', () => this.#update()),
			speech.on('play', () => (this.playing = true)),
			speech.on('pause', () => {
				this.playing = speech.playing;
				// Paused while finishing its last sentence: the timer is done.
				if (!speech.sleep) this.sleepChoice = null;
			}),
			speech.on('end', () => {
				this.playing = false;
				this.sleepChoice = null;
			}),
			speech.on('error', () => {
				this.error = speech.error;
				this.playing = speech.playing;
			}),
			speech.on('sleep', () => (this.sleepChoice = null))
		);
	}

	/** Where the adapter has got to, as a Chapter, a sentence in it and a Word position. */
	#locate(): {
		chapter: SpokenChapter;
		index: number;
		sentence: SpokenSentence;
		position: number;
	} | null {
		const at = this.#speech.current;
		const found = at ? this.#chapters.locate(at.id) : null;
		return found && at ? { ...found, position: wordAtChar(found.sentence, at.charIndex) } : null;
	}

	/** The adapter's position → the Word on the page. */
	#update() {
		this.playing = this.#speech.playing;
		const at = this.#locate();
		if (!at) return;
		const { chapter, sentence, position } = at;
		if ((this.#speech.current?.charIndex ?? 0) > 0) this.wordTiming = true;
		const { firstOrdinal, wordIds, texts } = chapter.text;
		if (this.chapterId !== chapter.chapterId) {
			this.chapterId = chapter.chapterId;
			// A new Chapter has begun: queue the one after it.
			if (this.#queued.at(-1) === chapter.chapterId) void this.#queueNext();
		}
		const word = this.word;
		if (word?.chapterId === chapter.chapterId && word.ordinal === firstOrdinal + position) return;
		this.word = {
			chapterId: chapter.chapterId,
			wordId: wordIds[position]!,
			ordinal: firstOrdinal + position,
			text: texts[position] ?? '',
			sentence: {
				first: firstOrdinal + sentence.first,
				last: firstOrdinal + sentence.last,
				firstWordId: wordIds[sentence.first]!,
				lastWordId: wordIds[sentence.last]!
			}
		};
	}

	/** The previous (-1) or next (+1) sentence; "previous" restarts the current one first. */
	async sentence(dir: -1 | 1) {
		const at = this.#locate();
		if (!this.active || !at) return;
		const { chapter, index: sentence, position } = at;
		let target = sentence + dir;
		if (dir < 0 && position - chapter.sentences[sentence]!.first >= RESTART_AFTER_WORDS) {
			target = sentence;
		}
		if (target >= 0 && target < chapter.sentences.length) {
			this.#seek({ id: chapter.ids[target]!, charIndex: 0 });
			return;
		}
		// Past either end of the Chapter: the next or previous one with Words.
		const other =
			target < 0 ? this.#previousChapter(chapter.chapterId) : this.#nextChapter(chapter.chapterId);
		if (!other) return;
		const next = await this.#chapter(other);
		const start = target < 0 ? next.sentences.at(-1)!.first : 0;
		if (this.#queued.includes(other) && target >= 0) {
			this.#seek({ id: next.ids[0]!, charIndex: 0 });
		} else await this.#restart(next, start);
	}

	#seek(position: SpeechPosition) {
		this.following = true;
		this.#speech.seek(position);
		this.#update();
	}

	/** Speaks from elsewhere, keeping play or pause as it was. */
	async #restart(chapter: SpokenChapter, position: number) {
		const wasPlaying = this.playing;
		await this.#speakFrom(chapter, position);
		if (!wasPlaying) this.#speech.pause();
	}

	/** Tap to seek (§8.3): moves the voice to a Word in any Chapter it can read. */
	async seekToWord(chapterId: string, wordId: WordId): Promise<boolean> {
		if (!this.active || !this.covers(chapterId)) return false;
		const chapter = await this.#chapter(chapterId);
		const position = chapter.text.wordIds.indexOf(wordId);
		if (position < 0) return false;
		const s = chapter.sentences.findIndex((x) => position >= x.first && position <= x.last);
		this.following = true;
		if (this.#queued.includes(chapterId) && s >= 0) {
			this.#seek({ id: chapter.ids[s]!, charIndex: charOfWord(chapter.sentences[s]!, position) });
		} else await this.#restart(chapter, position);
		return true;
	}

	setRate(rate: number) {
		// Any preference change re-runs the reader's effect; only a new speed restarts the Word.
		if (rate === this.#rate) return;
		this.#rate = rate;
		if (this.active) this.#speech.setRate(rate);
	}

	/** The reader picked a voice (or the preference changed): use it from the Word being said. */
	setVoice(voiceId: string | undefined) {
		const voice = voiceFor(this.voices, this.#manifest.lang, voiceId);
		if (!voice || voice.id === this.voice?.id) return;
		this.voice = voice;
		// The new voice may or may not report Words; find out again.
		this.wordTiming = false;
		if (this.active) this.#speech.setVoice(voice.id);
	}

	/** Arms the sleep timer (P1-LAY-09), or turns it off with null. */
	setSleep(choice: SleepTimerChoice | null) {
		if (!this.active) return;
		this.sleepChoice = choice;
		this.#speech.setSleep(choice === null ? null : sleepTimerOf(choice));
	}

	/** The sleep timer's countdown, current whenever it's read (not reactive: poll it). */
	get sleepLeft(): SleepState | null {
		return this.active && this.sleepChoice !== null ? this.#speech.sleep : null;
	}

	/** Closes the player: stops speaking, the lock-screen controls and any sleep timer. */
	stop() {
		if (this.active) this.#speech.stop();
		this.sleepChoice = null;
		this.active = false;
		this.playing = false;
		this.word = null;
		this.chapterId = null;
		this.#queued = [];
	}

	destroy() {
		this.#destroyed = true;
		this.stop();
		for (const off of this.#offs.splice(0)) off();
	}
}

function describe(error: unknown): string {
	return error instanceof DOMException && error.name === 'NotAllowedError'
		? 'Your browser blocked the device voice. Press play again.'
		: 'The device voice couldn’t start.';
}
