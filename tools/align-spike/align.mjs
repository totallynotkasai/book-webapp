// SPIKE (P0-06): aligns the LibriVox Alice chapters to the text and writes Sync Maps
// (docs/DESIGN.md §7.2). Grows into tools/align in P1-LAY-03.
//
//   npm run fixtures:narration                    # transcode audio; align only if Sync Maps are missing
//   npm run fixtures:narration -- --force         # redo everything, whisper included
//   npm run fixtures:narration -- --realign       # re-align from the committed transcripts (no whisper)
//   options: --chapters 1,2  --models base.en,small.en  --model small.en  --threads 8
//
// Per chapter:
//   1. ffmpeg: MP3 → 16 kHz mono WAV for whisper, and → AAC .m4a, mono, 64 kbps, loudness-
//      normalised to −18 LUFS (two-pass loudnorm) for playback (apps/web/static/demo/audio/alice/).
//   2. whisper.cpp with DTW token timestamps, per model; compact transcripts are kept in
//      fixtures/sync/transcripts/ so alignment can be redone without whisper.
//   3. @book/alignment: align, interpolate, score, and remove DTW's start bias measured against
//      the pauses in the audio; the Sync Map from `--model` (default base.en) goes to
//      apps/web/static/demo/sync/alice/chNN.json; measurements to fixtures/sync/alice-report.json.
//
// Tools: FFMPEG (default `ffmpeg` on PATH), WHISPER_CLI (default ~/.book-tools/whisper-blas/
// Release/whisper-cli.exe, then `whisper-cli` on PATH), WHISPER_MODELS (folder holding
// ggml-<model>.bin; default ~/.book-tools/downloads). Run with Node's type stripping, as the npm
// script does: node --experimental-transform-types tools/align-spike/align.mjs
import './ts-resolve.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWav } from './wav.mjs';

const {
	alignChapter,
	findPauses,
	shiftStarts,
	startBias,
	timingAccuracy,
	toSyncMap,
	wordsFromWhisper
} = await import('@book/alignment');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUDIO_IN = join(ROOT, 'fixtures/audio/alice');
const WORK = join(AUDIO_IN, 'work');
const AUDIO_OUT = join(ROOT, 'apps/web/static/demo/audio/alice');
const SYNC_OUT = join(ROOT, 'apps/web/static/demo/sync/alice');
const TRANSCRIPTS = join(ROOT, 'fixtures/sync/transcripts');
const WORD_INDEX = join(ROOT, 'fixtures/sync/alice-word-index.json');
const REPORT = join(ROOT, 'fixtures/sync/alice-report.json');

// SIMULATION: placeholder identifiers. The spike has no Revisions or Audio Tracks yet; real IDs
// come from text-pipeline (P1-ING-01) and the Layer records (P1-LAY-03).
const TRACK_ID = 'track-alice-librivox-shallenberg';
const REVISION_ID = 'spike-gutenberg-11';
const chapterId = (n) => `alice-ch${pad(n)}`;
// SIMULATION: the demo serves audio from static/; Phase 3 uses tracks/{trackId}/audio/{chapterId}.m4a (§6.7).
const audioKey = (n) => `demo/audio/alice/ch${pad(n)}.m4a`;

const LOUDNESS = 'I=-18:TP=-1.5:LRA=11';
/** Never shift Words by more than this when removing whisper's start bias. */
const MAX_BIAS_MS = 300;

function pad(n) {
	return String(n).padStart(2, '0');
}

function option(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const force = flag('force');
const realign = flag('realign');
const chapters = option('chapters', '1,2').split(',').map(Number);
const models = option('models', 'base.en,small.en').split(',');
const primary = option('model', 'base.en');
const threads = Number(option('threads', '8'));
if (!models.includes(primary)) models.push(primary);

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const WHISPER_CLI =
	process.env.WHISPER_CLI ??
	[join(homedir(), '.book-tools/whisper-blas/Release/whisper-cli.exe')].find(existsSync) ??
	'whisper-cli';
const MODELS = process.env.WHISPER_MODELS ?? join(homedir(), '.book-tools/downloads');

function run(command, args, { quiet = true } = {}) {
	const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
	if (result.error) throw new Error(`${command}: ${result.error.message}`);
	if (result.status !== 0) {
		throw new Error(`${command} exited with ${result.status}\n${result.stderr?.slice(-2000)}`);
	}
	if (!quiet) process.stdout.write(result.stdout);
	return result;
}

/** Quotes one argument for a Windows command line (CommandLineToArgvW rules). */
function quoteWindows(arg) {
	if (arg && !/[\s"]/.test(arg)) return arg;
	return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

/**
 * Runs a program and measures its wall and CPU time. On Windows CPU time comes from the process
 * handle (.NET TotalProcessorTime, all threads); elsewhere only wall time is measured.
 */
function measured(exe, args) {
	if (process.platform !== 'win32') {
		const started = performance.now();
		run(exe, args);
		return { wallMs: Math.round(performance.now() - started), cpuMs: null };
	}
	const script = [
		'$psi = New-Object System.Diagnostics.ProcessStartInfo',
		'$psi.FileName = $env:ALIGN_EXE',
		'$psi.Arguments = $env:ALIGN_ARGS',
		'$psi.UseShellExecute = $false',
		'$psi.RedirectStandardOutput = $true',
		'$psi.RedirectStandardError = $true',
		'$sw = [System.Diagnostics.Stopwatch]::StartNew()',
		'$p = [System.Diagnostics.Process]::Start($psi)',
		'$out = $p.StandardOutput.ReadToEndAsync()',
		'$err = $p.StandardError.ReadToEndAsync()',
		'$p.WaitForExit()',
		'$sw.Stop()',
		'[Console]::Error.Write($err.Result)',
		"Write-Output ('MEASURED ' + $p.ExitCode + ' ' + [long]$sw.Elapsed.TotalMilliseconds + ' ' + [long]$p.TotalProcessorTime.TotalMilliseconds)"
	].join('; ');
	const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
		env: { ...process.env, ALIGN_EXE: exe, ALIGN_ARGS: args.map(quoteWindows).join(' ') }
	});
	const line = result.stdout.split(/\r?\n/).find((l) => l.startsWith('MEASURED '));
	if (!line) throw new Error(`Couldn't run ${exe}\n${result.stderr?.slice(-2000)}`);
	const [, exit, wallMs, cpuMs] = line.split(' ').map(Number);
	if (exit !== 0) throw new Error(`${exe} exited with ${exit}\n${result.stderr?.slice(-2000)}`);
	return { wallMs, cpuMs };
}

function wavDurationMs(path) {
	const { rate, samples } = readWav(path);
	return Math.round((samples.length / rate) * 1000);
}

function transcodeForPlayback(mp3, m4a) {
	// Pass 1 measures loudness; pass 2 applies it linearly (no pumping), §7.2 step 1.
	const probe = spawnSync(
		FFMPEG,
		['-hide_banner', '-i', mp3, '-af', `loudnorm=${LOUDNESS}:print_format=json`, '-f', 'null', '-'],
		{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
	);
	if (probe.error) throw new Error(`ffmpeg not found (set FFMPEG): ${probe.error.message}`);
	const json = probe.stderr.slice(probe.stderr.lastIndexOf('{'), probe.stderr.lastIndexOf('}') + 1);
	const m = JSON.parse(json);
	const filter =
		`loudnorm=${LOUDNESS}:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
		`:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
	run(FFMPEG, [
		'-hide_banner',
		'-loglevel',
		'error',
		'-y',
		'-i',
		mp3,
		'-map_metadata',
		'-1',
		'-vn',
		'-af',
		filter,
		'-ac',
		'1',
		'-ar',
		'44100',
		'-c:a',
		'aac',
		'-b:a',
		'64k',
		'-movflags',
		'+faststart',
		m4a
	]);
	return { inputLufs: Number(m.input_i), targetLufs: -18 };
}

/** whisper.cpp options (recorded with each transcript). */
function whisperFlags(model) {
	return [
		'-l',
		'en',
		'-t',
		String(threads),
		'-ojf', // JSON with every token: text, offsets, probability and t_dtw
		'-np',
		'-nfa', // DTW needs flash attention off in whisper.cpp 1.9
		'--dtw',
		model // token onsets by DTW over the model's alignment heads
	];
}

function transcribe(n, model, wav, durationMs) {
	const cache = join(TRANSCRIPTS, `alice-ch${pad(n)}.${model}.json`);
	if (existsSync(cache) && !force) return JSON.parse(readFileSync(cache, 'utf8'));
	if (realign) throw new Error(`--realign needs ${cache}; run with --force to transcribe`);
	const outBase = join(WORK, `ch${pad(n)}.${model}`);
	const flags = whisperFlags(model);
	const args = ['-m', join(MODELS, `ggml-${model}.bin`), '-f', wav, '-of', outBase, ...flags];
	console.log(`  whisper ${model} (${threads} threads)…`);
	const time = measured(WHISPER_CLI, args);
	const raw = JSON.parse(readFileSync(`${outBase}.json`, 'utf8'));
	const dtw = wordsFromWhisper(raw, 'dtw');
	const token = wordsFromWhisper(raw, 'token');
	const transcript = {
		model,
		whisper: 'whisper.cpp 1.9.4 (whisper-blas-bin-x64, CPU + OpenBLAS)',
		flags,
		chapter: n,
		durationMs,
		threads,
		wallMs: time.wallMs,
		cpuMs: time.cpuMs,
		// [text, dtwStartMs, dtwEndMs, tokenStartMs, tokenEndMs, confidence × 1000]
		words: dtw.map((w, i) => [
			w.text,
			w.startMs,
			w.endMs,
			token[i].startMs,
			token[i].endMs,
			Math.round(w.confidence * 1000)
		])
	};
	mkdirSync(TRANSCRIPTS, { recursive: true });
	writeFileSync(cache, `${JSON.stringify(transcript)}\n`);
	return transcript;
}

function transcriptWords(transcript, timing) {
	return transcript.words.map(([text, ds, de, ts, te, c]) => ({
		text,
		startMs: timing === 'dtw' ? ds : ts,
		endMs: timing === 'dtw' ? de : te,
		confidence: c / 1000
	}));
}

const round = (x, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

// ---------------------------------------------------------------------------------------------

mkdirSync(WORK, { recursive: true });
mkdirSync(AUDIO_OUT, { recursive: true });
mkdirSync(SYNC_OUT, { recursive: true });

const missingMp3 = chapters.some(
	(n) => !existsSync(join(AUDIO_IN, `alices_adventures_${pad(n)}_carroll_64kb.mp3`))
);
if (missingMp3) {
	console.log('Fetching the LibriVox MP3s (npm run fixtures:audio)…');
	run(process.execPath, [join(ROOT, 'fixtures/scripts/download-audio.mjs')], { quiet: false });
}

const wordIndex = JSON.parse(readFileSync(WORD_INDEX, 'utf8'));
const report = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : { chapters: {} };

for (const n of chapters) {
	console.log(`Chapter ${n}`);
	const mp3 = join(AUDIO_IN, `alices_adventures_${pad(n)}_carroll_64kb.mp3`);
	const m4a = join(AUDIO_OUT, `ch${pad(n)}.m4a`);
	const syncPath = join(SYNC_OUT, `ch${pad(n)}.json`);

	if (!existsSync(m4a) || force) {
		const loudness = transcodeForPlayback(mp3, m4a);
		console.log(
			`  ${m4a} (${Math.round(statSync(m4a).size / 1024)} KB, ${loudness.inputLufs} → −18 LUFS)`
		);
	} else console.log(`  audio present: ${m4a}`);

	if (existsSync(syncPath) && !force && !realign) {
		console.log(
			`  Sync Map present: ${syncPath} (skipping whisper; --force or --realign redoes it)`
		);
		continue;
	}

	const wav = join(WORK, `ch${pad(n)}.16k.wav`);
	if (!existsSync(wav) || force)
		run(FFMPEG, [
			'-hide_banner',
			'-loglevel',
			'error',
			'-y',
			'-i',
			mp3,
			'-ar',
			'16000',
			'-ac',
			'1',
			'-c:a',
			'pcm_s16le',
			wav
		]);
	const durationMs = wavDurationMs(wav);
	const pcm = readWav(wav);
	const pauses = findPauses(pcm.samples, pcm.rate);

	const section = wordIndex.chapters.find((c) => c.chapter === n);
	if (!section) throw new Error(`Chapter ${n} isn't in ${WORD_INDEX}`);
	const words = section.words.map(([wordId, text]) => ({ wordId, text }));

	const entry = { words: words.length, durationMs, pauses: pauses.length, models: {} };
	for (const model of models) {
		const transcript = transcribe(n, model, wav, durationMs);
		const perTiming = {};
		for (const timing of ['dtw', 'token']) {
			const started = performance.now();
			const alignment = alignChapter(words, transcriptWords(transcript, timing), { durationMs });
			const alignMs = Math.round(performance.now() - started);
			// whisper's DTW onsets run late by a near-constant amount (ADR-003): measure it against
			// the pauses in this chapter's audio and move every Word earlier by it.
			const bias = Math.min(MAX_BIAS_MS, Math.max(0, startBias(alignment.timings, pauses)));
			const calibrated = { ...alignment, timings: shiftStarts(alignment.timings, bias) };
			perTiming[timing] = {
				coverage: round(alignment.coverage),
				alignMs,
				stats: alignment.stats,
				accuracy: timingAccuracy(alignment.timings, pauses),
				startBiasMs: bias,
				accuracyCalibrated: timingAccuracy(calibrated.timings, pauses)
			};
			if (model === primary && timing === 'dtw') {
				const syncMap = toSyncMap(
					{
						trackId: TRACK_ID,
						revisionId: REVISION_ID,
						chapterId: chapterId(n),
						audioKey: audioKey(n),
						durationMs
					},
					calibrated
				);
				writeFileSync(syncPath, `${JSON.stringify(syncMap)}\n`);
				console.log(`  Sync Map (${model}, dtw, starts moved ${bias} ms earlier): ${syncPath}`);
			}
		}
		const audioHours = durationMs / 3_600_000;
		entry.models[model] = {
			transcriptWords: transcript.words.length,
			threads: transcript.threads,
			wallMs: transcript.wallMs,
			cpuMs: transcript.cpuMs,
			realtimeFactor: round(transcript.wallMs / durationMs, 3),
			cpuHoursPerAudioHour:
				transcript.cpuMs === null ? null : round(transcript.cpuMs / 3_600_000 / audioHours, 3),
			...perTiming
		};
		console.log(
			`  ${model}: coverage ${perTiming.dtw.coverage} (dtw) / ${perTiming.token.coverage} (token); ` +
				`whisper ${(transcript.wallMs / 1000).toFixed(1)} s wall, ` +
				`${transcript.cpuMs === null ? '?' : (transcript.cpuMs / 1000).toFixed(1)} s CPU for ` +
				`${(durationMs / 60000).toFixed(1)} min of audio; start error median ` +
				`${perTiming.dtw.accuracy.start.medianAbsMs} ms (dtw), ${perTiming.dtw.accuracyCalibrated.start.medianAbsMs} ms (dtw calibrated), ` +
				`${perTiming.token.accuracy.start.medianAbsMs} ms (token)`
		);
	}
	report.chapters[`ch${pad(n)}`] = entry;
}

report.generated = 'tools/align-spike/align.mjs';
report.primaryModel = primary;
report.cpu = 'Intel Core i5-13600KF (6P + 8E cores, 20 threads), Windows 11, no GPU';
writeFileSync(REPORT, `${JSON.stringify(report, null, '\t')}\n`);
console.log(`Report: ${REPORT}`);
