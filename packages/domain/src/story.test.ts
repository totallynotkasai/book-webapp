import type { ChapterRecord, RangeAnchor, StorySoFarDto } from '@book/core';
import { describe, expect, it } from 'vitest';
import {
	glossaryEntryFor,
	glossarySortKey,
	nameWords,
	publishStoryProblems,
	reachedOrdinal,
	RevisionWordTexts,
	selectionIsName,
	storyProblems,
	storySoFarAt,
	wordMatches,
	type ChapterWordTexts
} from './index';

/** Chapters from their Words' text, with WordIds and Ordinals worked out. */
function chapters(...texts: string[]): { words: ChapterWordTexts[]; records: ChapterRecord[] } {
	let ordinal = 0;
	const words: ChapterWordTexts[] = [];
	const records: ChapterRecord[] = [];
	texts.forEach((text, i) => {
		const t = text.split(' ').filter(Boolean);
		const chapterId = `ch${i + 1}`;
		words.push({
			chapterId,
			firstOrdinal: ordinal,
			wordIds: t.map((_, j) => 1000 + ordinal + j),
			texts: t
		});
		records.push({
			chapterId,
			href: chapterId,
			spineIndex: i,
			linear: true,
			title: `Chapter ${i + 1}`,
			wordCount: t.length,
			firstWordId: t.length ? 1000 + ordinal : null,
			lastWordId: t.length ? 1000 + ordinal + t.length - 1 : null,
			firstOrdinal: ordinal,
			lastOrdinal: ordinal + t.length - 1
		});
		ordinal += t.length;
	});
	return { words, records };
}

const book = chapters(
	'Tam lit the lamp and trimmed its wick before the Murk came',
	'Mister Cobb’s cat was called Wick and it purred',
	'At Saltgate Bridge the WARDEN OF THE MURK waited for Tam'
);
const text = new RevisionWordTexts('book', 'rev', book.words);

describe('finding a name in the text (P1-STU-05)', () => {
	it('splits names as the tokeniser does, folding accents and curly apostrophes', () => {
		expect(nameWords('Lamplighter’s Ledger')).toEqual(["Lamplighter's", 'Ledger']);
		expect(nameWords('Sigil-Lights')).toEqual(['Sigil', 'Lights']);
		expect(nameWords('  Zoë  ')).toEqual(['Zoe']);
	});

	it('finds the first occurrence, as an Anchor on its Words with a quote', () => {
		const found = text.find('Mister Cobb')!;
		expect(found.chapterId).toBe('ch2');
		expect(found.anchor).toMatchObject({
			kind: 'range',
			bookId: 'book',
			revisionId: 'rev',
			startOrdinal: 12,
			endOrdinal: 13,
			startWordId: 1012,
			endWordId: 1013
		});
		expect(found.anchor.quote.exact).toBe('Mister Cobb’s');
		// It opens Chapter 2: nothing before it, and the context stays in its Chapter.
		expect(found.context).toBe('Mister Cobb’s cat was called Wick and it …');
		expect(text.find('Saltgate Bridge')!.context).toBe(
			'At Saltgate Bridge the WARDEN OF THE MURK waited …'
		);
		expect(text.find('purred')!.context).toBe('… cat was called Wick and it purred');
	});

	it('needs a capital where the name has one, so a cat isn’t found in a lamp’s wick', () => {
		expect(text.find('Wick')!.chapterId).toBe('ch2');
		expect(wordMatches('wick', 'Wick', true)).toBe(false);
		expect(wordMatches('WICK', 'Wick', true)).toBe(true);
	});

	it('matches lower-case name Words in any case, and Words in capitals', () => {
		// "the Murk" in Chapter 1; "WARDEN OF THE MURK" in Chapter 3 is all capitals.
		expect(text.find('the Murk')!.anchor.startOrdinal).toBe(9);
		expect(text.find('Warden of the Murk')!.chapterId).toBe('ch3');
	});

	it('finds a possessive on the last Word only, and never across Chapters', () => {
		expect(text.find('Cobb')!.anchor.quote.exact).toBe('Cobb’s');
		expect(text.find('Murk Mister')).toBeNull();
		expect(text.find('Nobody Here')).toBeNull();
		expect(text.find('   ')).toBeNull();
	});

	it('tells whether a selection is a name', () => {
		expect(selectionIsName('Mister Cobb’s', 'Mister Cobb')).toBe(true);
		expect(selectionIsName('“Wick,”', 'Wick')).toBe(true);
		expect(selectionIsName('wick', 'Wick')).toBe(false);
		expect(selectionIsName('Cobb', 'Mister Cobb')).toBe(false);
	});
});

describe('publishing (P1-STU-05)', () => {
	it('needs something to publish and every entry’s name in the text', () => {
		expect(storyProblems({ recaps: 0, entries: [] })).toEqual([
			'Write a recap or add a glossary entry first.'
		]);
		expect(storyProblems({ recaps: 1, entries: [{ name: 'Wick', inText: true }] })).toEqual([]);
		expect(storyProblems({ recaps: 0, entries: [{ name: 'Nobody', inText: false }] })).toEqual([
			'“Nobody” isn’t in the book’s text, so readers would never meet it. Check its spelling, or remove it.'
		]);
	});

	it('needs the AI answer (§10.6)', () => {
		expect(publishStoryProblems({ recaps: 1, entries: [] }, null)).toEqual([
			'Answer “Was AI used to write these?” first.'
		]);
		expect(publishStoryProblems({ recaps: 1, entries: [] }, 'generated')).toEqual([]);
	});
});

describe('what a reader sees (P1-RDR-13, Invariant 6)', () => {
	const at = (name: string) => text.find(name)!.anchor;
	const story: StorySoFarDto = {
		bookId: 'book',
		revisionId: 'rev',
		aiUse: 'none',
		publishedAt: '2026-10-16T00:00:00.000Z',
		recaps: [
			{ chapterId: 'ch2', text: 'Cobb’s cat.' },
			{ chapterId: 'ch1', text: 'A lamp was lit.' },
			{ chapterId: 'ch3', text: 'The Warden.' }
		],
		glossary: [
			{
				id: 'cobb',
				names: [{ name: 'Mister Cobb', firstAppearance: at('Mister Cobb') }],
				description: 'The old lamplighter.',
				picture: null
			},
			{
				id: 'tam',
				names: [
					{ name: 'Tamsin Reed', firstAppearance: at('Tam') },
					{ name: 'Tam', firstAppearance: at('Tam') }
				],
				description: 'A lamplighter.',
				picture: null
			},
			{
				id: 'murk',
				// Named in full only in Chapter 3; met as "the Murk" in Chapter 1.
				names: [
					{ name: 'Warden of the Murk', firstAppearance: at('Warden of the Murk') },
					{ name: 'the Murk', firstAppearance: at('the Murk') }
				],
				description: 'A fog.',
				picture: null
			}
		]
	};
	const manifest = { revisionId: 'rev', chapters: book.records };
	const ch = (n: number) => book.records[n - 1]!;

	it('shows a Chapter’s recap once its last Word is reached, not one Word before', () => {
		expect(storySoFarAt(story, manifest, ch(2).lastOrdinal - 1).recaps).toEqual([
			{ chapterId: 'ch1', text: 'A lamp was lit.' }
		]);
		expect(storySoFarAt(story, manifest, ch(2).lastOrdinal).recaps.map((r) => r.chapterId)).toEqual(
			['ch1', 'ch2']
		);
		expect(storySoFarAt(story, manifest, ch(3).firstOrdinal).recaps).toHaveLength(2);
	});

	it('shows an entry once its name has appeared, and nothing first named later', () => {
		const cobb = at('Mister Cobb');
		const before = storySoFarAt(story, manifest, cobb.endOrdinal - 1).glossary;
		expect(before.map((e) => e.id)).not.toContain('cobb');
		const after = storySoFarAt(story, manifest, cobb.endOrdinal).glossary;
		expect(after.map((e) => e.id)).toContain('cobb');
		expect(storySoFarAt(story, manifest, -1).glossary).toEqual([]);
	});

	it('names an entry by the first name met, hiding names still to come', () => {
		const inChapter1 = storySoFarAt(story, manifest, ch(1).lastOrdinal).glossary;
		const murk = inChapter1.find((e) => e.id === 'murk')!;
		expect(murk.name).toBe('the Murk');
		expect(murk.alsoCalled).toEqual([]);
		const inChapter3 = storySoFarAt(story, manifest, ch(3).lastOrdinal).glossary;
		expect(inChapter3.find((e) => e.id === 'murk')).toMatchObject({
			name: 'Warden of the Murk',
			alsoCalled: ['the Murk'],
			firstAppearance: at('the Murk')
		});
	});

	it('lists entries alphabetically, ignoring a leading “the”', () => {
		const all = storySoFarAt(story, manifest, ch(3).lastOrdinal).glossary.map((e) => e.name);
		expect(all).toEqual(['Mister Cobb', 'Tamsin Reed', 'Warden of the Murk']);
		expect(glossarySortKey('the Murk')).toBe('Murk');
	});

	it('shows nothing from another Revision', () => {
		expect(storySoFarAt(story, { ...manifest, revisionId: 'newer' }, 10_000)).toEqual({
			recaps: [],
			glossary: []
		});
		const stale: RangeAnchor = { ...at('Mister Cobb'), revisionId: 'older' };
		const mixed = {
			...story,
			glossary: [
				{ ...story.glossary[0]!, names: [{ name: 'Mister Cobb', firstAppearance: stale }] }
			]
		};
		expect(storySoFarAt(mixed, manifest, 10_000).glossary).toEqual([]);
	});

	it('finds the entry a selection names, by any name met', () => {
		const inChapter1 = storySoFarAt(story, manifest, ch(1).lastOrdinal);
		expect(glossaryEntryFor('Tam', inChapter1)?.id).toBe('tam');
		expect(glossaryEntryFor('Murk', inChapter1)).toBeUndefined();
		expect(glossaryEntryFor('the Murk', inChapter1)?.id).toBe('murk');
		// Not met yet: Chapter 3's name finds nothing in Chapter 1.
		expect(glossaryEntryFor('Warden of the Murk', inChapter1)).toBeUndefined();
	});

	it('takes the furthest of the places given, on this Revision only', () => {
		expect(
			reachedOrdinal(
				'rev',
				{ revisionId: 'rev', ordinal: 5 },
				{ revisionId: 'old', ordinal: 50 },
				null,
				{ revisionId: 'rev', ordinal: 9 }
			)
		).toBe(9);
		expect(reachedOrdinal('rev')).toBe(-1);
	});
});
