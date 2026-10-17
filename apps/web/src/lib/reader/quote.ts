/**
 * Share quote (P1-RDR-16, DESIGN.md §4.5): what a shared passage says. The selection's own text,
 * snapped to whole Words (Invariant 5), with its spacing tidied; a passage of more than
 * `QUOTE_MAX_WORDS` is shortened after that many Words with an ellipsis (D-041), so a share never
 * gives away a page of an author's Book.
 */

/** About 60 Words: a card stays readable on a phone, and only a short extract leaves the Book (D-041). */
export const QUOTE_MAX_WORDS = 60;

/**
 * Words as the tokeniser counts them, near enough (§7.1): runs of letters and digits, joined by
 * an apostrophe inside a Word ("Alice's"), split at hyphens and dashes ("Rabbit-Hole" is two).
 */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
/** What a shortened passage can't end on before its ellipsis. */
const TRAILING = /[\s.,;:\-‐‑–—(“‘]+$/u;
/** Ends a sentence or a speech: the ellipsis stands apart from it. */
const CLOSED = /[?!”’»]$/u;

export interface Quote {
	/** The text to show and share. */
	text: string;
	/** It was cut short, and ends with "…". */
	shortened: boolean;
}

/** The passage as shared: whitespace tidied, at most `maxWords` Words. */
export function quoteOf(selection: string, maxWords = QUOTE_MAX_WORDS): Quote {
	const text = selection.replace(/\s+/g, ' ').trim();
	let count = 0;
	for (const match of text.matchAll(WORD)) {
		if (++count > maxWords) {
			const cut = text.slice(0, match.index).replace(TRAILING, '');
			return { text: `${cut}${CLOSED.test(cut) ? ' …' : '…'}`, shortened: true };
		}
	}
	return { text, shortened: false };
}

export interface QuoteSource {
	/** The Book's title. */
	title: string;
	/** Its author, as the Book names them; may be empty for an imported Book without one. */
	author: string;
}

/** "Lewis Carroll, Alice's Adventures in Wonderland", or the title alone without an author. */
export function attribution(source: QuoteSource): string {
	const author = source.author.trim();
	return author ? `${author}, ${source.title}` : source.title;
}

/** Opens or closes a passage already: dialogue keeps its own marks rather than gaining a second pair. */
const QUOTED = /^[“"‘'«„]/u;

/** The text card: the passage in quotation marks, then who wrote it and where. */
export function quoteText(quote: Quote, source: QuoteSource): string {
	const passage = QUOTED.test(quote.text) ? quote.text : `“${quote.text}”`;
	return `${passage}\n\n— ${attribution(source)}`;
}

/** The image card's alt text (§11.7): everything the picture says. */
export function quoteAlt(quote: Quote, source: QuoteSource): string {
	const author = source.author.trim();
	return `Quote from ${source.title}${author ? ` by ${author}` : ''}: ${quote.text}`;
}

/** A file name for the card: `alices-adventures-in-wonderland-quote.png`. */
export function quoteFileName(source: QuoteSource): string {
	const slug = source.title
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	return `${slug || 'book'}-quote.png`;
}

/** One line of the card: its text and how wide it is drawn. */
export interface Line {
	text: string;
	width: number;
}

/**
 * Breaks text into lines no wider than `maxWidth`, at spaces, or inside a Word too long for a
 * line on its own. `measure` gives a string's width in the font it will be drawn in.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): Line[] {
	const lines: Line[] = [];
	let line = '';
	const push = (s: string) => lines.push({ text: s, width: measure(s) });
	for (const word of text.split(' ')) {
		const candidate = line ? `${line} ${word}` : word;
		if (measure(candidate) <= maxWidth) {
			line = candidate;
			continue;
		}
		if (line) push(line);
		line = word;
		// A Word wider than the line is broken where it must be.
		while (measure(line) > maxWidth && line.length > 1) {
			let end = line.length - 1;
			while (end > 1 && measure(line.slice(0, end)) > maxWidth) end--;
			push(line.slice(0, end));
			line = line.slice(end);
		}
	}
	if (line) push(line);
	return lines;
}
