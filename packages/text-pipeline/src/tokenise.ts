/**
 * The Word tokeniser (DESIGN.md §7.1, D-026). Deterministic and versioned (`TOKENISER_VERSION`):
 * it uses only Unicode properties built into JavaScript regular expressions, never
 * `Intl.Segmenter`, whose ICU data differs between Chromium, WebKit and Node (OPEN-14).
 *
 * Rules follow UAX #29 word boundaries for space-separated scripts:
 * - letters and digits join (WB5, WB8–WB10), and so do connectors like `_` (WB13a/b);
 * - an apostrophe, `’`, `.` or `·` between letters joins them: "can't", "e.g" (WB6/7);
 * - `,` `.` `;` and apostrophes between digits join them: "1,000", "3.14" (WB11/12);
 * - combining marks and format characters (soft hyphen, ZWJ) stay inside a Word (WB4).
 * Deliberate differences: `:` does not join letters (CLDR drops it for most languages), and
 * Han, Hiragana, Katakana, Thai, Lao, Khmer and Myanmar text is one Word per character, since
 * those scripts need dictionaries this version doesn't have. Hyphens always split Words.
 *
 * A Word is a token containing at least one letter or digit. Offsets are UTF-16 code units.
 */

export interface Token {
	start: number;
	end: number;
}

const enum Cls {
	Other,
	/** A letter of a space-separated script. */
	Letter,
	Digit,
	/** One Word per character (Han, Kana, Thai…). */
	Single,
	/** Combining marks and format characters: belong to the character before. */
	Extend,
	/** Joins letters: `·` and friends. */
	MidLetter,
	/** Joins letters or digits: `.` `'` `’`. */
	MidNumLet,
	/** Joins digits: `,` `;`. */
	MidNum,
	/** Connector punctuation such as `_`. */
	Connector
}

const SINGLE =
	/[\p{Ideographic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const EXTEND = /[\p{M}\p{Cf}]/u;
// Alphabetic = letters, letter numbers and other alphabetic signs (marks were taken as Extend).
const LETTER = /\p{Alphabetic}/u;
const DIGIT = /\p{Nd}/u;
const CONNECTOR = /\p{Pc}/u;
const MID_LETTER = new Set([0x00b7, 0x0387, 0x055f, 0x05f4, 0x2027, 0xfe13, 0xfe55]);
const MID_NUM_LET = new Set([0x002e, 0x0027, 0x2018, 0x2019, 0x2024, 0xfe52, 0xff07, 0xff0e]);
const MID_NUM = new Set([
	0x002c, 0x003b, 0x037e, 0x0589, 0x060c, 0x060d, 0x066c, 0x07f8, 0x2044, 0xfe10, 0xfe14, 0xfe50,
	0xfe54, 0xff0c, 0xff1b
]);

/** Classes of the Basic Multilingual Plane, filled lazily (most books never leave it). */
const bmp = new Uint8Array(0x10000).fill(0xff);

function classify(cp: number): Cls {
	if (cp < 0x10000) {
		const cached = bmp[cp]!;
		if (cached !== 0xff) return cached as Cls;
		const cls = compute(cp);
		bmp[cp] = cls;
		return cls;
	}
	return compute(cp);
}

function compute(cp: number): Cls {
	if (MID_NUM_LET.has(cp)) return Cls.MidNumLet;
	if (MID_LETTER.has(cp)) return Cls.MidLetter;
	if (MID_NUM.has(cp)) return Cls.MidNum;
	const ch = String.fromCodePoint(cp);
	if (EXTEND.test(ch)) return Cls.Extend;
	if (SINGLE.test(ch)) return Cls.Single;
	if (LETTER.test(ch)) return Cls.Letter;
	if (DIGIT.test(ch)) return Cls.Digit;
	if (CONNECTOR.test(ch)) return Cls.Connector;
	return Cls.Other;
}

/** Splits text into Words. Same text in, same Words out, in every runtime. */
export function tokenise(text: string): Token[] {
	// Code points with their class and UTF-16 start offset; `offsets[n]` is the text length.
	const classes: Cls[] = [];
	const offsets: number[] = [];
	for (let i = 0; i < text.length;) {
		const cp = text.codePointAt(i)!;
		classes.push(classify(cp));
		offsets.push(i);
		i += cp > 0xffff ? 2 : 1;
	}
	const n = classes.length;
	offsets.push(text.length);

	/** The index after any Extend characters from `i`. */
	const skipExtend = (i: number) => {
		while (i < n && classes[i] === Cls.Extend) i++;
		return i;
	};

	const tokens: Token[] = [];
	let i = 0;
	while (i < n) {
		const cls = classes[i]!;
		if (cls === Cls.Single) {
			const end = skipExtend(i + 1);
			tokens.push({ start: offsets[i]!, end: offsets[end]! });
			i = end;
			continue;
		}
		if (cls !== Cls.Letter && cls !== Cls.Digit && cls !== Cls.Connector) {
			i++;
			continue;
		}
		const start = i;
		let last = cls;
		let hasWordChar = cls !== Cls.Connector;
		let end = skipExtend(i + 1);
		for (;;) {
			const next = classes[end];
			if (next === Cls.Letter || next === Cls.Digit || next === Cls.Connector) {
				last = next;
				hasWordChar ||= next !== Cls.Connector;
				end = skipExtend(end + 1);
				continue;
			}
			// A joiner counts only between two characters of the right kind (WB6/7, WB11/12).
			if (next === Cls.MidLetter || next === Cls.MidNumLet || next === Cls.MidNum) {
				const after = skipExtend(end + 1);
				const following = classes[after];
				const joinsLetters =
					last === Cls.Letter &&
					following === Cls.Letter &&
					(next === Cls.MidLetter || next === Cls.MidNumLet);
				const joinsDigits =
					last === Cls.Digit &&
					following === Cls.Digit &&
					(next === Cls.MidNum || next === Cls.MidNumLet);
				if (joinsLetters || joinsDigits) {
					end = after;
					continue;
				}
			}
			break;
		}
		if (hasWordChar) tokens.push({ start: offsets[start]!, end: offsets[end]! });
		i = end;
	}
	return tokens;
}

/** The Words of a text as strings, for tests and the ingest report. */
export function words(text: string): string[] {
	return tokenise(text).map(({ start, end }) => text.slice(start, end));
}
