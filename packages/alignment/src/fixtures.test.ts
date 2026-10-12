// The P0-06 acceptance check on real data: whisper.cpp transcripts of the LibriVox reading
// (committed in fixtures/sync/transcripts/) against the Gutenberg text's word index.
import { describe, expect, it } from 'vitest';
import index from '../../../fixtures/sync/alice-word-index.json';
import ch01Base from '../../../fixtures/sync/transcripts/alice-ch01.base.en.json';
import ch01Small from '../../../fixtures/sync/transcripts/alice-ch01.small.en.json';
import ch02Base from '../../../fixtures/sync/transcripts/alice-ch02.base.en.json';
import ch02Small from '../../../fixtures/sync/transcripts/alice-ch02.small.en.json';
import { alignChapter, type ChapterWord } from './align';
import type { TranscriptWord } from './transcript';

interface Transcript {
	model: string;
	durationMs: number;
	words: (string | number)[][];
}

function chapterWords(chapter: number): ChapterWord[] {
	const section = index.chapters.find((c) => c.chapter === chapter)!;
	return section.words.map(([wordId, text]) => ({ wordId: Number(wordId), text: String(text) }));
}

/** Compact transcript rows: [text, dtwStart, dtwEnd, tokenStart, tokenEnd, confidence × 1000]. */
function heard(transcript: Transcript): TranscriptWord[] {
	return transcript.words.map(([text, start, end, , , confidence]) => ({
		text: String(text),
		startMs: Number(start),
		endMs: Number(end),
		confidence: Number(confidence) / 1000
	}));
}

const CASES: [number, Transcript][] = [
	[1, ch01Base],
	[1, ch01Small],
	[2, ch02Base],
	[2, ch02Small]
];

describe('LibriVox Alice against the Gutenberg text', () => {
	it.each(CASES)('chapter %i reaches coverage ≥ 0.95', (chapter, transcript) => {
		const words = chapterWords(chapter);
		const started = performance.now();
		const result = alignChapter(words, heard(transcript), { durationMs: transcript.durationMs });
		const elapsed = performance.now() - started;
		expect(result.coverage, transcript.model).toBeGreaterThanOrEqual(0.95);
		expect(result.timings).toHaveLength(words.length);
		// About 2,100 Words against their transcript, within the first band.
		expect(result.stats.band).toBe(200);
		expect(elapsed).toBeLessThan(3000);
		const starts = result.timings.map((t) => t.startMs);
		expect(starts.every((s, i) => i === 0 || s >= starts[i - 1]!)).toBe(true);
		expect(result.timings.at(-1)!.endMs).toBeLessThanOrEqual(transcript.durationMs);
	});

	it('is deterministic', () => {
		const words = chapterWords(1);
		const a = alignChapter(words, heard(ch01Base));
		const b = alignChapter(words, heard(ch01Base));
		expect(a).toEqual(b);
	});
});
