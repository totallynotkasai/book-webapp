/**
 * `tools/align` for any Book (P1-STU-07, DESIGN.md §7.2): aligns a recording of one Chapter to
 * the Book's text and writes what the Studio's narration manager imports (P1-STU-03): the audio
 * as .m4a and its Sync Map. Run from the repository root:
 *
 *   npm run narration -- --epub my-book.epub --audio chapter-3.mp3 --chapter 3
 *
 *   --epub      the EPUB exactly as uploaded to the Studio (the version you're narrating)
 *   --audio     the recording, in anything ffmpeg reads (MP3, M4A, WAV, Ogg…)
 *   --chapter   the Chapter: 3 for the third Chapter with text, or its ID (text/chapter-3.xhtml)
 *   --out       where to write (default: beside the recording)
 *   --model     whisper model (default base.en; a multilingual one such as base for other languages)
 *   --lang      the recording's language (default: the Book's)
 *   --threads   whisper threads (default 8)
 *   --force     transcribe again, even if a transcript was saved before
 *
 * Writes <name>.m4a, <name>.sync.json and <name>.<model>.transcript.json (so a second run skips
 * whisper); whisper's own files go to a temporary folder. The Sync Map numbers the Words as the EPUB's own first version does; the Studio
 * matches them to a later version's WordIds by position, since the same file has the same Words
 * in the same order (§6.2).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
	alignChapter,
	findPauses,
	shiftStarts,
	startBias,
	toSyncMap,
	type ChapterWord
} from '@book/alignment';
import { REVIEW_BELOW } from '@book/domain';
import {
	readWav,
	round,
	toWhisperWav,
	transcodeForPlayback,
	transcriptWords,
	whisper,
	type Transcript
} from './audio';
import { loadBook } from './book';

/** Never shift Words by more than this when removing whisper's start bias (ADR-003). */
const MAX_BIAS_MS = 300;

const option = (name: string, fallback?: string): string => {
	const i = process.argv.indexOf(`--${name}`);
	const value = i >= 0 ? process.argv[i + 1] : fallback;
	if (value === undefined || value.startsWith('--')) {
		throw new Error(`Give --${name}. Usage: npm run narration -- --epub … --audio … --chapter …`);
	}
	return value;
};
/** npm runs the script in tools/; paths are the ones typed, from where npm was run. */
const fromHere = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path);

const epub = fromHere(option('epub'));
const audio = fromHere(option('audio'));
const chapterArg = option('chapter');
const out = fromHere(option('out', dirname(audio)));
const model = option('model', 'base.en');
const threads = Number(option('threads', '8'));
const force = process.argv.includes('--force');
for (const file of [epub, audio]) if (!existsSync(file)) throw new Error(`There's no ${file}`);

const book = await loadBook(epub, 'tools-align');
const lang = option('lang', book.manifest.lang.split('-')[0]!);
if (model.endsWith('.en') && lang !== 'en') {
	throw new Error(`${model} only knows English; this Book is in "${lang}". Use --model base.`);
}
const withWords = book.manifest.chapters.filter((c) => c.linear && c.wordCount > 0);
const entry = /^\d+$/.test(chapterArg)
	? withWords[Number(chapterArg) - 1]
	: withWords.find((c) => c.chapterId === chapterArg);
if (!entry) {
	throw new Error(
		`There's no chapter ${chapterArg}. Chapters with text: ${withWords
			.map((c, i) => `${i + 1} ${c.chapterId} “${c.title}”`)
			.join('; ')}`
	);
}
const chapter = book.revision.chapters.find((c) => c.chapterId === entry.chapterId)!;
const words: ChapterWord[] = chapter.wordIds.map((wordId, i) => ({
	wordId,
	text: chapter.texts[i]!
}));
console.log(`“${entry.title}” (${entry.chapterId}): ${words.length} words`);

const work = join(tmpdir(), 'book-tools-align');
for (const dir of [out, work]) mkdirSync(dir, { recursive: true });
const name = basename(audio, extname(audio));
const m4a = join(out, `${name}.m4a`);
const wav = join(work, `${name}.16k.wav`);
const transcriptFile = join(out, `${name}.${model}.transcript.json`);
console.log('  ffmpeg…');
transcodeForPlayback(audio, m4a);
toWhisperWav(audio, wav);
const pcm = readWav(wav);
const durationMs = Math.round((pcm.samples.length / pcm.rate) * 1000);

let transcript: Transcript;
if (existsSync(transcriptFile) && !force) {
	transcript = JSON.parse(readFileSync(transcriptFile, 'utf8')) as Transcript;
} else {
	transcript = whisper({
		model,
		wav,
		outBase: join(work, `${name}.${model}`),
		durationMs,
		threads,
		lang,
		extra: { chapterId: entry.chapterId, revisionId: book.manifest.revisionId }
	});
	writeFileSync(transcriptFile, `${JSON.stringify(transcript)}\n`);
}

const alignment = alignChapter(words, transcriptWords(transcript, 'dtw'), { durationMs });
// whisper's DTW onsets run late by a near-constant amount (ADR-003): measure it against the
// pauses in this recording and move every Word earlier by it.
const bias = Math.min(
	MAX_BIAS_MS,
	Math.max(0, startBias(alignment.timings, findPauses(pcm.samples, pcm.rate)))
);
const syncMap = toSyncMap(
	{
		// The Studio sets the track and the audio's key when it imports it.
		trackId: 'tools-align',
		revisionId: book.manifest.revisionId,
		chapterId: entry.chapterId,
		audioKey: basename(m4a),
		durationMs
	},
	{ ...alignment, timings: shiftStarts(alignment.timings, bias) }
);
const syncFile = join(out, `${name}.sync.json`);
writeFileSync(syncFile, `${JSON.stringify(syncMap)}\n`);

const coverage = round(alignment.coverage);
console.log(
	`  coverage ${coverage}${
		coverage < REVIEW_BELOW ? `: below ${REVIEW_BELOW}, so the Studio marks it for review` : ''
	}; starts moved ${bias} ms earlier`
);
console.log(
	`Import both in the Studio (Narration → your track → “${entry.title}”):\n  ${m4a}\n  ${syncFile}`
);
