// Downloads fixture files too large to commit (P0-11) into fixtures/epub/. Run
// `npm run fixtures:download` (which also fetches the narration audio). Each file is checked
// against the SHA-256 recorded here; files already present and correct are skipped.
//
// The Standard Ebooks Alice is the well-formed EPUB 3 reference (DESIGN.md §12.2). It is 18 MB
// because it carries Tenniel's illustrations at 1x and 2x. Standard Ebooks: CC0 1.0.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'epub');

const FILES = [
	{
		name: 'alice-standard-ebooks.epub',
		url: 'https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel/downloads/lewis-carroll_alices-adventures-in-wonderland_john-tenniel.epub?source=download',
		sha256: '8f957fd0c7fabc290f8a423ea2f9a2d2215291514f5f9959d23cbb91f4bc0c7f'
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
	console.log(`fetching ${file.url}`);
	const response = await fetch(file.url, {
		headers: { 'user-agent': 'book-webapp-fixtures (download-fixtures.mjs)' }
	});
	if (!response.ok || !response.body) {
		console.error(`failed   ${file.name}: HTTP ${response.status}`);
		return false;
	}
	await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
	const actual = await sha256Of(partial);
	if (actual !== file.sha256) {
		await rm(partial, { force: true });
		console.error(
			`failed   ${file.name}: SHA-256 ${actual} does not match ${file.sha256}. ` +
				'Standard Ebooks may have published a new release; check it and update the hash.'
		);
		return false;
	}
	await rename(partial, target);
	console.log(`ok       ${file.name}`);
	return true;
}

await mkdir(OUT_DIR, { recursive: true });
let failures = 0;
for (const file of FILES) if (!(await download(file))) failures++;
if (failures > 0) process.exit(1);
