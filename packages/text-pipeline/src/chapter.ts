/**
 * One Chapter, after sanitising: mark Blocks, tokenise, assign WordIds and Ordinals, and build its
 * word index (DESIGN.md §7.1 steps 3–6, ADR-002).
 *
 * A Word belongs to its nearest Block. Offsets count the Block's *own* text: every text node whose
 * nearest Block ancestor is that Block, in document order, outside svg and math. `reader-core`
 * walks the browser's DOM of the serialised chapter by exactly the same rule (nearest `[data-b]`),
 * so the offsets line up; a per-Block length and hash catch any drift.
 */
import { BLOCK_TAGS, UNTOKENISED_TAGS, type WordIndexEntry } from '@book/core';
import { isElement, isText, localName, type Element, type Text } from './dom';
import { tokenise } from './tokenise';

const BLOCKS = new Set<string>(BLOCK_TAGS);
const UNTOKENISED = new Set<string>(UNTOKENISED_TAGS);

export interface MarkedChapter {
	/** `[wordId, block, start, end]` in reading order. */
	words: WordIndexEntry[];
	/** Each Block's own text, by Block index (for the integrity check). */
	blockTexts: string[];
	/** The text of each Word, in order (for quotes and titles). */
	wordTexts: string[];
	/** For each element id, the index (in `words`) of the first Word at or after it. */
	idWordIndex: Map<string, number>;
	/** The first heading's text, if any. */
	heading: string | null;
	nextWordId: number;
}

/** Marks Blocks with `data-b` in document order and tokenises the body. Mutates `body`. */
export function markChapter(body: Element, firstWordId: number): MarkedChapter {
	const blockTexts: string[] = [];
	const words: WordIndexEntry[] = [];
	const wordTexts: string[] = [];
	const idWordIndex = new Map<string, number>();
	const pendingIds: string[] = [];
	let heading: string | null = null;
	let nextWordId = firstWordId;

	const visit = (el: Element, block: number) => {
		const name = localName(el);
		if (UNTOKENISED.has(name)) {
			// No Words inside, but ids still point at the next Word.
			if (el.attribs.id) pendingIds.push(el.attribs.id);
			return;
		}
		let current = block;
		if (BLOCKS.has(name)) {
			current = blockTexts.length;
			blockTexts.push('');
			el.attribs['data-b'] = String(current);
		}
		if (el.attribs.id) pendingIds.push(el.attribs.id);
		const isHeading = heading === null && /^h[1-3]$/.test(name);
		const wordsBefore = words.length;
		for (const child of el.children) {
			if (isElement(child)) visit(child, current);
			else if (isText(child)) addText(child, current);
		}
		if (isHeading && words.length > wordsBefore) {
			heading = wordTexts.slice(wordsBefore).join(' ');
		}
	};

	const addText = (node: Text, block: number) => {
		const base = blockTexts[block]!.length;
		blockTexts[block] += node.data;
		for (const token of tokenise(node.data)) {
			for (const id of pendingIds.splice(0)) idWordIndex.set(id, words.length);
			words.push([nextWordId++, block, base + token.start, base + token.end]);
			wordTexts.push(node.data.slice(token.start, token.end));
		}
	};

	visit(body, 0);
	// Ids after the last Word point past the end; callers clamp to the Chapter.
	for (const id of pendingIds) idWordIndex.set(id, words.length);
	return { words, blockTexts, wordTexts, idWordIndex, heading, nextWordId };
}

const hex = (bytes: ArrayBuffer) =>
	Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/** The first 8 hex digits of SHA-256 of a Block's own text (ADR-002 integrity check). */
export async function blockHash(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return hex(digest).slice(0, 8);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	return hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}
