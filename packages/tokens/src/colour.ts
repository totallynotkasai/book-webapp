/**
 * Plain colour arithmetic on `#rrggbb` strings: WCAG contrast, parsing what a reader types, and
 * mixing. Pure, so themes come out the same in every browser and in Node.
 */

/** WCAG's minimum contrast for body text (1.4.3, AA). */
export const AA_TEXT = 4.5;
/** WCAG's minimum contrast for borders and other non-text parts (1.4.11, AA). */
export const AA_NON_TEXT = 3;
/** WCAG's enhanced contrast for body text (1.4.6, AAA). */
export const AAA_TEXT = 7;

/** WCAG 2.2 relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 relative-luminance contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
		number,
		number
	];
	return (hi + 0.05) / (lo + 0.05);
}

/** Parses `#rgb` or `#rrggbb` (from a colour input or typed by the user) to `#rrggbb`, or null. */
export function normaliseHex(value: string): string | null {
	const v = value.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(v)) return v;
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
	return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : null;
}

/** `from` moved a fraction `t` (0–1) of the way to `to`, channel by channel. */
export function mixColours(from: string, to: string, t: number): string {
	return (
		'#' +
		[1, 3, 5]
			.map((i) => {
				const a = parseInt(from.slice(i, i + 2), 16);
				const b = parseInt(to.slice(i, i + 2), 16);
				return Math.round(a + (b - a) * t)
					.toString(16)
					.padStart(2, '0');
			})
			.join('')
	);
}

/** Light text reads better on it than dark text does: it goes with the dark scheme. */
export function isDarkColour(hex: string): boolean {
	return contrastRatio(hex, '#ffffff') > contrastRatio(hex, '#000000');
}
