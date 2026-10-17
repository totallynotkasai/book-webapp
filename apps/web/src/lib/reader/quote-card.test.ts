import { describe, expect, it } from 'vitest';
import { quoteOf } from './quote';
import { CARD_HEIGHT, layoutCard, type CardInput } from './quote-card';

/** A font as wide as Literata, near enough: half an em a character. */
const measure = (text: string, font: string) => {
	const size = Number(/(\d+)px/.exec(font)![1]);
	return text.length * size * 0.5;
};

const colours = { page: '#ffffff', text: '#000000', muted: '#555555', accent: '#00696b' };

function input(text: string, title = "Alice's Adventures in Wonderland"): CardInput {
	return {
		quote: quoteOf(text),
		source: { title, author: 'Lewis Carroll' },
		colours,
		font: 'literata',
		uiFont: 'Nunito'
	};
}

/** The bottom of the quote's last line. */
const bottom = (l: ReturnType<typeof layoutCard>) =>
	l.quoteTop + l.quoteLines.length * l.quoteSize * 1.42;

describe('layoutCard (P1-RDR-16)', () => {
	it('draws a short quote large, centred in its room', () => {
		const layout = layoutCard(input('Curiouser and curiouser!'), measure);
		expect(layout.quoteSize).toBe(72);
		expect(layout.quoteLines).toEqual(['Curiouser and curiouser!']);
		expect(layout.quoteTop).toBeGreaterThan(400);
	});

	it('fits the longest quote above the title, every Word of it', () => {
		const long = Array.from({ length: 80 }, () => 'wonderland').join(' ');
		const layout = layoutCard(input(long), measure);
		expect(layout.quoteLines.join(' ')).toBe(quoteOf(long).text);
		// Above the rule over the title and author.
		expect(bottom(layout)).toBeLessThanOrEqual(CARD_HEIGHT - 96 - 56 - 52 - 40);
		expect(layout.quoteSize).toBeGreaterThanOrEqual(36);
	});

	it('gives a long title two lines at most, ending in an ellipsis', () => {
		const title =
			'The Remarkable and Hitherto Unrecorded Adventures of a Lamplighter in the City of Saltgate';
		const layout = layoutCard(input('Lamps.', title), measure);
		expect(layout.titleLines).toHaveLength(2);
		expect(layout.titleLines[1]).toMatch(/…$/);
	});
});
