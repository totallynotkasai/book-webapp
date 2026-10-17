/**
 * `tools/align` (P1-LAY-03, DESIGN.md §7.2): aligns the LibriVox *Alice* narration to the
 * catalogue Revision and writes the demo Audio Track: a Sync Map per Chapter and `track.json`.
 * Grew from the P0-06 spike; ADR-003 has the measurements behind its choices. With `--epub`, it
 * aligns a recording of any Book's Chapter instead (P1-STU-07; see align-book.ts).
 *
 *   npm run narration                       # chapters 1–3
 *   npm run narration -- --chapters 1,2     # some chapters
 *   npm run narration -- --force            # transcode and transcribe again (needs whisper.cpp)
 *   options: --models base.en,small.en  --model base.en  --threads 8
 *   npm run narration -- --epub my-book.epub --audio chapter-3.mp3 --chapter 3
 *
 * Per Chapter:
 *   1. ffmpeg: MP3 → 16 kHz mono WAV for whisper, and → AAC .m4a, mono, 64 kbps, loudness-
 *      normalised to −18 LUFS (two passes) for playback. The .m4a files are generated, not
 *      committed (apps/web/static/demo/audio/alice/).
 *   2. whisper.cpp with DTW token timestamps, per model. Compact transcripts are committed in
 *      fixtures/sync/transcripts/, so this step is skipped while they exist (no whisper needed).
 *   3. @book/alignment against the Chapter's Words from text-pipeline (the same WordIds readers
 *      have): align, interpolate, score, and remove DTW's start bias measured against the pauses
 *      in the audio. The `--model` Sync Map is written to apps/web/static/demo/sync/alice/.
 *      Coverage must reach 0.95 (P1-LAY-03), or the run fails.
 *
 * Tools: ffmpeg and whisper.cpp, found as audio.ts says.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	alignChapter,
	findPauses,
	shiftStarts,
	startBias,
	timingAccuracy,
	toSyncMap,
	type ChapterWord
} from '@book/alignment';
import { AUDIO_TRACK_FILE_VERSION, audioTrackFileSchema } from '@book/core';
import type { RevisionChapter } from '@book/text-pipeline';
import {
	readWav,
	round,
	run,
	toWhisperWav,
	transcodeForPlayback,
	transcriptWords,
	whisper,
	type Transcript
} from './audio';
import { loadBook, ROOT } from './book';

if (process.argv.includes('--epub')) {
	// Any Book's Chapter (P1-STU-07).
	await import('./align-book');
	process.exit(0);
}

const TRACK_ID = 'track-alice-librivox-shallenberg';
const AUDIO_IN = join(ROOT, 'fixtures/audio/alice');
const WORK = join(AUDIO_IN, 'work');
const AUDIO_OUT = join(ROOT, 'apps/web/static/demo/audio/alice');
const SYNC_OUT = join(ROOT, 'apps/web/static/demo/sync/alice');
const TRANSCRIPTS = join(ROOT, 'fixtures/sync/transcripts');
const REPORT = join(ROOT, 'fixtures/sync/alice-report.json');
/** Never shift Words by more than this when removing whisper's start bias. */
const MAX_BIAS_MS = 300;
const MIN_COVERAGE = 0.95;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

const pad = (n: number) => String(n).padStart(2, '0');
const option = (name: string, fallback: string) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1]! : fallback;
};
const force = process.argv.includes('--force');
const chapters = option('chapters', '1,2,3').split(',').map(Number);
const models = option('models', 'base.en,small.en').split(',');
const primary = option('model', 'base.en');
const threads = Number(option('threads', '8'));
if (!models.includes(primary)) models.push(primary);

function transcribe(n: number, model: string, wav: string, durationMs: number): Transcript {
	const cache = join(TRANSCRIPTS, `alice-ch${pad(n)}.${model}.json`);
	if (existsSync(cache) && !force) return JSON.parse(readFileSync(cache, 'utf8')) as Transcript;
	const transcript = whisper({
		model,
		wav,
		outBase: join(WORK, `ch${pad(n)}.${model}`),
		durationMs,
		threads,
		lang: 'en',
		extra: { chapter: n }
	});
	mkdirSync(TRANSCRIPTS, { recursive: true });
	writeFileSync(cache, `${JSON.stringify(transcript)}\n`);
	return transcript;
}

// ---------------------------------------------------------------------------------------------

const book = await loadBook();
const chapterFor = (n: number): RevisionChapter => {
	const entry = book.manifest.toc.find((t) => t.label.startsWith(`CHAPTER ${ROMAN[n - 1]}.`));
	const chapter = entry && book.revision.chapters.find((c) => c.chapterId === entry.chapterId);
	if (!chapter) throw new Error(`Chapter ${n} isn't in the Book's table of contents`);
	return chapter;
};

for (const dir of [WORK, AUDIO_OUT, SYNC_OUT]) mkdirSync(dir, { recursive: true });
if (
	chapters.some((n) => !existsSync(join(AUDIO_IN, `alices_adventures_${pad(n)}_carroll_64kb.mp3`)))
) {
	console.log('Fetching the LibriVox MP3s (npm run fixtures:audio)…');
	run(process.execPath, [join(ROOT, 'fixtures/scripts/download-audio.mjs')]);
}

const report = existsSync(REPORT)
	? (JSON.parse(readFileSync(REPORT, 'utf8')) as { chapters: Record<string, unknown> })
	: { chapters: {} };
const trackPath = join(SYNC_OUT, 'track.json');
const track = existsSync(trackPath)
	? (JSON.parse(readFileSync(trackPath, 'utf8')) as { chapters: Record<string, unknown>[] })
	: { chapters: [] };
const problems: string[] = [];

for (const n of chapters) {
	console.log(`Chapter ${n}`);
	const mp3 = join(AUDIO_IN, `alices_adventures_${pad(n)}_carroll_64kb.mp3`);
	const m4a = join(AUDIO_OUT, `ch${pad(n)}.m4a`);
	if (!existsSync(m4a) || force) {
		transcodeForPlayback(mp3, m4a);
		console.log(`  ${m4a} (${Math.round(statSync(m4a).size / 1024)} KB)`);
	}
	const wav = join(WORK, `ch${pad(n)}.16k.wav`);
	if (!existsSync(wav) || force) {
		toWhisperWav(mp3, wav);
	}
	const pcm = readWav(wav);
	const durationMs = Math.round((pcm.samples.length / pcm.rate) * 1000);
	const pauses = findPauses(pcm.samples, pcm.rate);
	const chapter = chapterFor(n);
	const words: ChapterWord[] = chapter.wordIds.map((wordId, i) => ({
		wordId,
		text: chapter.texts[i]!
	}));

	const entry: Record<string, unknown> = {
		chapterId: chapter.chapterId,
		words: words.length,
		durationMs,
		models: {}
	};
	for (const model of models) {
		const transcript = transcribe(n, model, wav, durationMs);
		const perTiming: Record<string, unknown> = {};
		for (const timing of ['dtw', 'token'] as const) {
			const alignment = alignChapter(words, transcriptWords(transcript, timing), { durationMs });
			// whisper's DTW onsets run late by a near-constant amount (ADR-003): measure it against
			// the pauses in this Chapter's audio and move every Word earlier by it.
			const bias = Math.min(MAX_BIAS_MS, Math.max(0, startBias(alignment.timings, pauses)));
			const calibrated = { ...alignment, timings: shiftStarts(alignment.timings, bias) };
			perTiming[timing] = {
				coverage: round(alignment.coverage),
				accuracyCalibrated: timingAccuracy(calibrated.timings, pauses),
				startBiasMs: bias
			};
			if (model !== primary || timing !== 'dtw') continue;
			if (alignment.coverage < MIN_COVERAGE) {
				problems.push(
					`Chapter ${n}: coverage ${round(alignment.coverage)} is below ${MIN_COVERAGE}`
				);
			}
			const syncMap = toSyncMap(
				{
					trackId: TRACK_ID,
					revisionId: book.manifest.revisionId,
					chapterId: chapter.chapterId,
					// SIMULATION: the demo serves audio as a static file; Phase 3 keys it as
					// tracks/{trackId}/audio/{chapterId}.m4a behind content tokens (§6.7).
					audioKey: `demo/audio/alice/ch${pad(n)}.m4a`,
					durationMs
				},
				calibrated
			);
			writeFileSync(join(SYNC_OUT, `ch${pad(n)}.json`), `${JSON.stringify(syncMap)}\n`);
			const summary = {
				chapterId: chapter.chapterId,
				syncMap: `ch${pad(n)}.json`,
				audio: `/demo/audio/alice/ch${pad(n)}.m4a`,
				durationMs,
				coverage: round(alignment.coverage)
			};
			track.chapters = [
				...track.chapters.filter((c) => c.chapterId !== chapter.chapterId),
				summary
			];
			console.log(
				`  Sync Map: coverage ${round(alignment.coverage)}, starts moved ${bias} ms earlier`
			);
		}
		(entry.models as Record<string, unknown>)[model] = {
			transcriptWords: transcript.words.length,
			wallMs: transcript.wallMs,
			realtimeFactor: round(transcript.wallMs / durationMs, 3),
			...perTiming
		};
	}
	report.chapters[`ch${pad(n)}`] = entry;
}

const chapterOrder = book.manifest.chapters.map((c) => c.chapterId);
// Checked against the schema backend-local reads it with (P1-LAY-04).
const trackFile = audioTrackFileSchema.parse({
	version: AUDIO_TRACK_FILE_VERSION,
	id: TRACK_ID,
	bookId: 'book-alice',
	revisionId: book.manifest.revisionId,
	chapters: track.chapters.sort(
		(a, b) => chapterOrder.indexOf(String(a.chapterId)) - chapterOrder.indexOf(String(b.chapterId))
	)
});
writeFileSync(trackPath, `${JSON.stringify(trackFile, null, '\t')}\n`);
writeFileSync(
	REPORT,
	`${JSON.stringify({ ...report, generated: 'tools/src/align.ts', revisionId: book.manifest.revisionId, primaryModel: primary }, null, '\t')}\n`
);
if (problems.length) throw new Error(problems.join('\n'));
console.log(`Track: ${trackPath}\nReport: ${REPORT}`);
