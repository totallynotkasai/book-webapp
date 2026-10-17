/**
 * The image card for Share quote (P1-RDR-16): the passage in the reader's reading font and page
 * colours, with the Book's title and author, drawn on a canvas as a PNG. 1080 × 1350 (4:5), a
 * shape every messaging and social app shows whole on a phone. Loaded with the share sheet, on
 * first use.
 */
import type { FontId } from '@book/core';
import { fontStacks } from '@book/tokens';
import { wrapText, type Quote, type QuoteSource } from './quote';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
const PAD = 96;
/** Largest first: the biggest that fits is used. 60 Words fit at 48 px in Literata. */
const QUOTE_SIZES = [72, 66, 60, 56, 52, 48, 44, 40, 36, 32];
const LINE_HEIGHT = 1.42;
const TITLE_SIZE = 40;
const AUTHOR_SIZE = 34;

/** The reading page's colours, from the reader's theme tokens. */
export interface CardColours {
	page: string;
	text: string;
	/** For the author: readable on the page (AA, in every theme and in custom colours). */
	muted: string;
	/** The bar above the quote: the reader's link colour, readable on the page. */
	accent: string;
}

export interface CardInput {
	quote: Quote;
	source: QuoteSource;
	colours: CardColours;
	/** The reader's font. The Book's own (`publisher`) can't be drawn outside it, so Literata stands in. */
	font: FontId;
	/** The app's own font stack, for the author's name. */
	uiFont: string;
	/** The Book's writing direction: a right-to-left Book's card is drawn from the right. */
	dir?: 'ltr' | 'rtl';
}

/** What the card is laid out as, separate from drawing it, so the layout can be tested. */
export interface CardLayout {
	quoteSize: number;
	quoteLines: string[];
	titleLines: string[];
	/** Top of the quote's first line. */
	quoteTop: number;
}

type Measure = (text: string, font: string) => number;

function quoteFont(stack: string, size: number) {
	return `${size}px ${stack}`;
}

function titleFont(stack: string) {
	return `italic ${TITLE_SIZE}px ${stack}`;
}

/** The biggest quote size whose lines fit above the title and author; the title takes 1–2 lines. */
export function layoutCard(input: CardInput, measure: Measure): CardLayout {
	const stack = fontStacks[input.font] ?? fontStacks.literata!;
	const width = CARD_WIDTH - PAD * 2;
	const wrapped = wrapText(input.source.title, width, (s) => measure(s, titleFont(stack)));
	const titleLines = wrapped.slice(0, 2).map((l) => l.text);
	// A title longer than two lines ends the second with an ellipsis.
	if (wrapped.length > 2) titleLines[1] = `${titleLines[1]!.replace(/\s*\S+$/, '')}…`;
	const footer = titleLines.length * TITLE_SIZE * 1.3 + (input.source.author.trim() ? 56 : 0);
	// The bar (8 px and a gap) at the top, a gap and a rule above the footer.
	const room = CARD_HEIGHT - PAD * 2 - 72 - 64 - footer;
	for (const size of QUOTE_SIZES) {
		const lines = wrapText(input.quote.text, width, (s) => measure(s, quoteFont(stack, size)));
		const height = lines.length * size * LINE_HEIGHT;
		if (height <= room || size === QUOTE_SIZES.at(-1)) {
			// Centred in its room, so a short quote doesn't hang at the top.
			const quoteTop = PAD + 72 + Math.max(0, (room - height) / 2);
			return { quoteSize: size, quoteLines: lines.map((l) => l.text), titleLines, quoteTop };
		}
	}
	throw new Error('unreachable');
}

/** Waits for the faces the card uses, so the first card isn't drawn in a fallback font. */
async function loadFonts(stack: string, uiFont: string, sample: string) {
	if (!('fonts' in document)) return;
	await Promise.all([
		document.fonts.load(quoteFont(stack, 48), sample),
		document.fonts.load(titleFont(stack), sample),
		document.fonts.load(`${AUTHOR_SIZE}px ${uiFont}`, sample)
	]).catch(() => {
		// A face that won't load is drawn in the stack's next one.
	});
}

/** Draws the card and returns it as a PNG. */
export async function drawQuoteCard(input: CardInput): Promise<Blob> {
	const stack = fontStacks[input.font] ?? fontStacks.literata!;
	await loadFonts(stack, input.uiFont, input.quote.text + input.source.title + input.source.author);
	const canvas = document.createElement('canvas');
	canvas.width = CARD_WIDTH;
	canvas.height = CARD_HEIGHT;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No canvas to draw the quote card on');
	const measure: Measure = (text, font) => {
		ctx.font = font;
		return ctx.measureText(text).width;
	};
	const layout = layoutCard(input, measure);
	const { colours } = input;
	const rtl = input.dir === 'rtl';
	// Where each line starts: the left margin, or the right one for a right-to-left Book.
	const x = rtl ? CARD_WIDTH - PAD : PAD;
	ctx.direction = rtl ? 'rtl' : 'ltr';
	ctx.textAlign = 'start';

	ctx.fillStyle = colours.page;
	ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
	ctx.fillStyle = colours.accent;
	ctx.fillRect(rtl ? CARD_WIDTH - PAD - 120 : PAD, PAD, 120, 8);

	ctx.textBaseline = 'top';
	ctx.fillStyle = colours.text;
	ctx.font = quoteFont(stack, layout.quoteSize);
	const lineHeight = layout.quoteSize * LINE_HEIGHT;
	// Half the leading above each line, as CSS sets it.
	const leading = (lineHeight - layout.quoteSize) / 2;
	layout.quoteLines.forEach((line, i) => {
		ctx.fillText(line, x, layout.quoteTop + i * lineHeight + leading);
	});

	const author = input.source.author.trim();
	let y = CARD_HEIGHT - PAD - (author ? 56 : 0) - layout.titleLines.length * TITLE_SIZE * 1.3;
	ctx.fillStyle = colours.muted;
	ctx.fillRect(PAD, y - 40, CARD_WIDTH - PAD * 2, 2);
	ctx.fillStyle = colours.text;
	ctx.font = titleFont(stack);
	for (const line of layout.titleLines) {
		ctx.fillText(line, x, y);
		y += TITLE_SIZE * 1.3;
	}
	if (author) {
		ctx.fillStyle = colours.muted;
		ctx.font = `${AUTHOR_SIZE}px ${input.uiFont}`;
		ctx.fillText(author, x, y + 8, CARD_WIDTH - PAD * 2);
	}

	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('The card could not be drawn'))),
			'image/png'
		)
	);
}
