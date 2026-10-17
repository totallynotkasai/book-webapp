import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RevisionWordTexts } from '@book/domain';
import { parseSeed } from '@book/backend-local';
import { ingestEpub, readRevisionWords } from '@book/text-pipeline';
import { describe, expect, it } from 'vitest';

// P1-STU-05: the seeded story so far for The Lamplighter's Ledger. Every name and alias is in the
// text, and each first appears in the Chapter the description was written for, so its
// description gives nothing away early (Invariant 6). "Wick" the cat isn't found in a lamp's wick.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = parseSeed(JSON.parse(readFileSync(join(root, 'fixtures/seed/seed.json'), 'utf8')));
const story = seed.stories.find((s) => s.bookId === 'book-lamplighters-ledger')!;

/** The Chapter (1–6) each seeded name first appears in. */
const FIRST_CHAPTER: Record<string, number> = {
	'Tamsin Reed': 1,
	'Tam Reed': 1,
	Tam: 1,
	Hollowmere: 1,
	'Mister Cobb': 1,
	'Ezra Cobb': 2,
	'the Murk': 1,
	Murk: 1,
	Kindle: 1,
	'Lumen Guild': 1,
	Guild: 1,
	'Saltgate Bridge': 1,
	Saltgate: 1,
	Wick: 2,
	'The Lamplighter’s Ledger': 2,
	'the Ledger': 2,
	Inscribe: 2,
	'Bram Ollery': 2,
	Bram: 2,
	'Isolde Vell': 4,
	'Guildmaster Vell': 4,
	Guildmaster: 4,
	'First Lamp': 4,
	'Lamp 0': 4,
	'Lamp Zero': 5,
	'Warden of the Murk': 5,
	Warden: 5
};

describe('the Ledger’s seeded story so far', async () => {
	const result = await ingestEpub(
		new Uint8Array(
			readFileSync(join(root, 'apps/web/static/demo/books/the-lamplighters-ledger.epub'))
		),
		{ bookId: 'book-lamplighters-ledger' }
	);
	const files = new Map(result.files.map((f) => [f.path, new TextDecoder().decode(f.data)]));
	const words = readRevisionWords((path) => files.get(path));
	const text = new RevisionWordTexts(
		words.bookId,
		words.revisionId,
		words.chapters.map((c) => ({ ...c }))
	);
	const chapterNumber = (chapterId: string) => Number(/chapter-(\d+)/.exec(chapterId)?.[1]);

	it('has a recap for each of its six Chapters', () => {
		const chapters = result.manifest.chapters.filter((c) => /chapter-\d/.test(c.chapterId));
		expect(story.recaps.map((r) => r.chapterId)).toEqual(chapters.map((c) => c.chapterId));
	});

	it.each(story.glossary.flatMap((e) => [e.name, ...e.aliases]))(
		'finds “%s” first where its description expects',
		(name) => {
			const found = text.find(name);
			expect(found, `${name} is in the text`).not.toBeNull();
			expect(chapterNumber(found!.chapterId)).toBe(FIRST_CHAPTER[name]);
		}
	);

	it('lists every seeded name above', () => {
		expect(story.glossary.flatMap((e) => [e.name, ...e.aliases]).sort()).toEqual(
			Object.keys(FIRST_CHAPTER).sort()
		);
	});

	it('shows a reader at Chapter 3 some entries, but not all', () => {
		const first = (e: (typeof story.glossary)[number]) =>
			Math.min(...[e.name, ...e.aliases].map((n) => FIRST_CHAPTER[n]!));
		const met = story.glossary.filter((e) => first(e) <= 3);
		expect(met.length).toBeGreaterThan(5);
		expect(met.length).toBeLessThan(story.glossary.length);
	});
});
