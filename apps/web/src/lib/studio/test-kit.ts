/**
 * A narration test kit for the Studio's narration manager (dev panel, plan §6 Phase 1.7 Try-it):
 * a silent WAV and a Sync Map for one Chapter of one of the signed-in Creator's Books, with
 * made-up timings and some Words marked as guessed, so the Chapter needs review. It exercises the
 * real import path; real narration comes from `tools/align` (`npm run narration`).
 */
import {
	revisionManifestSchema,
	SYNC_MAP_INTERPOLATED,
	wordIndexSchema,
	type Backend,
	type SyncMap,
	type SyncMapWord
} from '@book/core';

/** About three Words a second, as a narrator reads. */
const WORD_MS = 330;
const SAMPLE_RATE = 8000;

/** Mono 8-bit silence: small, and every browser plays it. */
export function silentWav(durationMs: number): Blob {
	const samples = Math.ceil((durationMs / 1000) * SAMPLE_RATE);
	const buffer = new ArrayBuffer(44 + samples);
	const view = new DataView(buffer);
	const text = (offset: number, value: string) =>
		[...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
	text(0, 'RIFF');
	view.setUint32(4, 36 + samples, true);
	text(8, 'WAVE');
	text(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE, true);
	view.setUint16(32, 1, true);
	view.setUint16(34, 8, true);
	text(36, 'data');
	view.setUint32(40, samples, true);
	new Uint8Array(buffer, 44).fill(128);
	return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * The kit for Chapter `chapterNumber` (1-based, Chapters with Words only) of the Book as readers
 * open it now. Every seventh Word, and a run of five in the middle, is "guessed", so coverage is
 * about 0.83: below 0.90, so it needs review (§7.2).
 */
export async function narrationKit(
	backend: Backend,
	bookId: string,
	chapterNumber: number
): Promise<{ chapterTitle: string; audio: Blob; syncMap: SyncMap }> {
	const opened = await backend.content.open(bookId);
	const read = async (path: string) =>
		JSON.parse(await (await backend.content.read(opened.contentToken, path)).text()) as unknown;
	const manifest = revisionManifestSchema.parse(await read('manifest.json'));
	const chapters = manifest.chapters.filter((c) => c.linear && c.wordCount > 0);
	const chapter = chapters[chapterNumber - 1];
	if (!chapter) throw new Error(`This book has ${chapters.length} chapters with words.`);
	const index = wordIndexSchema.parse(await read(`index/${chapter.chapterId}.words.json`));
	const middle = Math.floor(index.words.length / 2);
	const words: SyncMapWord[] = index.words.map(([wordId], i) => [
		wordId,
		500 + i * WORD_MS,
		500 + i * WORD_MS + WORD_MS - 30,
		i % 7 === 6 || (i >= middle && i < middle + 5) ? SYNC_MAP_INTERPOLATED : 0
	]);
	const durationMs = 1000 + words.length * WORD_MS;
	const heard = words.filter((w) => w[3] === 0).length;
	return {
		chapterTitle: chapter.title,
		audio: silentWav(durationMs),
		syncMap: {
			version: 1,
			trackId: 'test-kit',
			revisionId: opened.revisionId,
			chapterId: chapter.chapterId,
			audioKey: 'test-kit.wav',
			durationMs,
			coverage: heard / words.length,
			words
		}
	};
}
