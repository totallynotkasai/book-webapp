// SPIKE (P0-06): dumps the word index ([wordId, text] per Word) for Alice chapters 1–3, exactly as
// the reader-engine spike assigns WordIds: it runs `openPublication(…, { marking: 'spans' })` from
// @book/reader-core/spike in Chromium, through the /spike/narration page of a built app, rather
// than re-implementing the tokeniser (Intl.Segmenter) in Node.
//
// Usage: node tools/align-spike/word-index.mjs [--no-build] [--browser chromium|webkit]
// Writes fixtures/sync/alice-word-index.json (or prints a comparison for --browser webkit).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'fixtures', 'sync', 'alice-word-index.json');
const PORT = 4190;
const args = process.argv.slice(2);
const browserName = args.includes('--browser') ? args[args.indexOf('--browser') + 1] : 'chromium';

if (!args.includes('--no-build') || !existsSync(join(ROOT, 'apps/web/build/index.html'))) {
	console.log('Building the web app…');
	const build = spawnSync('npm run build', { cwd: ROOT, stdio: 'inherit', shell: true });
	if (build.status !== 0) process.exit(build.status ?? 1);
}

const server = spawn(process.execPath, ['scripts/serve.mjs', 'build', String(PORT)], {
	cwd: join(ROOT, 'apps/web'),
	stdio: ['ignore', 'pipe', 'inherit']
});
await new Promise((resolve) => server.stdout.once('data', resolve));

const browser = await (browserName === 'webkit' ? webkit : chromium).launch();
try {
	const page = await browser.newPage();
	page.on('pageerror', (error) => console.error('Page error:', error.message));
	await page.goto(`http://127.0.0.1:${PORT}/spike/narration`);
	// The hook exists as soon as the page's script runs; it opens its own copy of the EPUB.
	await page.waitForFunction(() => globalThis.__narrationSpike !== undefined, null, {
		timeout: 60_000
	});
	const chapters = await page.evaluate(() => globalThis.__narrationSpike.wordIndex([1, 2, 3]));
	const index = {
		source: 'apps/web/static/books/alice.epub (Project Gutenberg #11)',
		generatedBy: 'tools/align-spike/word-index.mjs',
		browser: `${browserName} ${browser.version()}`,
		note: "WordIds as @book/reader-core/spike openPublication(buffer, { marking: 'spans' }) assigns them (book-wide, spine order). SPIKE: replaced by text-pipeline's word index (P1-ING-01).",
		chapters
	};
	if (browserName === 'chromium') {
		mkdirSync(dirname(OUT), { recursive: true });
		writeFileSync(OUT, `${JSON.stringify(index)}\n`);
		for (const c of chapters)
			console.log(
				`Chapter ${c.chapter}: ${c.words.length} Words, ${c.firstWordId}–${c.lastWordId} (${c.title})`
			);
		console.log(`Wrote ${OUT}`);
	} else {
		const reference = JSON.parse(readFileSync(OUT, 'utf8'));
		for (const c of chapters) {
			const ref = reference.chapters.find((r) => r.chapter === c.chapter);
			const same = JSON.stringify(ref.words) === JSON.stringify(c.words);
			console.log(
				`Chapter ${c.chapter} in ${browserName}: ${c.words.length} Words, ${c.firstWordId}–${c.lastWordId}; ${same ? 'identical to' : 'DIFFERENT from'} the Chromium index`
			);
		}
	}
} finally {
	await browser.close();
	server.kill();
}
