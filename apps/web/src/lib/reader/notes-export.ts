/**
 * Notes export (P1-RDR-06, DESIGN.md §9.3): Markdown with a heading per Chapter, or plain text.
 * Pure, so the reader's panel and You → Data (P1-APP-04) share it and it can be unit-tested.
 * What the reader wrote is escaped, so it reads back exactly as typed.
 */
import type { Annotation, HighlightColour, PlacedBookmark } from '@book/core';

export interface NotesExportInput {
	title: string;
	creator?: string;
	/** The Chapter title for an Ordinal on the Book's current Revision, or null if unknown. */
	chapterOf: (ordinal: number) => string | null;
	/** Live Annotations and bookmarks, in reading order. */
	annotations: Annotation[];
	bookmarks: PlacedBookmark[];
	/** Records whose text is gone from the current Revision (§6.2). */
	orphaned: (Annotation | PlacedBookmark)[];
	colourName: (colour: HighlightColour) => string;
	/** For the "Exported …" line; the caller formats it in the reader's locale. */
	exportedOn: string;
}

/** Escapes Markdown's special characters so text is shown literally. */
export function escapeMarkdown(text: string): string {
	return text
		.replace(/([\\`*_[\]{}<>|#~])/g, '\\$1')
		.replace(/^(\s*)([-+=])(\s)/gm, '$1\\$2$3')
		.replace(/^(\s*)(\d+)([.)])(\s)/gm, '$1$2\\$3$4');
}

/** A Markdown blockquote; each line of the quote gets its marker. */
function blockquote(text: string): string {
	return text
		.split('\n')
		.map((line) => `> ${escapeMarkdown(line)}`)
		.join('\n');
}

function groupByChapter<T>(items: T[], ordinalOf: (item: T) => number, input: NotesExportInput) {
	const groups: { title: string; items: T[] }[] = [];
	for (const item of items) {
		const title = input.chapterOf(ordinalOf(item)) ?? 'Notes';
		const last = groups.at(-1);
		if (last && last.title === title) last.items.push(item);
		else groups.push({ title, items: [item] });
	}
	return groups;
}

const isAnnotation = (r: Annotation | PlacedBookmark): r is Annotation => 'colour' in r;

export function notesMarkdown(input: NotesExportInput): string {
	const out: string[] = [`# ${escapeMarkdown(input.title)}`, ''];
	if (input.creator) out.push(`*${escapeMarkdown(input.creator)}*`, '');
	out.push(`Notes and highlights, exported ${escapeMarkdown(input.exportedOn)}.`, '');

	for (const group of groupByChapter(input.annotations, (a) => a.anchor.startOrdinal, input)) {
		out.push(`## ${escapeMarkdown(group.title)}`, '');
		for (const a of group.items) {
			out.push(blockquote(a.anchor.quote.exact), '');
			if (a.note) out.push(escapeMarkdown(a.note), '');
			out.push(`*${input.colourName(a.colour)} highlight*`, '');
		}
	}

	if (input.bookmarks.length) {
		out.push('## Bookmarks', '');
		for (const b of input.bookmarks) {
			const where = input.chapterOf(b.anchor.ordinal);
			const label = b.label ? `${escapeMarkdown(b.label)}: ` : '';
			const at = `“${escapeMarkdown(b.anchor.quote.exact)} ${escapeMarkdown(b.anchor.quote.suffix)}…”`;
			out.push(`- ${label}${at}${where ? ` (${escapeMarkdown(where)})` : ''}`);
		}
		out.push('');
	}

	if (input.orphaned.length) {
		out.push(
			'## Orphaned',
			'',
			'The text these were on changed in a newer version of the book.',
			''
		);
		for (const r of input.orphaned) {
			out.push(blockquote(r.anchor.quote.exact), '');
			if (isAnnotation(r) && r.note) out.push(escapeMarkdown(r.note), '');
			if (!isAnnotation(r) && r.label) out.push(`*Bookmark: ${escapeMarkdown(r.label)}*`, '');
		}
	}
	return `${out.join('\n').trimEnd()}\n`;
}

export function notesPlainText(input: NotesExportInput): string {
	const out: string[] = [input.title];
	if (input.creator) out.push(input.creator);
	out.push(`Notes and highlights, exported ${input.exportedOn}.`, '');

	for (const group of groupByChapter(input.annotations, (a) => a.anchor.startOrdinal, input)) {
		out.push(group.title.toUpperCase(), '');
		for (const a of group.items) {
			out.push(`“${a.anchor.quote.exact}”`);
			if (a.note) out.push(`Note: ${a.note}`);
			out.push(`(${input.colourName(a.colour)} highlight)`, '');
		}
	}
	if (input.bookmarks.length) {
		out.push('BOOKMARKS', '');
		for (const b of input.bookmarks) {
			const where = input.chapterOf(b.anchor.ordinal);
			out.push(
				`- ${b.label ? `${b.label}: ` : ''}“${b.anchor.quote.exact} ${b.anchor.quote.suffix}…”${where ? ` (${where})` : ''}`
			);
		}
		out.push('');
	}
	if (input.orphaned.length) {
		out.push('ORPHANED', '');
		for (const r of input.orphaned) {
			out.push(`“${r.anchor.quote.exact}”`);
			if (isAnnotation(r) && r.note) out.push(`Note: ${r.note}`);
			out.push('');
		}
	}
	return `${out.join('\n').trimEnd()}\n`;
}

/** A file name from a Book title: letters, digits and spaces, never empty. */
export function exportFileName(title: string, extension: 'md' | 'txt' | 'json'): string {
	const base = title
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N} _-]+/gu, '')
		.trim()
		.replace(/\s+/g, ' ')
		.slice(0, 80);
	return `${base || 'Book'} - notes.${extension}`;
}
