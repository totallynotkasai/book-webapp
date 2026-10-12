// @vitest-environment jsdom
/**
 * P1-RDR-01 acceptance: Anchors round-trip through the engine's Locators (DOM Ranges) for every
 * fixture. Each fixture is ingested by text-pipeline, its chapters are parsed by jsdom's XML
 * parser (as the browser parses them from a blob URL), and every Word (sampled in big books) must
 * map Word → Range → Word and Anchor → Word exactly.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RevisionManifest, WordIndex } from '@book/core';
import { ChapterWords, DocWordMap } from '@book/reader-core';
import { ingestEpub, tokenise } from '@book/text-pipeline';
import { describe, expect, it } from 'vitest';

const FIXTURES = [
	['alice', 'apps/web/static/books/alice.epub'],
	['status-window', 'fixtures/epub/status-window.epub'],
	['alice-rackham', 'fixtures/epub/alice-rackham-gutenberg.epub'],
	['lamplighters-ledger', 'apps/web/static/demo/books/the-lamplighters-ledger.epub'],
	['princess-and-the-goblin', 'apps/web/static/demo/books/the-princess-and-the-goblin.epub'],
	['time-machine', 'apps/web/static/demo/books/the-time-machine.epub'],
	['wonderful-wizard-of-oz', 'apps/web/static/demo/books/the-wonderful-wizard-of-oz.epub'],
	['treasure-island', 'apps/web/static/demo/books/treasure-island.epub'],
	['alice-standard-ebooks', 'fixtures/epub/alice-standard-ebooks.epub']
] as const;

const root = join(__dirname, '..');
const available = FIXTURES.filter(([, path]) => existsSync(join(root, path)));

describe.each(available)('%s', (name, path) => {
	it('maps Words to Ranges and back, and Anchors to Words', async () => {
		const result = await ingestEpub(new Uint8Array(readFileSync(join(root, path))), {
			bookId: `book-${name}`
		});
		const file = (p: string) =>
			new TextDecoder().decode(result.files.find((f) => f.path === p)!.data);
		const manifest = JSON.parse(file('manifest.json')) as RevisionManifest;
		// Every Word in small books; a spread sample in large ones keeps the test quick.
		const step = manifest.wordCount > 20_000 ? 41 : 1;
		let checked = 0;
		for (const chapter of manifest.chapters) {
			if (chapter.wordCount === 0) continue;
			const index = JSON.parse(file(`index/${chapter.chapterId}.words.json`)) as WordIndex;
			const doc = new DOMParser().parseFromString(
				file(`content/${chapter.href}`),
				'application/xhtml+xml'
			);
			expect(doc.querySelector('parsererror'), chapter.chapterId).toBeNull();
			const map = new DocWordMap(doc, new ChapterWords(manifest, chapter, index));
			expect(map.mismatchedBlocks(), chapter.chapterId).toEqual([]);
			const sample = new Set<number>([0, index.words.length - 1]);
			for (let i = 0; i < index.words.length; i += step) sample.add(i);
			for (const i of sample) {
				const range = map.range(i)!;
				const text = range.toString();
				// The Range covers exactly one Word.
				expect(tokenise(text), `${chapter.chapterId} #${i} "${text}"`).toEqual([
					{ start: 0, end: text.length }
				]);
				expect(map.firstWordFrom(range.startContainer, range.startOffset)).toBe(i);
				expect(map.lastWordBefore(range.endContainer, range.endOffset)).toBe(i);
				expect(map.wordAt(range.startContainer, range.startOffset)).toBe(i);
				expect(map.snap(range)).toEqual([i, i]);
				const anchor = map.pointAnchor(i);
				expect(anchor.quote.exact).toBe(text);
				expect(map.words.indexOfOrdinal(anchor.ordinal)).toBe(i);
				expect(map.words.indexOfWordId(anchor.wordId)).toBe(i);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(50);
	}, 120_000);
});

describe('selections snap to whole Words (Invariant 5)', () => {
	it('widens a selection that starts and ends mid-Word', async () => {
		const result = await ingestEpub(
			new Uint8Array(readFileSync(join(root, 'fixtures/epub/status-window.epub'))),
			{ bookId: 'book-status' }
		);
		const file = (p: string) =>
			new TextDecoder().decode(result.files.find((f) => f.path === p)!.data);
		const manifest = JSON.parse(file('manifest.json')) as RevisionManifest;
		const chapter = manifest.chapters.find((c) => c.wordCount > 20)!;
		const index = JSON.parse(file(`index/${chapter.chapterId}.words.json`)) as WordIndex;
		const doc = new DOMParser().parseFromString(
			file(`content/${chapter.href}`),
			'application/xhtml+xml'
		);
		const map = new DocWordMap(doc, new ChapterWords(manifest, chapter, index));
		const a = map.range(3)!;
		const b = map.range(6)!;
		const selection = doc.createRange();
		selection.setStart(a.startContainer, a.startOffset + 1);
		selection.setEnd(b.endContainer, b.endOffset - 1);
		expect(map.snap(selection)).toEqual([3, 6]);
		const anchor = map.rangeAnchor(3, 6);
		expect(anchor.startOrdinal).toBe(chapter.firstOrdinal + 3);
		expect(anchor.endOrdinal).toBe(chapter.firstOrdinal + 6);
		expect(anchor.quote.exact.split(' ').length).toBeGreaterThanOrEqual(4);
		expect(anchor.quote.prefix.length).toBeLessThanOrEqual(32);
	});
});
