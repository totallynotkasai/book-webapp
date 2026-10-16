/**
 * Words as `chapterText` gives them (`“Well!”`, `Rabbit-`, `Hole`) put back into a line of text:
 * a space between them, except after a hyphen or dash that joined a Word to the next on the page
 * ("Rabbit-Hole", "mine—a"). Used for what the device voice says and a search result's context.
 */
const JOINS = /[-‐‑–—/]$/u;

/** What goes between a Word and the next one. */
export function gapAfter(text: string): string {
	return JOINS.test(text) ? '' : ' ';
}

export function joinWords(texts: readonly string[]): string {
	let line = '';
	for (let i = 0; i < texts.length; i++) {
		if (i > 0) line += gapAfter(texts[i - 1]!);
		line += texts[i];
	}
	return line;
}
