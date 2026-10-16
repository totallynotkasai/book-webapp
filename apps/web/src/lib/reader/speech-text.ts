/**
 * What the device voice says (P1-LAY-08): a Chapter's sentences (`sentenceSpans`, §8.3) as text
 * to speak, with each Word's offset in it, so a Word boundary reported by the voice maps back to
 * the Word on the page. Plain functions, tested without a voice.
 */
import { sentenceSpans } from '@book/domain';
import type { ChapterText } from '@book/reader-core';
import type { SpeechVoice } from '$lib/platform';
import { gapAfter } from './words';

export interface SpokenSentence {
	/** First and last Word, as positions in the Chapter's Words. */
	first: number;
	last: number;
	/** The Words with their punctuation, joined as on the page (`joinWords`). */
	text: string;
	/** Where each Word (from `first` on) starts in `text`. */
	starts: number[];
}

export function spokenSentences(text: ChapterText): SpokenSentence[] {
	return sentenceSpans(text.texts, text.blocks).map(([first, last]) => {
		const starts: number[] = [];
		let joined = '';
		for (let i = first; i <= last; i++) {
			if (i > first) joined += gapAfter(text.texts[i - 1]!);
			starts.push(joined.length);
			joined += text.texts[i];
		}
		return { first, last, text: joined, starts };
	});
}

/** A Chapter ready to speak: its Words, its sentences, and an utterance id for each sentence. */
export interface SpokenChapter {
	chapterId: string;
	text: ChapterText;
	sentences: SpokenSentence[];
	ids: number[];
}

/**
 * Each Chapter's sentences, loaded once, with utterance ids unique in the Book: what the
 * device voice queues and what its progress maps back to. A failed load isn't kept.
 */
export class SpokenChapters {
	readonly #pending = new Map<string, Promise<SpokenChapter>>();
	readonly #ready = new Map<string, SpokenChapter>();
	/** Utterance id → its Chapter and sentence. */
	readonly #utterances = new Map<number, { chapterId: string; sentence: number }>();
	#nextId = 1;
	readonly #load: (chapterId: string) => Promise<ChapterText>;

	constructor(load: (chapterId: string) => Promise<ChapterText>) {
		this.#load = load;
	}

	get(chapterId: string): Promise<SpokenChapter> {
		let chapter = this.#pending.get(chapterId);
		if (!chapter) {
			chapter = this.#load(chapterId).then((text) => {
				const sentences = spokenSentences(text);
				const ids = sentences.map((_, sentence) => {
					const id = this.#nextId++;
					this.#utterances.set(id, { chapterId, sentence });
					return id;
				});
				const spoken = { chapterId, text, sentences, ids };
				this.#ready.set(chapterId, spoken);
				return spoken;
			});
			chapter.catch(() => this.#pending.delete(chapterId));
			this.#pending.set(chapterId, chapter);
		}
		return chapter;
	}

	/** The Chapter and sentence an utterance id stands for, once its Chapter has loaded. */
	locate(id: number): { chapter: SpokenChapter; index: number; sentence: SpokenSentence } | null {
		const utterance = this.#utterances.get(id);
		const chapter = utterance ? this.#ready.get(utterance.chapterId) : undefined;
		const sentence = utterance ? chapter?.sentences[utterance.sentence] : undefined;
		return utterance && chapter && sentence
			? { chapter, index: utterance.sentence, sentence }
			: null;
	}
}

/** The utterances for a Chapter's sentences, from one of them to its end. */
export function utterancesOf(chapter: SpokenChapter, fromSentence = 0) {
	return chapter.sentences
		.slice(fromSentence)
		.map((s, i) => ({ id: chapter.ids[fromSentence + i]!, text: s.text }));
}

/** The Word being said at `charIndex` in a sentence: the last one starting at or before it. */
export function wordAtChar(sentence: SpokenSentence, charIndex: number): number {
	let lo = 0;
	let hi = sentence.starts.length - 1;
	let found = 0;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (sentence.starts[mid]! <= charIndex) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return sentence.first + found;
}

/** Where a Word starts in its sentence's text. */
export function charOfWord(sentence: SpokenSentence, position: number): number {
	return sentence.starts[
		Math.min(Math.max(0, position - sentence.first), sentence.starts.length - 1)
	]!;
}

/** `en` from `en-GB` or `en_GB`. */
export function primaryLanguage(lang: string): string {
	return lang.split(/[-_]/)[0]!.toLowerCase();
}

/** Language codes that say nothing about the language: any voice will do. */
const UNKNOWN_LANGUAGES = new Set(['', 'und', 'mul', 'zxx']);

/**
 * The voice to use: the reader's choice for the Book's language if the device still has it,
 * else the device's default for that language, else any voice in it; null when none speaks it
 * (an English voice reading French helps no one). A Book that doesn't say its language gets any.
 */
export function voiceFor(
	voices: readonly SpeechVoice[],
	lang: string,
	chosen: string | undefined
): SpeechVoice | null {
	const primary = primaryLanguage(lang);
	const same = UNKNOWN_LANGUAGES.has(primary)
		? voices
		: voices.filter((v) => primaryLanguage(v.lang) === primary);
	return same.find((v) => v.id === chosen) ?? same.find((v) => v.default) ?? same[0] ?? null;
}
