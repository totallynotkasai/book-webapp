/**
 * Sentences from a Chapter's Words (DESIGN.md §8.3): narration highlights a sentence at a time
 * and skips to the previous or next one. Shared with the API from Phase 2 (text-to-speech by
 * sentence, recaps). Words only, so it works from any Revision's word index.
 *
 * A sentence ends at the end of a Block (a paragraph, a heading), or after a Word ending in `.`,
 * `!`, `?` or `…` (closing quotes and brackets allowed) when the next Word starts like a new
 * sentence: a capital, a digit, or an opening quote or bracket. So `“Well!” thought Alice` stays
 * one sentence, and common abbreviations (`Mr.`, `St.`, `e.g.`) and initials never end one.
 */

const END = /[.!?…]['"’”)\]]*$/u;
const STARTS_SENTENCE = /^['"‘“([]*[\p{Lu}\p{N}]/u;
const ABBREVIATIONS = new Set([
	'mr',
	'mrs',
	'ms',
	'dr',
	'st',
	'mt',
	'jr',
	'sr',
	'prof',
	'rev',
	'gen',
	'col',
	'capt',
	'lt',
	'vs',
	'etc',
	'e.g',
	'i.e',
	'no',
	'vol',
	'ch'
]);

function endsSentence(word: string, next: string | undefined): boolean {
	if (!END.test(word)) return false;
	const bare = word
		.replace(/['"’”)\]]+$/u, '')
		.replace(/^['"‘“([]+/u, '')
		.toLowerCase();
	if (bare.endsWith('.')) {
		const stem = bare.slice(0, -1);
		// "Mr." and "e.g." and an initial like "J." never end a sentence.
		if (ABBREVIATIONS.has(stem) || /^\p{L}$/u.test(stem)) return false;
	}
	// "Etc." can, but only when what follows starts like a sentence; so can anything else.
	return next === undefined || STARTS_SENTENCE.test(next);
}

/**
 * The sentences of a Chapter as `[first, last]` Word positions, in order and covering every Word.
 * `blocks[i]` is the i-th Word's Block.
 */
export function sentenceSpans(
	texts: readonly string[],
	blocks: readonly number[]
): [first: number, last: number][] {
	const spans: [number, number][] = [];
	let start = 0;
	for (let i = 0; i < texts.length; i++) {
		const last = i === texts.length - 1;
		if (last || blocks[i + 1] !== blocks[i] || endsSentence(texts[i]!, texts[i + 1])) {
			spans.push([start, i]);
			start = i + 1;
		}
	}
	return spans;
}

/** The position in `spans` of the sentence holding Word `i` (binary search), or -1. */
export function sentenceAt(spans: readonly [number, number][], i: number): number {
	let lo = 0;
	let hi = spans.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const [first, last] = spans[mid]!;
		if (i < first) hi = mid - 1;
		else if (i > last) lo = mid + 1;
		else return mid;
	}
	return -1;
}
