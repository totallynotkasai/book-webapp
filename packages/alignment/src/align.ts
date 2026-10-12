/**
 * Aligns a Chapter's Words with a transcript and times every Word (docs/DESIGN.md §7.2 steps
 * 3–6): normalise both sides, align the token sequences, give matched Words the transcript's
 * times, interpolate the rest between matched neighbours, and score coverage.
 */
import type { WordId } from '@book/core';
import { tokenise, type Token } from './normalise';
import { alignSequences, type PairKind, type SequenceOptions } from './sequence';
import type { TranscriptWord } from './transcript';

/** A Word from the Chapter's word index, in reading order. */
export interface ChapterWord {
	wordId: WordId;
	text: string;
}

export interface WordTiming {
	wordId: WordId;
	startMs: number;
	endMs: number;
	/** Heard in the transcript (an exact, fuzzy or merged match). */
	matched: boolean;
	/** Times were interpolated between matched neighbours (`flags & 1` in the Sync Map). */
	interpolated: boolean;
}

export interface AlignmentStats {
	words: number;
	matched: number;
	exact: number;
	fuzzy: number;
	merged: number;
	/** Words aligned against a different transcript word (counted as unmatched). */
	substituted: number;
	/** Transcript words that matched no Word (preamble, closing, mishearings, insertions). */
	unusedTranscriptWords: number;
	band: number;
	cells: number;
}

export interface ChapterAlignment {
	/** One per Word, in reading order. */
	timings: WordTiming[];
	/** matched / total, 0–1 (§7.2 step 6). */
	coverage: number;
	stats: AlignmentStats;
}

export interface AlignOptions extends SequenceOptions {
	/** The audio's length; trailing interpolated Words never run past it. */
	durationMs?: number;
	/** Time given to each unmatched Word before the first or after the last match (default 300). */
	msPerWord?: number;
}

/** Splits each word's time span across its tokens in proportion to their length. */
function tokenTimes(tokens: Token[], words: readonly TranscriptWord[]): [number, number][] {
	const out: [number, number][] = [];
	let i = 0;
	while (i < tokens.length) {
		const source = tokens[i]!.source;
		let j = i;
		while (j < tokens.length && tokens[j]!.source === source) j++;
		const word = words[source]!;
		const total = tokens.slice(i, j).reduce((s, t) => s + t.text.length, 0);
		let at = word.startMs;
		for (let k = i; k < j; k++) {
			const share = ((word.endMs - word.startMs) * tokens[k]!.text.length) / total;
			out.push([at, at + share]);
			at += share;
		}
		i = j;
	}
	return out;
}

const weight = (text: string) => text.length + 1;

export function alignChapter(
	words: readonly ChapterWord[],
	transcript: readonly TranscriptWord[],
	options: AlignOptions = {}
): ChapterAlignment {
	const msPerWord = options.msPerWord ?? 300;
	const textTokens = tokenise(words.map((w) => w.text));
	const heardTokens = tokenise(transcript.map((w) => w.text));
	const heardTimes = tokenTimes(heardTokens, transcript);
	const alignment = alignSequences(
		textTokens.map((t) => t.text),
		heardTokens.map((t) => t.text),
		options
	);

	const spans: ([number, number] | undefined)[] = words.map(() => undefined);
	const kinds = new Map<number, PairKind>();
	const usedHeard = new Set<number>();
	for (const pair of alignment.pairs) {
		const word = textTokens[pair.aStart]!.source;
		if (pair.kind === 'mismatch') {
			if (!kinds.has(word)) kinds.set(word, 'mismatch');
			continue;
		}
		const from = heardTimes[pair.bStart]![0];
		const to = heardTimes[pair.bEnd - 1]![1];
		for (let b = pair.bStart; b < pair.bEnd; b++) usedHeard.add(heardTokens[b]!.source);
		// Share the heard span across the text tokens (two text Words merged into one heard word).
		const parts = textTokens.slice(pair.aStart, pair.aEnd);
		const total = parts.reduce((s, t) => s + t.text.length, 0);
		let at = from;
		for (const token of parts) {
			const end = at + ((to - from) * token.text.length) / total;
			const span = spans[token.source];
			spans[token.source] = span ? [Math.min(span[0], at), Math.max(span[1], end)] : [at, end];
			kinds.set(token.source, pair.kind);
			at = end;
		}
	}

	const timings: WordTiming[] = words.map((w, i) => ({
		wordId: w.wordId,
		startMs: spans[i]?.[0] ?? 0,
		endMs: spans[i]?.[1] ?? 0,
		matched: spans[i] !== undefined,
		interpolated: spans[i] === undefined
	}));

	// Fill gaps: runs of unmatched Words share the time between their matched neighbours.
	let i = 0;
	while (i < timings.length) {
		if (timings[i]!.matched) {
			i++;
			continue;
		}
		let j = i;
		while (j < timings.length && !timings[j]!.matched) j++;
		const before = timings[i - 1];
		const after = timings[j];
		const count = j - i;
		let from: number;
		let to: number;
		if (before && after) {
			from = before.endMs;
			to = Math.max(from, after.startMs);
		} else if (after) {
			to = after.startMs;
			from = Math.max(0, to - count * msPerWord);
		} else if (before) {
			from = before.endMs;
			to = from + count * msPerWord;
			if (options.durationMs !== undefined) to = Math.max(from, Math.min(to, options.durationMs));
		} else {
			from = 0;
			to = options.durationMs ?? count * msPerWord;
		}
		const run = words.slice(i, j);
		const total = run.reduce((s, w) => s + weight(w.text), 0);
		let at = from;
		for (let k = i; k < j; k++) {
			const end = at + ((to - from) * weight(words[k]!.text)) / total;
			timings[k]!.startMs = at;
			timings[k]!.endMs = end;
			at = end;
		}
		i = j;
	}

	// Whole milliseconds, starts never decreasing, ends never before starts.
	let previous = 0;
	for (const t of timings) {
		t.startMs = Math.max(previous, Math.round(t.startMs));
		t.endMs = Math.max(t.startMs, Math.round(t.endMs));
		previous = t.startMs;
	}

	const matched = timings.filter((t) => t.matched).length;
	const count = (kind: PairKind) => [...kinds.values()].filter((k) => k === kind).length;
	return {
		timings,
		coverage: words.length ? matched / words.length : 0,
		stats: {
			words: words.length,
			matched,
			exact: count('exact'),
			fuzzy: count('fuzzy'),
			merged: count('merge'),
			substituted: [...kinds.entries()].filter(([w, k]) => k === 'mismatch' && !spans[w]).length,
			unusedTranscriptWords: transcript.length - usedHeard.size,
			band: alignment.band,
			cells: alignment.cells
		}
	};
}
