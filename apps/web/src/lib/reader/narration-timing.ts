/**
 * Sync Map lookups for the narration player (DESIGN.md §8.3): time → Word by binary search on
 * the Sync Map, Word → time through a `Map<WordId, index>` built on load, and sentences from
 * the Chapter's Words. Plain functions and a cache, so they test without a player.
 */
import type { SyncMap, WordId } from '@book/core';
import { sentenceAt, sentenceSpans } from '@book/domain';
import type { ChapterText } from '@book/reader-core';

/** The Word being read aloud and its sentence, as Ordinals on the open Revision. */
export interface ReadWord {
	chapterId: string;
	wordId: WordId;
	ordinal: number;
	text: string;
	/** The sentence's first and last Words. */
	sentence: { first: number; last: number; firstWordId: WordId; lastWordId: WordId };
}

/** The narrated Word: a ReadWord with its time in the recording. */
export interface NarratedWord extends ReadWord {
	/** When the recording says it. */
	startMs: number;
}

/** A Chapter's Sync Map joined to its Words. */
export interface Timing {
	chapterId: string;
	map: SyncMap;
	/** `map.words[i][1]`, for binary search. */
	starts: number[];
	/** WordId → entry in `map.words`. */
	entryOf: Map<WordId, number>;
	text: ChapterText;
	/** WordId → position in the Chapter's Words. */
	positionOf: Map<WordId, number>;
	/** Sentences as first and last positions. */
	sentences: [number, number][];
}

export function makeTiming(map: SyncMap, text: ChapterText): Timing {
	return {
		chapterId: map.chapterId,
		map,
		starts: map.words.map((w) => w[1]),
		entryOf: new Map(map.words.map((w, i) => [w[0], i])),
		text,
		positionOf: new Map(text.wordIds.map((id, i) => [id, i])),
		sentences: sentenceSpans(text.texts, text.blocks)
	};
}

/** The last index whose value is ≤ `t`, or -1. */
export function lastAtOrBefore(values: readonly number[], t: number): number {
	let lo = 0;
	let hi = values.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (values[mid]! <= t) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found;
}

/** When the Word at `position` starts, or the next Word that has a time; null past the end. */
export function startOf(timing: Timing, position: number): number | null {
	for (let p = Math.max(0, position); p < timing.text.wordIds.length; p++) {
		const entry = timing.entryOf.get(timing.text.wordIds[p]!);
		if (entry !== undefined) return timing.map.words[entry]![1];
	}
	return null;
}

/** The Word narrated at `t`, or null before the first (a recording's own introduction). */
export function wordAt(timing: Timing, t: number): { entry: number; word: NarratedWord | null } {
	const entry = lastAtOrBefore(timing.starts, t);
	if (entry < 0) return { entry, word: null };
	const wordId = timing.map.words[entry]![0];
	const position = timing.positionOf.get(wordId);
	if (position === undefined) return { entry, word: null };
	const { firstOrdinal, wordIds, texts } = timing.text;
	const s = timing.sentences[sentenceAt(timing.sentences, position)] ?? [position, position];
	return {
		entry,
		word: {
			chapterId: timing.chapterId,
			wordId,
			ordinal: firstOrdinal + position,
			text: texts[position] ?? '',
			startMs: timing.map.words[entry]![1],
			sentence: {
				first: firstOrdinal + s[0],
				last: firstOrdinal + s[1],
				firstWordId: wordIds[s[0]]!,
				lastWordId: wordIds[s[1]]!
			}
		}
	};
}

/** Loads each Chapter's Timing once, and has the loaded ones at hand for every frame. */
export class TimingCache {
	readonly #pending = new Map<string, Promise<Timing>>();
	readonly #ready = new Map<string, Timing>();

	get(chapterId: string, load: () => Promise<Timing>): Promise<Timing> {
		let timing = this.#pending.get(chapterId);
		if (!timing) {
			timing = load().then((t) => {
				this.#ready.set(chapterId, t);
				return t;
			});
			// A failure isn't kept: the next request tries again.
			timing.catch(() => this.#pending.delete(chapterId));
			this.#pending.set(chapterId, timing);
		}
		return timing;
	}

	ready(chapterId: string): Timing | undefined {
		return this.#ready.get(chapterId);
	}
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function chapterNumber(label: string): number | null {
	const match = /^\s*chapter\s+([ivxlcdm]+|\d+)\b/i.exec(label);
	if (!match) return null;
	const n = match[1]!.toLowerCase();
	if (/^\d+$/.test(n)) return Number(n);
	let total = 0;
	for (let i = 0; i < n.length; i++) {
		const value = ROMAN[n[i]!]!;
		const next = ROMAN[n[i + 1] ?? ''] ?? 0;
		total += value < next ? -value : value;
	}
	return total;
}

/** "chapters 1–3" from the Chapters' titles, or the titles themselves when they aren't numbered. */
export function coverageLabel(titles: string[]): string {
	const numbers = titles.map(chapterNumber);
	if (numbers.length && numbers.every((n) => n !== null)) {
		const sorted = [...(numbers as number[])].sort((a, b) => a - b);
		const runs: string[] = [];
		for (let i = 0; i < sorted.length; i++) {
			let j = i;
			while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
			runs.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
			i = j;
		}
		const list = runs.length > 1 ? `${runs.slice(0, -1).join(', ')} and ${runs.at(-1)}` : runs[0]!;
		return `${sorted.length > 1 ? 'chapters' : 'chapter'} ${list}`;
	}
	const quoted = titles.map((t) => `“${t}”`);
	return quoted.length > 3
		? `${quoted[0]} to ${quoted.at(-1)}`
		: quoted.length > 1
			? `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`
			: (quoted[0] ?? 'no chapters');
}
