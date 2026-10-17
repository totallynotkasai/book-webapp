// A synthetic recording of the status-window fixture's two Chapters (P1-STU-07): the recording
// `tools/align` is checked against ("coverage ≥ 0.95 against a recording made for it").
// Windows only: it reads each Chapter's text aloud with an on-device Windows voice through
// System.Speech (no network) into fixtures/audio/status-window/chNN.wav, which is never
// committed (fixtures/audio/ is git-ignored). Its whisper.cpp transcripts are committed in
// fixtures/sync/status-window/, so tests need neither the voice nor whisper.
//
// Usage: node fixtures/scripts/speak-status-window.mjs [--voice "Microsoft Hazel Desktop"]
//   then: npm run narration -- --epub fixtures/epub/status-window.epub \
//           --audio fixtures/audio/status-window/ch01.wav --chapter 1 --out fixtures/sync/status-window
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = join(ROOT, 'fixtures/src/status-window/OEBPS/text');
const OUT = join(ROOT, 'fixtures/audio/status-window');
const voiceAt = process.argv.indexOf('--voice');
const VOICE = voiceAt >= 0 ? process.argv[voiceAt + 1] : 'Microsoft Hazel Desktop';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** What a narrator reads: the body's text, a line per block, without scripts or comments. */
function readable(xhtml) {
	const body = xhtml.slice(xhtml.indexOf('<body'), xhtml.lastIndexOf('</body>'));
	return body
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, '')
		.replace(/<\/(p|h[1-6]|li|tr|div|pre|figcaption|caption|section)>/gi, '\n')
		.replace(/<\/(td|th)>/gi, ', ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&(#x?[0-9a-f]+|\w+);/gi, (_, e) =>
			e[0] === '#'
				? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
				: (ENTITIES[e] ?? '')
		)
		.split('\n')
		.map((line) =>
			line
				.replace(/\s+/g, ' ')
				.replace(/(, )+$/, '')
				.trim()
		)
		.filter(Boolean)
		.join('\n');
}

mkdirSync(OUT, { recursive: true });
for (const n of [1, 2]) {
	const text = readable(readFileSync(join(SOURCE, `chapter-${n}.xhtml`), 'utf8'));
	const textFile = join(tmpdir(), `status-window-ch${n}.txt`);
	writeFileSync(textFile, text, 'utf8');
	const wav = join(OUT, `ch0${n}.wav`);
	// Paths and the voice go in as arguments, never into the script's text.
	const script = [
		'param($voice, $textFile, $wav)',
		'Add-Type -AssemblyName System.Speech',
		'$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
		'$s.SelectVoice($voice)',
		'$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
		'$s.SetOutputToWaveFile($wav, $format)',
		'$s.Speak([IO.File]::ReadAllText($textFile, [Text.Encoding]::UTF8))',
		'$s.Dispose()'
	].join('\n');
	const scriptFile = join(tmpdir(), 'speak-status-window.ps1');
	writeFileSync(scriptFile, script, 'utf8');
	const result = spawnSync(
		'powershell.exe',
		['-NoProfile', '-NonInteractive', '-File', scriptFile, VOICE, textFile, wav],
		{ encoding: 'utf8' }
	);
	if (result.status !== 0) throw new Error(result.stderr || `powershell exited ${result.status}`);
	console.log(`${wav} (${text.split(/\s+/).length} words read)`);
}
