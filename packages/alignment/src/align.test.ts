import { syncMapSchema, SYNC_MAP_INTERPOLATED } from '@book/core';
import { describe, expect, it } from 'vitest';
import { alignChapter, type ChapterWord } from './align';
import { timeToWordIndex, toSyncMap, wordIndexMap } from './sync-map';
import { wordsFromWhisper, type TranscriptWord, type WhisperJson } from './transcript';

const chapter = (text: string, firstId = 101): ChapterWord[] =>
	text.split(' ').map((t, i) => ({ wordId: firstId + i, text: t }));

/** Transcript words 300 ms apart, each 250 ms long. */
const heard = (text: string, startMs = 1000): TranscriptWord[] =>
	text.split(' ').map((t, i) => ({
		text: t,
		startMs: startMs + i * 300,
		endMs: startMs + i * 300 + 250,
		confidence: 0.9
	}));

describe('wordsFromWhisper', () => {
	const json: WhisperJson = {
		transcription: [
			{
				offsets: { from: 0, to: 2000 },
				tokens: [
					{ text: '[_BEG_]', offsets: { from: 0, to: 0 }, p: 0.9, t_dtw: -1 },
					{ text: ' Al', offsets: { from: 100, to: 200 }, p: 0.5, t_dtw: 15 },
					{ text: 'is', offsets: { from: 200, to: 400 }, p: 0.9, t_dtw: 22 },
					{ text: ' was', offsets: { from: 400, to: 600 }, p: 1, t_dtw: 45 },
					{ text: ',', offsets: { from: 600, to: 650 }, p: 1, t_dtw: 60 },
					{ text: ' -', offsets: { from: 650, to: 700 }, p: 1, t_dtw: 62 },
					{ text: '[_TT_100]', offsets: { from: 2000, to: 2000 }, p: 1, t_dtw: -1 }
				]
			},
			{
				offsets: { from: 2000, to: 3000 },
				tokens: [{ text: ' tired.', offsets: { from: 2000, to: 2500 }, p: 0.8, t_dtw: 210 }]
			}
		]
	};

	it('joins sub-word tokens into words and drops special tokens and lone punctuation', () => {
		expect(wordsFromWhisper(json, 'token').map((w) => w.text)).toEqual(['Alis', 'was,', 'tired.']);
	});

	it('times words by DTW onsets or by token timestamps', () => {
		expect(wordsFromWhisper(json, 'dtw').map((w) => [w.startMs, w.endMs])).toEqual([
			[150, 450],
			[450, 700],
			[2100, 2600]
		]);
		expect(wordsFromWhisper(json, 'token').map((w) => [w.startMs, w.endMs])).toEqual([
			[100, 400],
			[400, 650],
			[2000, 2500]
		]);
		expect(wordsFromWhisper(json, 'dtw')[0]!.confidence).toBeCloseTo(0.7);
	});
});

describe('alignChapter', () => {
	it('times matched Words from the transcript', () => {
		const result = alignChapter(chapter('Alice was beginning'), heard('alice was beginning'));
		expect(result.coverage).toBe(1);
		expect(result.timings).toEqual([
			{ wordId: 101, startMs: 1000, endMs: 1250, matched: true, interpolated: false },
			{ wordId: 102, startMs: 1300, endMs: 1550, matched: true, interpolated: false },
			{ wordId: 103, startMs: 1600, endMs: 1850, matched: true, interpolated: false }
		]);
	});

	it('interpolates unheard Words between their matched neighbours', () => {
		const result = alignChapter(chapter('she had peeped into the book'), heard('she had the book'));
		expect(result.coverage).toBeCloseTo(4 / 6);
		const [, had, peeped, into, the] = result.timings;
		expect(peeped!.interpolated && into!.interpolated).toBe(true);
		expect(peeped!.startMs).toBe(had!.endMs);
		expect(into!.endMs).toBe(the!.startMs);
		expect(into!.startMs).toBeGreaterThan(peeped!.startMs);
	});

	it('counts a substituted Word as unmatched but keeps reading order', () => {
		const result = alignChapter(chapter('a very deep well'), heard('a very dark well'));
		expect(result.stats.substituted).toBe(1);
		expect(result.timings.map((t) => t.matched)).toEqual([true, true, false, true]);
		const starts = result.timings.map((t) => t.startMs);
		expect([...starts].sort((x, y) => x - y)).toEqual(starts);
	});

	it('matches numbers, contractions and compounds across spellings', () => {
		const result = alignChapter(
			chapter('CHAPTER I. she didn’t see forty-two to day'),
			heard("chapter one she didn't see 42 today")
		);
		expect(result.coverage).toBe(1);
		// The Words "to" and "day" (as Intl.Segmenter splits "to-day") share the heard "today".
		const [to, day] = result.timings.slice(-2);
		expect(to!.endMs).toBe(day!.startMs);
	});

	it('ignores the narrator’s preamble and gives leading unheard Words time before the first match', () => {
		const result = alignChapter(
			chapter('Down the Rabbit Hole Alice was beginning'),
			heard('this is a librivox recording alice was beginning', 5000)
		);
		expect(result.stats.unusedTranscriptWords).toBe(5);
		const [down, , , hole, alice] = result.timings;
		expect(down!.interpolated && hole!.interpolated).toBe(true);
		expect(hole!.endMs).toBeLessThanOrEqual(alice!.startMs);
		expect(down!.startMs).toBeGreaterThanOrEqual(0);
	});

	it('keeps trailing interpolated Words inside the audio', () => {
		const result = alignChapter(chapter('the end of it all'), heard('the end'), {
			durationMs: 1700
		});
		expect(result.timings.at(-1)!.endMs).toBeLessThanOrEqual(1700);
	});
});

describe('Sync Maps', () => {
	const alignment = alignChapter(
		chapter('Alice was beginning to get very tired'),
		heard('alice was to get very tired')
	);
	const map = toSyncMap(
		{
			trackId: 'track-1',
			revisionId: 'rev-1',
			chapterId: 'ch-1',
			audioKey: 'tracks/track-1/audio/ch-1.m4a',
			durationMs: 4000.4
		},
		alignment
	);

	it('writes exactly the §7.2 format', () => {
		expect(Object.keys(map)).toEqual([
			'version',
			'trackId',
			'revisionId',
			'chapterId',
			'audioKey',
			'durationMs',
			'coverage',
			'words'
		]);
		expect(map.version).toBe(1);
		expect(map.durationMs).toBe(4000);
		expect(map.coverage).toBe(0.8571);
		expect(map.words[0]).toEqual([101, 1000, 1250, 0]);
		expect(map.words[2]![3] & SYNC_MAP_INTERPOLATED).toBe(1);
		expect(syncMapSchema.safeParse(map).success).toBe(true);
	});

	it('rejects maps that are out of order', () => {
		const broken = { ...map, words: [...map.words].reverse() };
		expect(syncMapSchema.safeParse(broken).success).toBe(false);
	});

	it('finds the Word being spoken by binary search', () => {
		expect(timeToWordIndex(map.words, 0)).toBe(-1);
		expect(timeToWordIndex(map.words, 1000)).toBe(0);
		expect(timeToWordIndex(map.words, 1299)).toBe(0);
		expect(timeToWordIndex(map.words, 1300)).toBe(1);
		expect(timeToWordIndex(map.words, 99_999)).toBe(map.words.length - 1);
		expect(timeToWordIndex([], 500)).toBe(-1);
	});

	it('maps WordIds to their entries for tap-to-seek', () => {
		const index = wordIndexMap(map.words);
		expect(index.get(101)).toBe(0);
		expect(map.words[index.get(107)!]![0]).toBe(107);
		expect(index.get(999)).toBeUndefined();
	});
});
