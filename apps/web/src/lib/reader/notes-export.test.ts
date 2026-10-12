import type { Annotation, PlacedBookmark, RangeAnchor } from '@book/core';
import { describe, expect, it } from 'vitest';
import {
	escapeMarkdown,
	exportFileName,
	notesMarkdown,
	notesPlainText,
	type NotesExportInput
} from './notes-export';

const stamp = '2026-10-12T09:00:00.000Z';

function range(start: number, end: number, exact: string): RangeAnchor {
	return {
		kind: 'range',
		bookId: 'b',
		revisionId: 'r',
		startWordId: start + 1,
		endWordId: end + 1,
		startOrdinal: start,
		endOrdinal: end,
		quote: { exact, prefix: '', suffix: '' }
	};
}

function annotation(start: number, exact: string, note?: string): Annotation {
	return {
		id: `a${start}`,
		bookId: 'b',
		anchor: range(start, start + 2, exact),
		anchorStatus: 'ok',
		colour: 1,
		...(note ? { note } : {}),
		createdAt: stamp,
		updatedAt: stamp,
		deletedAt: null
	};
}

const bookmark: PlacedBookmark = {
	id: 'm1',
	bookId: 'b',
	anchor: {
		kind: 'point',
		bookId: 'b',
		revisionId: 'r',
		wordId: 51,
		ordinal: 50,
		quote: { exact: 'Alice', prefix: '', suffix: 'was beginning to get' }
	},
	anchorStatus: 'ok',
	label: 'Start',
	createdAt: stamp,
	updatedAt: stamp,
	deletedAt: null
};

const input = (overrides: Partial<NotesExportInput> = {}): NotesExportInput => ({
	title: 'Alice’s Adventures',
	creator: 'Lewis Carroll',
	chapterOf: (ordinal) => (ordinal < 100 ? 'Chapter I' : 'Chapter II'),
	annotations: [
		annotation(10, 'down the rabbit-hole'),
		annotation(20, 'Curiouser and curiouser!', 'She *really* said this'),
		annotation(150, '# not a heading')
	],
	bookmarks: [bookmark],
	orphaned: [],
	colourName: () => 'Yellow',
	exportedOn: '12 October 2026',
	...overrides
});

describe('notes export (P1-RDR-06)', () => {
	it('writes Markdown with a heading per Chapter, quotes, notes and bookmarks', () => {
		expect(notesMarkdown(input())).toBe(
			[
				'# Alice’s Adventures',
				'',
				'*Lewis Carroll*',
				'',
				'Notes and highlights, exported 12 October 2026.',
				'',
				'## Chapter I',
				'',
				'> down the rabbit-hole',
				'',
				'*Yellow highlight*',
				'',
				'> Curiouser and curiouser!',
				'',
				'She \\*really\\* said this',
				'',
				'*Yellow highlight*',
				'',
				'## Chapter II',
				'',
				'> \\# not a heading',
				'',
				'*Yellow highlight*',
				'',
				'## Bookmarks',
				'',
				'- Start: “Alice was beginning to get…” (Chapter I)',
				''
			].join('\n')
		);
	});

	it('lists orphaned items in their own section with their quoted text', () => {
		const lost = {
			...annotation(5, 'a deleted paragraph', 'my note'),
			anchorStatus: 'orphaned' as const
		};
		const md = notesMarkdown(input({ annotations: [], bookmarks: [], orphaned: [lost] }));
		expect(md).toContain('## Orphaned');
		expect(md).toContain('> a deleted paragraph\n\nmy note');
	});

	it('escapes what could be read as Markdown', () => {
		expect(escapeMarkdown('1. not a list')).toBe('1\\. not a list');
		expect(escapeMarkdown('- dash')).toBe('\\- dash');
		expect(escapeMarkdown('[link](x) <b> a_b `c`')).toBe('\\[link\\](x) \\<b\\> a\\_b \\`c\\`');
	});

	it('writes plain text too', () => {
		const text = notesPlainText(input());
		expect(text).toContain('CHAPTER I\n\n“down the rabbit-hole”\n(Yellow highlight)');
		expect(text).toContain('Note: She *really* said this');
		expect(text).not.toContain('\\');
	});

	it('makes a safe file name', () => {
		expect(exportFileName('Alice’s Adventures: in Wonderland?', 'md')).toBe(
			'Alices Adventures in Wonderland - notes.md'
		);
		expect(exportFileName('???', 'txt')).toBe('Book - notes.txt');
	});
});
