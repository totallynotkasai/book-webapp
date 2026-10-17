/**
 * A reader's own page and text colours (P1-UI-04, DESIGN.md §4.2, §11.2): the live contrast
 * check, the nearest readable colour, and the reading page's other tokens derived from the pair
 * so styled blocks, links and highlights stay readable wherever the pair is (§9.6).
 */
import { Hct, argbFromHex, hexFromArgb } from '@material/material-color-utilities';
import type { CustomColours } from '@book/core';
import { AA_NON_TEXT, AA_TEXT, contrastRatio, mixColours } from './colour';

type Tokens = Record<`--${string}`, string>;

/**
 * Pairs to start from, each one a reason readers change colours: a calm dark page, a warm
 * light one, amber for night reading, black on yellow for low vision, a cool light page.
 */
export const customColourSuggestions = [
	{ id: 'forest', label: 'Cream on forest green', page: '#1f3d2b', text: '#f3ead3' },
	{ id: 'parchment', label: 'Brown on parchment', page: '#f2e6c9', text: '#3d2b17' },
	{ id: 'amber', label: 'Amber on black', page: '#000000', text: '#ffb84d' },
	{ id: 'yellow', label: 'Black on yellow', page: '#ffe94d', text: '#000000' },
	{ id: 'mist', label: 'Navy on pale blue', page: '#dde9f5', text: '#10284a' }
] as const;

/** Where a pair stands against WCAG: below AA, AA, or AAA (§11.7). */
export type ContrastGrade = 'fail' | 'aa' | 'aaa';

export function contrastGrade(ratio: number): ContrastGrade {
	return ratio >= 7 ? 'aaa' : ratio >= AA_TEXT ? 'aa' : 'fail';
}

/** A ratio as readers see it: "4.48:1", never rounded up to a pass it doesn't make. */
export function formatRatio(ratio: number): string {
	return `${(Math.floor(ratio * 100) / 100).toFixed(2).replace(/\.?0+$/, '')}:1`;
}

const tone = (hex: string) => Hct.fromInt(argbFromHex(hex)).tone;
const clampTone = (t: number) => Math.min(100, Math.max(0, t));

/**
 * The colour nearest to `colour` that reaches `min` against `against`: the same hue and
 * chroma, lighter or darker, whichever needs the smaller change (HCT tone, which tracks how
 * light a colour looks). Black or white always reaches 4.5:1 against any colour, so there's
 * always an answer.
 */
export function nearestReadableColour(colour: string, against: string, min = AA_TEXT): string {
	const start = colour.toLowerCase();
	if (contrastRatio(start, against) >= min) return start;
	const hct = Hct.fromInt(argbFromHex(start));
	let best: { hex: string; distance: number } | undefined;
	for (const direction of [-1, 1]) {
		for (let step = 1; step <= 200; step++) {
			const t = clampTone(hct.tone + direction * step * 0.5);
			const hex = hexFromArgb(Hct.from(hct.hue, hct.chroma, t).toInt());
			if (contrastRatio(hex, against) >= min) {
				const distance = Math.abs(t - hct.tone);
				if (!best || distance < best.distance) best = { hex, distance };
				break;
			}
			if (t === 0 || t === 100) break;
		}
	}
	if (best) return best.hex;
	return contrastRatio('#000000', against) >= contrastRatio('#ffffff', against)
		? '#000000'
		: '#ffffff';
}

/** The pair made readable by changing one of its colours, the other kept as it is. */
export function readablePair(pair: CustomColours, change: keyof CustomColours): CustomColours {
	return change === 'text'
		? { page: pair.page, text: nearestReadableColour(pair.text, pair.page) }
		: { page: nearestReadableColour(pair.page, pair.text), text: pair.text };
}

/** The furthest `from` can move towards `to` (up to `limit`) while `ok` still holds. */
function furthestMix(from: string, to: string, limit: number, ok: (hex: string) => boolean) {
	for (let t = limit; t > 0; t -= 0.01) {
		const hex = mixColours(from, to, t);
		if (ok(hex)) return hex;
	}
	return from;
}

/**
 * Styled blocks' background (§9.6): a step lighter or darker than the page, away from the text
 * where there's room, so the text keeps (or gains) contrast on it; towards the text only while
 * the text still meets AA there (or the pair's own ratio, if it's below AA on purpose).
 */
function blockBackground(page: string, text: string): string {
	const p = Hct.fromInt(argbFromHex(page));
	const away = p.tone >= tone(text) ? 1 : -1;
	const floor = Math.min(AA_TEXT, contrastRatio(text, page));
	for (const t of [clampTone(p.tone + away * 6), clampTone(p.tone - away * 6)]) {
		if (Math.abs(t - p.tone) < 3) continue;
		const hex = hexFromArgb(Hct.from(p.hue, p.chroma, t).toInt());
		if (contrastRatio(text, hex) >= floor) return hex;
	}
	return page;
}

/**
 * A highlight of one hue for this page: a little towards the text from the page, as the
 * standard themes' pale (light) and deep (dark) highlights are, and further from the text
 * wherever that's needed for the text on it to stay readable.
 */
function highlight(hue: number, page: string, text: string): string {
	const pageTone = tone(page);
	const toward = tone(text) > pageTone ? 1 : -1;
	const floor = Math.min(AA_TEXT, contrastRatio(text, page));
	for (let step = 0; step <= 40; step++) {
		const t = clampTone(pageTone + toward * (10 - step));
		const hex = hexFromArgb(Hct.from(hue, 48, t).toInt());
		if (contrastRatio(text, hex) >= floor) return hex;
	}
	return page;
}

/**
 * The reading page's tokens for a custom pair: the page and text as chosen, and the rest
 * derived from them. Muted text and links meet AA on the page, borders 3:1, and text keeps AA
 * on styled blocks and highlights, whenever the pair itself meets AA. A pair the reader kept
 * below AA keeps every derived colour at least as readable as the pair.
 */
export function customReaderTokens(
	custom: CustomColours,
	seed: string,
	highlightHues: readonly number[]
): Tokens {
	const page = custom.page.toLowerCase();
	const text = custom.text.toLowerCase();
	const readable = contrastRatio(text, page) >= AA_TEXT;
	const tokens: Tokens = {
		'--reader-background': page,
		'--reader-text': text,
		'--reader-text-muted': readable
			? furthestMix(text, page, 0.4, (hex) => contrastRatio(hex, page) >= AA_TEXT)
			: text,
		'--reader-block-background': blockBackground(page, text),
		'--reader-block-border':
			contrastRatio(text, page) >= AA_NON_TEXT
				? furthestMix(text, page, 0.6, (hex) => contrastRatio(hex, page) >= AA_NON_TEXT)
				: text,
		// The app's colour, as light or dark as the text, then made readable on the page.
		'--reader-link': nearestReadableColour(
			hexFromArgb(Hct.from(Hct.fromInt(argbFromHex(seed)).hue, 48, tone(text)).toInt()),
			page
		)
	};
	highlightHues.forEach((hue, i) => {
		tokens[`--md-sys-color-highlight-${i + 1}`] = highlight(hue, page, text);
	});
	return tokens;
}
