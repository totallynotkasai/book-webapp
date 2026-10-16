import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	revisionManifestSchema,
	wordIndexSchema,
	type RevisionManifest,
	type WordIndex
} from '@book/core';
import { describe, expect, it } from 'vitest';
import { blockHash, markChapter, sha256Hex } from './chapter';
import { byLocalName, parseMarkup } from './dom';
import { IngestError } from './errors';
import { ingestEpub, type IngestResult } from './ingest';
import { makeEpub } from './test/epub';
import { tokenise } from './tokenise';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

/** Every fixture EPUB (§12.2). The Standard Ebooks Alice is downloaded, so it may be missing. */
const FIXTURES = [
	['alice', 'apps/web/static/books/alice.epub'],
	['status-window', 'fixtures/epub/status-window.epub'],
	['alice-rackham', 'fixtures/epub/alice-rackham-gutenberg.epub'],
	['alice-standard-ebooks', 'fixtures/epub/alice-standard-ebooks.epub'],
	['lamplighters-ledger', 'apps/web/static/demo/books/the-lamplighters-ledger.epub'],
	['princess-and-the-goblin', 'apps/web/static/demo/books/the-princess-and-the-goblin.epub'],
	['time-machine', 'apps/web/static/demo/books/the-time-machine.epub'],
	['wonderful-wizard-of-oz', 'apps/web/static/demo/books/the-wonderful-wizard-of-oz.epub'],
	['treasure-island', 'apps/web/static/demo/books/treasure-island.epub']
] as const;

const available = FIXTURES.filter(([, path]) => existsSync(join(root, path)));
const load = (path: string) => new Uint8Array(readFileSync(join(root, path)));
const text = (result: IngestResult, path: string) =>
	new TextDecoder().decode(result.files.find((f) => f.path === path)!.data);
const json = <T>(result: IngestResult, path: string) => JSON.parse(text(result, path)) as T;

const results = new Map<string, Promise<IngestResult>>();
function ingestFixture(name: string, path: string) {
	let result = results.get(name);
	if (!result) {
		result = ingestEpub(load(path), { bookId: `book-${name}` });
		results.set(name, result);
	}
	return result;
}

describe.each(available)('fixture %s', (name, path) => {
	it('ingests into a valid manifest and word indexes', async () => {
		const result = await ingestFixture(name, path);
		const manifest = revisionManifestSchema.parse(json(result, 'manifest.json'));
		expect(manifest.wordCount).toBeGreaterThan(100);
		expect(manifest.toc.length).toBeGreaterThan(0);
		let ordinal = 0;
		for (const chapter of manifest.chapters) {
			const index = wordIndexSchema.parse(
				json(result, `index/${chapter.chapterId}.words.json`)
			) as WordIndex;
			expect(index.firstOrdinal).toBe(ordinal);
			expect(index.words.length).toBe(chapter.wordCount);
			ordinal += chapter.wordCount;
		}
		expect(ordinal).toBe(manifest.wordCount);
		// WordIds are sequential from 1 in a first Revision (§6.2).
		expect(manifest.nextWordId).toBe(manifest.wordCount + 1);
	});

	it('produces byte-identical output on every run', async () => {
		const first = await ingestFixture(name, path);
		const second = await ingestEpub(load(path), { bookId: `book-${name}` });
		expect(second.files.map((f) => f.path)).toEqual(first.files.map((f) => f.path));
		for (const [i, file] of second.files.entries()) {
			expect(Buffer.from(file.data).equals(Buffer.from(first.files[i]!.data)), file.path).toBe(
				true
			);
		}
	});

	it('writes offsets that point at the Words in the re-parsed chapter', async () => {
		const result = await ingestFixture(name, path);
		const manifest = json<RevisionManifest>(result, 'manifest.json');
		for (const chapter of manifest.chapters) {
			const index = json<WordIndex>(result, `index/${chapter.chapterId}.words.json`);
			// Re-parse what we wrote and mark it again: same Blocks, same Words, same hashes.
			const doc = parseMarkup(text(result, `content/${chapter.href}`));
			const body = byLocalName(doc, 'body')[0]!;
			const again = markChapter(body, chapter.firstWordId ?? 1);
			expect(again.words).toEqual(index.words);
			for (const block of index.blocks) {
				expect(block.len).toBe(again.blockTexts[block.b]!.length);
				expect(block.sha).toBe(await blockHash(again.blockTexts[block.b]!));
			}
			for (const [, b, start, end] of index.words) {
				const own = again.blockTexts[b]!;
				expect(tokenise(own.slice(start, end))).toEqual([{ start: 0, end: end - start }]);
			}
		}
	});

	it('removes scripts and anything that loads from outside the book', async () => {
		const result = await ingestFixture(name, path);
		for (const file of result.files.filter((f) => f.mediaType === 'application/xhtml+xml')) {
			const xhtml = new TextDecoder().decode(file.data);
			expect(xhtml).not.toMatch(/<script|javascript:|\son[a-z]+=|<iframe|<object|<embed/i);
			// Links to websites may stay (the reader opens them outside); nothing may load from one.
			expect(xhtml).not.toMatch(/\ssrc="(https?:)?\/\//i);
			expect(xhtml).not.toMatch(/<link[^>]+href="(https?:)?\/\//i);
		}
	});

	it('matches its golden digest', async () => {
		const result = await ingestFixture(name, path);
		const manifest = json<RevisionManifest>(result, 'manifest.json');
		const digest = {
			revisionId: result.revisionId,
			title: manifest.title,
			wordCount: manifest.wordCount,
			chapters: manifest.chapters.length,
			toc: manifest.toc.length,
			report: result.report,
			files: Object.fromEntries(
				await Promise.all(result.files.map(async (f) => [f.path, await sha256Hex(f.data)] as const))
			)
		};
		await expect(`${JSON.stringify(digest, null, '\t')}\n`).toMatchFileSnapshot(
			`../golden/${name}.digest.json`
		);
	});
});

describe('golden files: status-window fixture (§12.1)', () => {
	it('matches the committed XHTML, word indexes and manifest', async () => {
		const result = await ingestFixture('status-window', 'fixtures/epub/status-window.epub');
		for (const file of result.files.filter((f) => !f.mediaType.startsWith('image/'))) {
			await expect(new TextDecoder().decode(file.data)).toMatchFileSnapshot(
				`../golden/status-window/${file.path}`
			);
		}
	});
});

describe('sanitising (§7.1 step 2, Invariant 10)', () => {
	it('strips scripts, handlers, frames, forms, external loads and javascript: links', async () => {
		const epub = makeEpub({
			chapters: {
				'ch1.xhtml': `<script>alert(1)</script>
					<p onclick="steal()">Hello <a href="javascript:alert(2)">there</a>
					<a href="https://example.com/">site</a> <a href="ch2.xhtml#x">next</a></p>
					<iframe src="https://evil.example"></iframe><form><input value="x"/>Kept text</form>
					<img src="https://tracker.example/p.gif" alt="t"/><img src="pic.png"/><video src="v.mp4"></video>
					<p style="position:fixed;color:#123">Styled</p>`,
				'ch2.xhtml': '<p id="x">Second chapter</p>'
			},
			extra: {
				'OEBPS/pic.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
			},
			opfManifest: '<item id="pic" href="pic.png" media-type="image/png"/>'
		});
		const result = await ingestEpub(epub);
		const xhtml = text(result, 'content/ch1.xhtml');
		expect(xhtml).not.toMatch(/script|onclick|javascript:|iframe|<form|<input|tracker|<video/);
		expect(xhtml).toContain('Kept text');
		expect(xhtml).toContain('<a href="https://example.com/">site</a>');
		expect(xhtml).toContain('<a href="ch2.xhtml#x">next</a>');
		expect(xhtml).toContain('src="../res/pic.png"');
		expect(xhtml).toContain('style="color:var(--book-text, #123)"');
		const codes = result.report.warnings.map((w) => w.code);
		expect(codes).toEqual(
			expect.arrayContaining([
				'script_removed',
				'unsafe_attribute_removed',
				'unsafe_element_removed',
				'external_resource_removed',
				'missing_alt',
				'unsupported_media_removed',
				'css_removed'
			])
		);
		const alt = result.report.warnings.find((w) => w.code === 'missing_alt')!;
		expect(alt.message).toBe('1 image has no alt text, so screen readers can’t describe it.');
		expect(alt.chapterIds).toEqual(['ch1.xhtml']);
	});

	it('writes well-formed XHTML from sloppy HTML', async () => {
		const epub = makeEpub({
			chapters: {
				'ch1.xhtml': `<html><body><P>Un&nbsp;closed <br> &amp; <B>bold</p><p>A &lt;tag&gt; and a line\r\nbreak</body></html>`
			}
		});
		const xhtml = text(await ingestEpub(epub), 'content/ch1.xhtml');
		expect(xhtml).toContain('<p data-b="1">Un closed <br/> &amp; <b>bold</b></p>');
		expect(xhtml).toContain('A &lt;tag&gt; and a line\nbreak');
		expect(
			xhtml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns=')
		).toBe(true);
	});
});

describe('Blocks, Words and the TOC (§7.1 steps 3–6)', () => {
	it('marks Blocks in reading order, counts nested Blocks’ text separately, resolves fragments', async () => {
		const epub = makeEpub({
			chapters: {
				'one.xhtml': '<h1>Down the Rabbit-Hole</h1><div>Intro <p>Inner para</p> tail</div>',
				'two.xhtml': '<p>First</p><h2 id="later">Later section</h2><p>End</p>'
			},
			nav: `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a><ol><li><a href="two.xhtml#later">Later</a></li></ol></li></ol></nav></body></html>`
		});
		const result = await ingestEpub(epub);
		const manifest = json<RevisionManifest>(result, 'manifest.json');
		expect(
			manifest.chapters.map((c) => [c.title, c.firstWordId, c.lastWordId, c.firstOrdinal])
		).toEqual([
			['One', 1, 8, 0],
			['Two', 9, 12, 8]
		]);
		const one = json<WordIndex>(result, 'index/one.xhtml.words.json');
		// body 0, h1 1, div 2, p 3. "tail" is the div's own text after the nested paragraph.
		expect(one.words).toEqual([
			[1, 1, 0, 4],
			[2, 1, 5, 8],
			[3, 1, 9, 15],
			[4, 1, 16, 20],
			[5, 2, 0, 5],
			[6, 3, 0, 5],
			[7, 3, 6, 10],
			[8, 2, 7, 11]
		]);
		expect(manifest.toc).toEqual([
			{ label: 'One', chapterId: 'one.xhtml', fragment: null, ordinal: 0, depth: 0 },
			{ label: 'Two', chapterId: 'two.xhtml', fragment: null, ordinal: 8, depth: 0 },
			{ label: 'Later', chapterId: 'two.xhtml', fragment: 'later', ordinal: 9, depth: 1 }
		]);
	});

	it('continues WordIds from the Book’s counter for a later Revision', async () => {
		const result = await ingestEpub(makeEpub({ chapters: { 'a.xhtml': '<p>Two words</p>' } }), {
			firstWordId: 500
		});
		expect(json<RevisionManifest>(result, 'manifest.json').chapters[0]).toMatchObject({
			firstWordId: 500,
			lastWordId: 501
		});
	});

	it('makes a TOC from chapters when the book has none', async () => {
		const result = await ingestEpub(
			makeEpub({ chapters: { 'a.xhtml': '<h1>Alpha</h1><p>x</p>' }, nav: null })
		);
		const manifest = json<RevisionManifest>(result, 'manifest.json');
		expect(manifest.toc).toEqual([
			{ label: 'Alpha', chapterId: 'a.xhtml', fragment: null, ordinal: 0, depth: 0 }
		]);
		expect(result.report.warnings.map((w) => w.code)).toContain('no_toc');
	});

	describe('landmarks: where the text starts (P1-RDR-09)', () => {
		const chapters = {
			'front.xhtml': '<h1>Contents</h1><p>One</p>',
			'one.xhtml': '<p>Before</p><h1 id="start">Chapter One</h1><p>It began</p>'
		};
		const nav = (landmarks: string) =>
			`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="front.xhtml">Contents</a></li><li><a href="one.xhtml">One</a></li></ol></nav>${landmarks}</body></html>`;
		const landmarksOf = async (options: { nav?: string; guide?: string }) =>
			json<RevisionManifest>(await ingestEpub(makeEpub({ chapters, ...options })), 'manifest.json')
				.landmarks;

		it('records the EPUB 3 bodymatter landmark, resolved to its first Word', async () => {
			expect(
				await landmarksOf({
					nav: nav(
						'<nav epub:type="landmarks"><ol><li><a epub:type="toc" href="front.xhtml">Contents</a></li><li><a epub:type="bodymatter chapter" href="one.xhtml#start">Start</a></li></ol></nav>'
					)
				})
			).toEqual([{ type: 'bodymatter', chapterId: 'one.xhtml', fragment: 'start', ordinal: 3 }]);
		});

		it('records the EPUB 2 guide’s text reference, after any bodymatter landmark', async () => {
			const guide =
				'<guide><reference type="toc" href="front.xhtml"/><reference type="Text" title="Start" href="one.xhtml"/></guide>';
			expect(await landmarksOf({ guide })).toEqual([
				{ type: 'text', chapterId: 'one.xhtml', fragment: null, ordinal: 2 }
			]);
			expect(
				await landmarksOf({
					guide,
					nav: nav(
						'<nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="one.xhtml#start">Start</a></li></ol></nav>'
					)
				})
			).toEqual([
				{ type: 'bodymatter', chapterId: 'one.xhtml', fragment: 'start', ordinal: 3 },
				{ type: 'text', chapterId: 'one.xhtml', fragment: null, ordinal: 2 }
			]);
		});

		it('leaves them out when the EPUB names none, so its Revision is unchanged', async () => {
			expect(await landmarksOf({})).toBeUndefined();
			// Project Gutenberg marks its page list as landmarks, with no bodymatter in it.
			expect(
				await landmarksOf({
					nav: nav(
						'<nav epub:type="landmarks" aria-label="Page List"><ol><li><a epub:type="frontmatter" href="front.xhtml">[iv]</a></li><li><a epub:type="normal" href="one.xhtml">[1]</a></li></ol></nav>'
					),
					guide: '<guide><reference type="title-page" href="front.xhtml"/></guide>'
				})
			).toBeUndefined();
		});

		it('ignores landmarks that point outside the Book’s chapters', async () => {
			expect(
				await landmarksOf({
					nav: nav(
						'<nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="missing.xhtml">Start</a></li><li><a epub:type="bodymatter" href="https://example.com/">Web</a></li></ol></nav>'
					)
				})
			).toBeUndefined();
		});
	});

	it('uses dc:identifier as the Book ID, or asks for one', async () => {
		const withId = await ingestEpub(
			makeEpub({ identifier: 'urn:isbn:123', chapters: { 'a.xhtml': '<p>x</p>' } })
		);
		expect(withId.bookId).toBe('urn:isbn:123');
		const without = await ingestEpub(
			makeEpub({ identifier: null, chapters: { 'a.xhtml': '<p>x</p>' } }),
			{
				newBookId: () => 'generated'
			}
		);
		expect(without.bookId).toBe('generated');
	});
});

describe('readable failures (§7.1 step 1)', () => {
	const failure = async (bytes: Uint8Array) => {
		const error = await ingestEpub(bytes).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(IngestError);
		return error as IngestError;
	};

	it('says when a file is not a ZIP at all', async () => {
		const error = await failure(new TextEncoder().encode('just some text, not an EPUB'));
		expect(error.code).toBe('not_a_zip');
		expect(error.message).toMatch(/isn’t an EPUB/);
	});

	it('says when a ZIP is not an EPUB, or has no text', async () => {
		const { zipSync, strToU8 } = await import('fflate');
		expect((await failure(zipSync({ 'readme.txt': strToU8('hi') }))).code).toBe('not_an_epub');
		expect((await failure(makeEpub({ chapters: { 'a.xhtml': '<p>   </p>' } }))).code).toBe(
			'no_readable_chapters'
		);
	});

	it('refuses DRM-protected EPUBs but accepts obfuscated fonts', async () => {
		const drm = makeEpub({
			chapters: { 'a.xhtml': '<p>x</p>' },
			encryption:
				'<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>'
		});
		expect((await failure(drm)).code).toBe('encrypted');
		const fonts = makeEpub({
			chapters: { 'a.xhtml': '<p>x</p>' },
			encryption:
				'<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>'
		});
		await expect(ingestEpub(fonts)).resolves.toBeTruthy();
	});

	it('refuses files over the size limit', async () => {
		expect((await failure(new Uint8Array(11))).code).toBe('not_a_zip');
		const error = await ingestEpub(new Uint8Array(11), { maxBytes: 10 }).catch(
			(e: IngestError) => e
		);
		expect((error as IngestError).code).toBe('too_large');
	});
});
