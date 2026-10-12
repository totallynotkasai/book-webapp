// Downloads the LibriVox narration fixture (DESIGN.md §12.2) into fixtures/audio/alice/.
// Large audio files are never committed (P0-11): run `npm run fixtures:audio` to fetch them.
//
// Recording: LibriVox "Alice's Adventures in Wonderland", read by Kara Shallenberg (solo),
// archive.org item `alices_adventures_1003`. Public domain (LibriVox dedication). Chapters 1-3,
// 64 kbps MP3. See fixtures/audio/README.md.
//
// Each file is checked against a SHA-256 recorded here. Files already present and correct are
// skipped; a wrong or partial file is downloaded again. Downloads run one at a time.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ITEM = 'alices_adventures_1003';
const BASE = `https://archive.org/download/${ITEM}`;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'audio', 'alice');

const FILES = [
	{
		name: 'alices_adventures_01_carroll_64kb.mp3',
		chapter: 1,
		bytes: 6371811,
		sha256: 'da919b104680c7184a3451ec2cdd65ad0b48ebc0b4eb2ec91620dd9b29e623c6'
	},
	{
		name: 'alices_adventures_02_carroll_64kb.mp3',
		chapter: 2,
		bytes: 6202326,
		sha256: 'bed4e9e4c376f909457f850c82d43c863f802ecb6283039d1c717d473dc9dad8'
	},
	{
		name: 'alices_adventures_03_carroll_64kb.mp3',
		chapter: 3,
		bytes: 5061100,
		sha256: 'd6406eaaa767e05987d05dd400cda59ce31e016d59777f723b674e343d4bcbd1'
	}
];

async function sha256Of(path) {
	try {
		return createHash('sha256')
			.update(await readFile(path))
			.digest('hex');
	} catch {
		return null;
	}
}

async function download(file) {
	const target = join(OUT_DIR, file.name);
	if ((await sha256Of(target)) === file.sha256) {
		console.log(`ok       ${file.name} (already present)`);
		return true;
	}
	const partial = `${target}.part`;
	const url = `${BASE}/${file.name}`;
	console.log(`fetching ${url}`);
	const response = await fetch(url, {
		headers: { 'user-agent': 'book-webapp-fixtures (download-audio.mjs)' }
	});
	if (!response.ok || !response.body) {
		console.error(`failed   ${file.name}: HTTP ${response.status}`);
		return false;
	}
	await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
	const actual = await sha256Of(partial);
	if (actual !== file.sha256) {
		await rm(partial, { force: true });
		console.error(`failed   ${file.name}: SHA-256 ${actual} does not match ${file.sha256}`);
		return false;
	}
	await rename(partial, target);
	console.log(`ok       ${file.name} (${file.bytes} bytes, chapter ${file.chapter})`);
	return true;
}

await mkdir(OUT_DIR, { recursive: true });
let failures = 0;
for (const file of FILES) {
	if (!(await download(file))) failures++;
}
if (failures > 0) {
	console.error(`${failures} file(s) failed. Run the script again to retry.`);
	process.exit(1);
}
console.log(`Narration fixture ready in ${OUT_DIR}`);
