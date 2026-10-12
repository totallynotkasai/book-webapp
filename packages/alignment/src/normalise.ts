/**
 * Normalisation for alignment (docs/DESIGN.md §7.2 step 3). Both the Chapter's Words and the
 * transcript go through the same rules, so they meet in one comparable form:
 *   - Unicode NFKD, diacritics removed, lowercase;
 *   - apostrophes dropped, so contractions and possessives collapse ("didn’t" → "didnt");
 *   - hyphens, dashes and slashes split a word into parts ("rabbit-hole" → "rabbit", "hole");
 *     the aligner's merge step then matches "today" against "to-day" (see sequence.ts);
 *   - every other punctuation mark removed;
 *   - numbers spelled out ("42" → "forty", "two"; "3rd" → "third"), so "42" and "forty-two"
 *     produce the same tokens;
 *   - a Roman numeral after "chapter", "book" or "part" read as a number ("CHAPTER IV." → "four").
 */

const ONES = [
	'zero',
	'one',
	'two',
	'three',
	'four',
	'five',
	'six',
	'seven',
	'eight',
	'nine',
	'ten',
	'eleven',
	'twelve',
	'thirteen',
	'fourteen',
	'fifteen',
	'sixteen',
	'seventeen',
	'eighteen',
	'nineteen'
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: [number, string][] = [
	[1e9, 'billion'],
	[1e6, 'million'],
	[1e3, 'thousand'],
	[1e2, 'hundred']
];

/** Spells out a whole number: 42 → ["forty", "two"]. Supports 0 to 999 999 999 999. */
export function numberToWords(n: number): string[] {
	if (!Number.isInteger(n) || n < 0 || n >= 1e12) throw new RangeError(`Unsupported number ${n}`);
	if (n < 20) return [ONES[n]!];
	if (n < 100) {
		const rest = n % 10;
		return rest ? [TENS[Math.floor(n / 10)]!, ONES[rest]!] : [TENS[n / 10]!];
	}
	for (const [scale, name] of SCALES) {
		if (n >= scale) {
			const rest = n % scale;
			return [...numberToWords(Math.floor(n / scale)), name, ...(rest ? numberToWords(rest) : [])];
		}
	}
	return [];
}

const IRREGULAR_ORDINALS: Record<string, string> = {
	one: 'first',
	two: 'second',
	three: 'third',
	five: 'fifth',
	eight: 'eighth',
	nine: 'ninth',
	twelve: 'twelfth'
};

/** "twenty", "one" → "twenty", "first". */
function toOrdinal(words: string[]): string[] {
	const last = words[words.length - 1]!;
	const ordinal =
		IRREGULAR_ORDINALS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
	return [...words.slice(0, -1), ordinal];
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

/** "iv" → 4. Returns undefined unless the input is a well-formed Roman numeral. */
export function romanToNumber(text: string): number | undefined {
	const s = text.toLowerCase();
	if (!/^[ivxlcdm]+$/.test(s)) return undefined;
	let total = 0;
	for (let i = 0; i < s.length; i++) {
		const value = ROMAN[s[i]!]!;
		const next = ROMAN[s[i + 1] ?? ''] ?? 0;
		total += value < next ? -value : value;
	}
	// Reject malformed numerals ("iiii", "vx") by round-tripping.
	return toRoman(total) === s ? total : undefined;
}

function toRoman(n: number): string {
	const table: [number, string][] = [
		[1000, 'm'],
		[900, 'cm'],
		[500, 'd'],
		[400, 'cd'],
		[100, 'c'],
		[90, 'xc'],
		[50, 'l'],
		[40, 'xl'],
		[10, 'x'],
		[9, 'ix'],
		[5, 'v'],
		[4, 'iv'],
		[1, 'i']
	];
	let out = '';
	for (const [value, numeral] of table) {
		while (n >= value) {
			out += numeral;
			n -= value;
		}
	}
	return out;
}

const SPLIT = /[\s\-‐‑‒–—―/]+/u;
const NUMBER = /^(\d[\d,]*)(?:\.(\d+))?(st|nd|rd|th)?$/;
const APOSTROPHES = /['’‘ʼ`´]/gu;

function spellNumber(part: string): string[] | undefined {
	const match = NUMBER.exec(part);
	if (!match) return undefined;
	const whole = Number(match[1]!.replace(/,/g, ''));
	if (!Number.isSafeInteger(whole) || whole >= 1e12) return undefined;
	let words = numberToWords(whole);
	if (match[3]) words = toOrdinal(words);
	if (match[2]) words = [...words, 'point', ...[...match[2]].map((d) => ONES[Number(d)]!)];
	return words;
}

/** One word as written (a Word's text, or a transcript word) → zero or more comparable tokens. */
export function normaliseWord(text: string): string[] {
	const folded = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
	const tokens: string[] = [];
	for (const raw of folded.split(SPLIT)) {
		const part = raw.replace(APOSTROPHES, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
		if (!part) continue;
		const spelled = spellNumber(part);
		if (spelled) {
			tokens.push(...spelled);
			continue;
		}
		const cleaned = part.replace(/[^\p{L}\p{N}]+/gu, '');
		if (cleaned) tokens.push(cleaned);
	}
	return tokens;
}

/** A normalised token and the index of the word (text Word or transcript word) it came from. */
export interface Token {
	text: string;
	source: number;
	/** Which part of its source word this is (0-based) and how many parts there are. */
	part: number;
	parts: number;
}

const NUMBERED = new Set(['chapter', 'book', 'part']);

/** Normalises a sequence of words, keeping track of which word each token came from. */
export function tokenise(words: readonly string[]): Token[] {
	const tokens: Token[] = [];
	let previous = '';
	words.forEach((word, source) => {
		const roman = NUMBERED.has(previous) ? romanToNumber(word.replace(/\.$/, '')) : undefined;
		const parts = roman !== undefined ? numberToWords(roman) : normaliseWord(word);
		parts.forEach((text, part) => tokens.push({ text, source, part, parts: parts.length }));
		if (parts.length) previous = parts[parts.length - 1]!;
	});
	return tokens;
}
