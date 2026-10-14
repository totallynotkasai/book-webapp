import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ingestEpub } from './ingest';
import { makeEpub } from './test/epub';

// DESIGN.md §12.3 (P1-QA-01): a 150 000-word EPUB imports in under 10 s in the browser on a
// mid-range phone, with progress shown and the UI responsive. The E2E import spec checks the
// whole import in Chromium and WebKit; docs/perf/p1-qa-01.md has it at phone speed (4× CPU
// throttling). This is a quick guard on the pipeline itself in Node, which takes well under a
// second for this book (165 ms on the owner's PC): a quarter of the phone budget leaves room
// for slower CI machines while still catching a pipeline that has become several times slower.
const NODE_BUDGET_MS = 10_000 / 4;
const WORDS = 150_000;

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** About 150 000 words: Alice's twelve chapters, again and again, each copy a new file. */
function bigEpub(): Uint8Array {
	const alice = unzipSync(
		new Uint8Array(readFileSync(join(root, 'apps/web/static/books/alice.epub')))
	);
	const bodies = Object.keys(alice)
		.filter((name) => /11-h-(\d+)\.htm\.xhtml$/.test(name) && !name.includes('11-h-0.'))
		.map((name) => strFromU8(alice[name]!).replace(/<link[^>]*>/g, ''));
	const chapters: Record<string, string> = {};
	for (let copy = 0; copy < 6; copy++) {
		bodies.forEach((body, i) => (chapters[`copy${copy}-ch${i + 1}.xhtml`] = body));
	}
	return makeEpub({ title: 'Alice, six times', chapters });
}

describe('import budget (DESIGN.md §12.3)', () => {
	it(`imports a ${WORDS.toLocaleString('en')}-word EPUB within ${NODE_BUDGET_MS} ms in Node`, async () => {
		const bytes = bigEpub();
		// One run to warm the JIT, as a phone that has opened the app has; the second is timed.
		await ingestEpub(bytes, { bookId: 'book-budget' });
		const started = performance.now();
		const result = await ingestEpub(bytes, { bookId: 'book-budget' });
		const elapsed = performance.now() - started;
		console.log(
			`Imported ${result.report.wordCount} words in ${Math.round(elapsed)} ms (budget ${NODE_BUDGET_MS} ms)`
		);
		expect(result.report.wordCount).toBeGreaterThanOrEqual(WORDS);
		expect(elapsed).toBeLessThan(NODE_BUDGET_MS);
	}, 60_000);
});
