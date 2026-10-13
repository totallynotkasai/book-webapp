import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';

// The demo narration's real audio is generated on the owner's PC and never committed, so E2E
// serves silence of each Chapter's real length instead (with byte ranges, as players ask).

const track = JSON.parse(
	readFileSync(new URL('../static/demo/sync/alice/track.json', import.meta.url), 'utf8')
) as { chapters: { audio: string; durationMs: number }[] };

/** 8-bit mono PCM at 4 kHz: about 4 KB a second of silence, as a WAV file. */
function silentWav(durationMs: number): Buffer {
	const rate = 4000;
	const samples = Math.ceil((durationMs / 1000) * rate);
	const wav = Buffer.alloc(44 + samples, 0x80);
	wav.write('RIFF', 0);
	wav.writeUInt32LE(36 + samples, 4);
	wav.write('WAVEfmt ', 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(rate, 24);
	wav.writeUInt32LE(rate, 28);
	wav.writeUInt16LE(1, 32);
	wav.writeUInt16LE(8, 34);
	wav.write('data', 36);
	wav.writeUInt32LE(samples, 40);
	return wav;
}

const wavs = new Map<string, Buffer>();

/** Serves each Chapter's audio as silence, with range requests, and counts the requests. */
export async function silentNarration(page: Page) {
	const requests: string[] = [];
	await page.route('**/demo/audio/alice/*.m4a', async (route: Route) => {
		const name = new URL(route.request().url()).pathname.split('/').pop()!;
		requests.push(name);
		const chapter = track.chapters.find((c) => c.audio.endsWith(name));
		if (!chapter) return route.fulfill({ status: 404 });
		let body = wavs.get(name);
		if (!body) wavs.set(name, (body = silentWav(chapter.durationMs)));
		const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] ?? '');
		const headers = { 'content-type': 'audio/wav', 'accept-ranges': 'bytes' };
		if (!range) return route.fulfill({ status: 200, headers, body });
		const start = Number(range[1]);
		const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
		return route.fulfill({
			status: 206,
			headers: { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}` },
			body: body.subarray(start, end + 1)
		});
	});
	return requests;
}
