import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PointAnchor, RangeAnchor } from '@book/core';
import { describe, expect, it } from 'vitest';
import { ingestEpub, type IngestResult } from './ingest';
import { migrateAnchors, migrateProgress, RevisionIndex } from './migrate';
import { readRevisionWords, type RevisionWords } from './revision';
import { editEpub, makeEpub } from './test/epub';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function revisionOf(result: IngestResult): RevisionWords {
	const files = new Map(result.files.map((f) => [f.path, new TextDecoder().decode(f.data)]));
	return readRevisionWords((path) => files.get(path));
}

const P = {
	keep: 'The quick brown fox jumps over the lazy dog while the farmer sleeps in the barn.',
	edit: 'Alice was beginning to get very tired of sitting by her sister on the bank all day.',
	gone: 'This whole paragraph is going to be deleted in the second version of the book.',
	moving: 'A wandering paragraph that travels from the first chapter to the second one.',
	two: 'Chapter two has its own words and nothing much else happens here at all today.'
};

const v1 = () =>
	makeEpub({
		chapters: {
			'c1.xhtml': `<p>${P.keep}</p><p>${P.edit}</p><p>${P.gone}</p><p>${P.moving}</p>`,
			'c2.xhtml': `<p>${P.two}</p>`
		}
	});

const v2 = () =>
	makeEpub({
		chapters: {
			'c1.xhtml': `<p>${P.keep}</p><p>${P.edit.replace('very tired', 'quite tired')}</p>`,
			'c2.xhtml': `<p>${P.moving}</p><p>${P.two}</p>`,
			'c3.xhtml': '<p>A brand new chapter appended by the author this week.</p>'
		}
	});

/** A RangeAnchor over the Words of one paragraph's text, found by its first and last Word. */
function rangeOver(index: RevisionIndex, text: string, from = 0, count?: number): RangeAnchor {
	const words = text.split(' ').map((w) => w.replace(/[.,]/g, '').toLowerCase());
	for (let s = 0; s + words.length <= index.wordCount; s++) {
		if (words.every((w, k) => index.tokens[s + k] === w)) {
			const last = count === undefined ? s + words.length - 1 : s + from + count - 1;
			return index.rangeAnchor(s + from, last);
		}
	}
	throw new Error(`Text not found: ${text}`);
}

describe('WordId carry-forward (§6.2)', () => {
	it('keeps unchanged Words’ IDs, gives inserted ones new IDs and records deletions', async () => {
		const first = await ingestEpub(v1(), { bookId: 'b' });
		const previous = revisionOf(first);
		const second = await ingestEpub(v2(), { bookId: 'b', previous });
		const next = revisionOf(second);
		const before = new RevisionIndex(previous);
		const after = new RevisionIndex(next);

		// The untouched paragraph: identical WordIds.
		expect(rangeOver(after, P.keep).startWordId).toBe(rangeOver(before, P.keep).startWordId);
		expect(rangeOver(after, P.keep).endWordId).toBe(rangeOver(before, P.keep).endWordId);
		// Edited paragraph: the changed Word is new; its neighbours keep their IDs.
		const edited = P.edit.replace('very tired', 'quite tired');
		const oldEdit = rangeOver(before, P.edit);
		const newEdit = rangeOver(after, edited);
		expect(newEdit.startWordId).toBe(oldEdit.startWordId);
		expect(newEdit.endWordId).toBe(oldEdit.endWordId);
		expect(second.manifest.nextWordId).toBeGreaterThan(first.manifest.nextWordId);
		const quite = after.wordIdAt(newEdit.startOrdinal + 5);
		expect(quite).toBeGreaterThanOrEqual(first.manifest.nextWordId);
		// The deleted paragraph's WordIds are recorded, and none are reused.
		const gone = rangeOver(before, P.gone);
		expect(second.manifest.deletedWordIds).toContain(gone.startWordId);
		expect(second.manifest.previousRevisionId).toBe(first.revisionId);
		const all = next.chapters.flatMap((c) => c.wordIds);
		expect(new Set(all).size).toBe(all.length);
	});

	it('carries a renamed Chapter’s Words over by its content (the whole-Book fallback)', async () => {
		const first = await ingestEpub(
			makeEpub({ chapters: { 'old-name.xhtml': `<p>${P.keep} ${P.two}</p>` } }),
			{ bookId: 'b' }
		);
		const second = await ingestEpub(
			makeEpub({ chapters: { 'new-name.xhtml': `<p>${P.keep} ${P.two} One more line.</p>` } }),
			{ bookId: 'b', previous: revisionOf(first) }
		);
		const before = revisionOf(first).chapters[0]!.wordIds;
		const after = revisionOf(second).chapters[0]!.wordIds;
		expect(after.slice(0, before.length)).toEqual(before);
	});

	it('changes nothing for a Book’s first Revision (golden files stay valid)', async () => {
		const result = await ingestEpub(v1(), { bookId: 'b' });
		expect(result.manifest).not.toHaveProperty('previousRevisionId');
		expect(result.manifest).not.toHaveProperty('deletedWordIds');
	});
});

describe('migrateAnchors (§6.2)', () => {
	async function revisions() {
		const first = await ingestEpub(v1(), { bookId: 'b' });
		const previous = revisionOf(first);
		const second = await ingestEpub(v2(), { bookId: 'b', previous });
		return { previous, next: revisionOf(second) };
	}

	it('moves Anchors whose Words survive, with new Ordinals and a fresh quote', async () => {
		const { previous, next } = await revisions();
		const before = new RevisionIndex(previous);
		const anchor = rangeOver(before, P.two);
		const [result] = migrateAnchors([anchor], previous, next);
		expect(result).toMatchObject({ status: 'migrated', via: 'word-ids' });
		expect(result!.anchor.startWordId).toBe(anchor.startWordId);
		expect(result!.anchor.revisionId).toBe(next.revisionId);
		expect(result!.anchor.startOrdinal).not.toBe(anchor.startOrdinal);
		expect(result!.anchor.quote.exact).toBe(P.two.slice(0, -1));
	});

	it('re-finds moved text by its quote, and orphans deleted text', async () => {
		const { previous, next } = await revisions();
		const before = new RevisionIndex(previous);
		const moved = rangeOver(before, P.moving);
		const deleted = rangeOver(before, P.gone);
		const [m, d] = migrateAnchors([moved, deleted], previous, next);
		// Moved to another Chapter: new WordIds there, so the quote finds it.
		expect(m).toMatchObject({ status: 'migrated' });
		expect(m!.anchor.quote.exact).toBe(P.moving.slice(0, -1));
		expect(d).toMatchObject({ status: 'orphaned', anchor: deleted });
	});

	it('finds a lightly edited quote when its end Words changed (fuzzy)', async () => {
		const { previous, next } = await revisions();
		const before = new RevisionIndex(previous);
		// "…to get very tired": "very" was replaced, and it's this highlight's last Word.
		const anchor = rangeOver(before, P.edit, 0, 6);
		const after = new RevisionIndex(next);
		const veryId = before.wordIdAt(anchor.endOrdinal);
		expect(after.ordinalOf(veryId)).toBeUndefined();
		const [result] = migrateAnchors([anchor], previous, next);
		expect(result).toMatchObject({ status: 'migrated', via: 'fuzzy-quote' });
		expect(result!.anchor.quote.exact).toMatch(/^Alice was beginning to get/);
	});

	it('only moves a one-Word bookmark where its surroundings match', async () => {
		const { previous, next } = await revisions();
		const before = new RevisionIndex(previous);
		const gone = rangeOver(before, P.gone);
		// "the" on deleted text: plenty of other "the"s, none with the same neighbours.
		const point: PointAnchor = before.pointAnchor(gone.startOrdinal + 9);
		expect(point.quote.exact).toBe('the');
		const [result] = migrateAnchors([point], previous, next);
		expect(result!.status).toBe('orphaned');
	});

	it('Reading Progress falls back to the nearest surviving Word before it', async () => {
		const { previous, next } = await revisions();
		const before = new RevisionIndex(previous);
		const gone = rangeOver(before, P.gone);
		const progress = before.pointAnchor(gone.startOrdinal + 4);
		const result = migrateProgress(progress, previous, next)!;
		expect(result).toMatchObject({ status: 'migrated', via: 'nearest-word' });
		// The last Word of the (edited) paragraph before the deleted one.
		expect(result.anchor.quote.exact).toBe('day');
	});
});

describe('re-importing an edited Alice (P1-ING-03 acceptance)', () => {
	it('editing one paragraph and deleting another keeps every other Annotation on its WordIds', async () => {
		const bytes = new Uint8Array(readFileSync(join(root, 'apps/web/static/books/alice.epub')));
		const first = await ingestEpub(bytes, { bookId: 'alice' });
		const previous = revisionOf(first);
		const chapter = first.manifest.chapters.find((c) => /Rabbit-Hole/i.test(c.title))!;
		const path = `OEBPS/${chapter.href}`;
		const edited = editEpub(bytes, {
			[path]: (xhtml) =>
				xhtml
					.replace('Alice was beginning to get very tired', 'Alice was getting very tired')
					.replace(/<p>\s*There was nothing so[\s\S]*?<\/p>/, '')
		});
		const second = await ingestEpub(edited, { bookId: 'alice', previous });
		const next = revisionOf(second);
		expect(second.manifest.deletedWordIds!.length).toBeGreaterThan(20);

		// One highlight on every tenth paragraph-sized run of the Book, outside the edited text.
		const before = new RevisionIndex(previous);
		const after = new RevisionIndex(next);
		const editedSpan = before.chapterSpan(chapter.chapterId)!;
		const anchors: RangeAnchor[] = [];
		for (let o = 0; o + 12 < before.wordCount; o += 997) {
			const inEdited = o >= editedSpan[0] && o <= editedSpan[0] + 400;
			if (!inEdited) anchors.push(before.rangeAnchor(o, o + 12));
		}
		const results = migrateAnchors(anchors, previous, next);
		for (const [k, result] of results.entries()) {
			expect(result.status).toBe('migrated');
			expect(result.anchor.startWordId).toBe(anchors[k]!.startWordId);
			expect(result.anchor.endWordId).toBe(anchors[k]!.endWordId);
			expect(after.ordinalOf(result.anchor.startWordId)).toBe(result.anchor.startOrdinal);
		}
	});
});
