/**
 * The audio steps `tools/align` shares between the demo *Alice* and any Book (DESIGN.md §7.2):
 * ffmpeg for transcoding, whisper.cpp for the transcript, and the WAV reader for the pauses.
 *
 * Tools: FFMPEG (default `ffmpeg` on PATH), WHISPER_CLI (default
 * ~/.book-tools/whisper-blas/Release/whisper-cli.exe, then `whisper-cli`), WHISPER_MODELS
 * (folder with ggml-<model>.bin; default ~/.book-tools/downloads).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { wordsFromWhisper } from '@book/alignment';

export const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
export const WHISPER_CLI =
	process.env.WHISPER_CLI ??
	[join(homedir(), '.book-tools/whisper-blas/Release/whisper-cli.exe')].find(existsSync) ??
	'whisper-cli';
export const MODELS = process.env.WHISPER_MODELS ?? join(homedir(), '.book-tools/downloads');
const LOUDNESS = 'I=-18:TP=-1.5:LRA=11';

export function run(command: string, args: string[]) {
	const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
	if (result.error) throw new Error(`${command}: ${result.error.message}`);
	if (result.status !== 0) {
		throw new Error(`${command} exited with ${result.status}\n${result.stderr?.slice(-2000)}`);
	}
	return result;
}

/** 16-bit PCM samples from a WAV file (any chunk layout), for the pause analysis. */
export function readWav(path: string): { rate: number; samples: Int16Array } {
	const buffer = readFileSync(path);
	const rate = buffer.readUInt32LE(24);
	let offset = 12;
	while (offset < buffer.length - 8) {
		const id = buffer.toString('ascii', offset, offset + 4);
		const size = buffer.readUInt32LE(offset + 4);
		if (id === 'data') {
			const end = Math.min(buffer.length, offset + 8 + size);
			const bytes = buffer.buffer.slice(buffer.byteOffset + offset + 8, buffer.byteOffset + end);
			return { rate, samples: new Int16Array(bytes, 0, Math.floor(bytes.byteLength / 2)) };
		}
		offset += 8 + size + (size % 2);
	}
	throw new Error(`No data chunk in ${path}`);
}

/** 16 kHz mono PCM, as whisper.cpp reads it. */
export function toWhisperWav(input: string, wav: string) {
	run(FFMPEG, [
		...['-hide_banner', '-loglevel', 'error', '-y', '-i', input],
		...['-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]
	]);
}

/** AAC .m4a, mono, 64 kbps, loudness-normalised to −18 LUFS in two passes (§7.2 step 1). */
export function transcodeForPlayback(input: string, m4a: string) {
	// Pass 1 measures loudness; pass 2 applies it linearly (no pumping).
	const probe = spawnSync(
		FFMPEG,
		[
			'-hide_banner',
			'-i',
			input,
			'-af',
			`loudnorm=${LOUDNESS}:print_format=json`,
			'-f',
			'null',
			'-'
		],
		{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
	);
	if (probe.error) throw new Error(`ffmpeg not found (set FFMPEG): ${probe.error.message}`);
	const m = JSON.parse(
		probe.stderr.slice(probe.stderr.lastIndexOf('{'), probe.stderr.lastIndexOf('}') + 1)
	) as Record<string, string>;
	const filter =
		`loudnorm=${LOUDNESS}:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
		`:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
	run(FFMPEG, [
		...['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map_metadata', '-1', '-vn'],
		...['-af', filter, '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '64k'],
		...['-movflags', '+faststart', m4a]
	]);
}

/** A compact transcript, committed or cached so whisper only runs once per recording. */
export interface Transcript {
	model: string;
	durationMs: number;
	threads: number;
	wallMs: number;
	cpuMs: number | null;
	/** [text, dtwStartMs, dtwEndMs, tokenStartMs, tokenEndMs, confidence × 1000] */
	words: [string, number, number, number, number, number][];
}

/**
 * Runs whisper.cpp with DTW token timestamps on a 16 kHz WAV and returns the compact
 * transcript. `-ojf`: JSON with every token; `--dtw`: token onsets from the alignment heads;
 * `-nfa`: DTW needs flash attention off in whisper.cpp 1.9.
 */
export function whisper(options: {
	model: string;
	wav: string;
	outBase: string;
	durationMs: number;
	threads: number;
	lang: string;
	extra?: Record<string, unknown>;
}): Transcript {
	const { model, wav, outBase, durationMs, threads } = options;
	const flags = ['-l', options.lang, '-t', String(threads), '-ojf', '-np', '-nfa', '--dtw', model];
	console.log(`  whisper ${model} (${threads} threads)…`);
	const started = performance.now();
	run(WHISPER_CLI, ['-m', join(MODELS, `ggml-${model}.bin`), '-f', wav, '-of', outBase, ...flags]);
	const wallMs = Math.round(performance.now() - started);
	const raw = JSON.parse(readFileSync(`${outBase}.json`, 'utf8'));
	const dtw = wordsFromWhisper(raw, 'dtw');
	const token = wordsFromWhisper(raw, 'token');
	return {
		model,
		whisper: 'whisper.cpp 1.9.4 (whisper-blas-bin-x64, CPU + OpenBLAS)',
		flags,
		...options.extra,
		durationMs,
		threads,
		wallMs,
		cpuMs: null,
		words: dtw.map((w, i) => [
			w.text,
			w.startMs,
			w.endMs,
			token[i]!.startMs,
			token[i]!.endMs,
			Math.round(w.confidence * 1000)
		])
	} as Transcript;
}

export const transcriptWords = (t: Transcript, timing: 'dtw' | 'token') =>
	t.words.map(([text, ds, de, ts, te, c]) => ({
		text,
		startMs: timing === 'dtw' ? ds : ts,
		endMs: timing === 'dtw' ? de : te,
		confidence: c / 1000
	}));

export const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;
