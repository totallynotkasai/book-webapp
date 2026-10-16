import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textStart } from '@book/domain';
import { ingestEpub } from '@book/text-pipeline';
import { describe, expect, it } from 'vitest';

// P1-RDR-09: every Book the PoC ships opens at its first chapter, not its front matter. Also
// with the landmarks taken out, as on a device that processed the seeded Books before ingest
// recorded them: there the table-of-contents heuristic (D-034) must find the same place.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const BOOKS: [file: string, chapterId: string, title: RegExp, withLandmarks: string][] = [
	[
		'apps/web/static/books/alice.epub',
		'8761230412384829988_11-h-1.htm.xhtml',
		/^CHAPTER I\. Down the Rabbit-Hole$/,
		'chapter-heading'
	],
	[
		'fixtures/epub/alice-rackham-gutenberg.epub',
		'8484294708279843731_28885-h-1.htm.xhtml',
		/^$/,
		'after-contents'
	],
	[
		'apps/web/static/demo/books/treasure-island.epub',
		'text/part-1.xhtml',
		/^Part I: The Old Buccaneer$/,
		'bodymatter'
	],
	['apps/web/static/demo/books/the-time-machine.epub', 'text/chapter-1.xhtml', /^I$/, 'bodymatter'],
	[
		'apps/web/static/demo/books/the-wonderful-wizard-of-oz.epub',
		'text/chapter-1.xhtml',
		/^I: The Cyclone$/,
		'bodymatter'
	],
	[
		'apps/web/static/demo/books/the-princess-and-the-goblin.epub',
		'text/chapter-1.xhtml',
		/^I: Why the Princess/,
		'bodymatter'
	],
	[
		'apps/web/static/demo/books/the-lamplighters-ledger.epub',
		'text/chapter-1.xhtml',
		/^1\. Dusk Shift$/,
		'bodymatter'
	],
	['fixtures/epub/status-window.epub', 'text/chapter-1.xhtml', /^1\. Status$/, 'bodymatter']
];

describe.each(BOOKS)('%s', (file, chapterId, title, withLandmarks) => {
	const manifest = ingestEpub(new Uint8Array(readFileSync(join(root, file))), {
		bookId: 'book'
	}).then((r) => r.manifest);

	it(`starts at its first chapter (${withLandmarks})`, async () => {
		const m = await manifest;
		const start = textStart(m)!;
		const chapter = m.chapters.find((c) => c.chapterId === start.chapterId)!;
		expect(start).toEqual({ chapterId, ordinal: chapter.firstOrdinal, source: withLandmarks });
		expect(chapter.title).toMatch(title);
	});

	it('starts there from its table of contents alone', async () => {
		const start = textStart({ ...(await manifest), landmarks: undefined })!;
		expect(start.chapterId).toBe(chapterId);
		expect(start.source).not.toMatch(/bodymatter|guide|first-chapter/);
	});
});
