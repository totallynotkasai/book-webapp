/**
 * Words ↔ DOM for one loaded Chapter (ADR-002, option B): Blocks carry `data-b`, and the word
 * index gives each Word's Block and its offsets into the Block's *own* text: the text nodes whose
 * nearest `[data-b]` ancestor is that Block, outside svg, math and anything we injected. This is
 * the same rule `text-pipeline` used to write the offsets.
 *
 * Positions map back to Words by binary search over the Chapter's Words, which are in document
 * order. This is the engine's "Locator" side: DOM Ranges never leave reader-core.
 */
import type {
	ChapterRecord,
	PointAnchor,
	RangeAnchor,
	RevisionManifest,
	TextQuote,
	WordIndex
} from '@book/core';

/** Text inside these is never part of a Block's own text. */
const SKIP = 'svg, math, [data-injected]';
const QUOTE_CONTEXT = 32;

interface BlockText {
	el: Element;
	nodes: { node: Text; start: number }[];
	length: number;
	/** False when the DOM text doesn't match the index (ADR-002 integrity check). */
	ok: boolean;
}

/** A Chapter's word index with lookups by WordId and Ordinal. */
export class ChapterWords {
	#byId: Map<number, number> | undefined;

	constructor(
		readonly manifest: RevisionManifest,
		readonly chapter: ChapterRecord,
		readonly index: WordIndex
	) {}

	get count(): number {
		return this.index.words.length;
	}

	ordinalAt(i: number): number {
		return this.index.firstOrdinal + i;
	}

	/** Position in this Chapter of an Ordinal, or -1 when it's in another Chapter. */
	indexOfOrdinal(ordinal: number): number {
		const i = ordinal - this.index.firstOrdinal;
		return i >= 0 && i < this.count ? i : -1;
	}

	indexOfWordId(wordId: number): number {
		this.#byId ??= new Map(this.index.words.map(([id], i) => [id, i]));
		return this.#byId.get(wordId) ?? -1;
	}

	wordIdAt(i: number): number {
		return this.index.words[i]![0];
	}
}

/** a ≤ b in document order? (-1 before, 0 same point, 1 after) */
function comparePoints(doc: Document, aNode: Node, aOffset: number, bNode: Node, bOffset: number) {
	const range = doc.createRange();
	range.setStart(aNode, aOffset);
	return -range.comparePoint(bNode, bOffset);
}

export class DocWordMap {
	readonly doc: Document;
	readonly words: ChapterWords;
	#blocks = new Map<number, BlockText>();

	constructor(doc: Document, words: ChapterWords) {
		this.doc = doc;
		this.words = words;
	}

	/** The Block's own text nodes with their start offsets, computed once per document. */
	#block(b: number): BlockText | null {
		let block = this.#blocks.get(b);
		if (block) return block;
		const el = this.doc.querySelector(`[data-b="${b}"]`);
		if (!el) return null;
		const nodes: BlockText['nodes'] = [];
		const walker = this.doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
		let length = 0;
		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			const parent = node.parentElement;
			if (!parent || parent.closest('[data-b]') !== el || parent.closest(SKIP)) continue;
			nodes.push({ node, start: length });
			length += node.data.length;
		}
		const expected = this.words.index.blocks.find((x) => x.b === b);
		block = { el, nodes, length, ok: !expected || expected.len === length };
		this.#blocks.set(b, block);
		return block;
	}

	/** Blocks whose text doesn't match the index; their Words fall back to text search. */
	mismatchedBlocks(): number[] {
		return this.words.index.blocks.filter((x) => !this.#block(x.b)?.ok).map((x) => x.b);
	}

	#point(block: BlockText, offset: number): [Text, number] | null {
		const nodes = block.nodes;
		for (let i = nodes.length - 1; i >= 0; i--) {
			const n = nodes[i]!;
			if (offset >= n.start) return [n.node, Math.min(offset - n.start, n.node.data.length)];
		}
		return null;
	}

	/** The DOM Range of the i-th Word of the Chapter. */
	range(i: number): Range | null {
		const entry = this.words.index.words[i];
		if (!entry) return null;
		const [, b, start, end] = entry;
		const block = this.#block(b);
		if (!block) return null;
		// A drifted Block (text not as indexed) still maps, clamped to its text; callers can
		// check mismatchedBlocks() and recover Anchors by their quote instead (ADR-002).
		const s = Math.min(start, block.length);
		const e = Math.min(end, block.length);
		const from = this.#point(block, s);
		const to = this.#point(block, e);
		if (!from || !to) return null;
		const range = this.doc.createRange();
		range.setStart(from[0], from[1]);
		range.setEnd(to[0], to[1]);
		return range;
	}

	text(i: number): string {
		return this.range(i)?.toString() ?? '';
	}

	/** A Block's own text as one string: the word index's offsets count into it. */
	blockText(b: number): string {
		return (
			this.#block(b)
				?.nodes.map((n) => n.node.data)
				.join('') ?? ''
		);
	}

	/**
	 * Every Word with the punctuation it carries on the page: opening quotes and brackets before
	 * it, closing punctuation after it (`“Well!”`), so sentences can be found (§8.3) and spoken.
	 * The text between two Words in a Block is split at its spaces: up to the first belongs to the
	 * Word before, after the last to the Word after; with no space, all of it to the Word before.
	 */
	punctuatedTexts(): string[] {
		const words = this.words.index.words;
		const texts: string[] = [];
		let current = -1;
		let text = '';
		for (let i = 0; i < words.length; i++) {
			const [, b, start, end] = words[i]!;
			if (b !== current) {
				current = b;
				text = this.blockText(b);
			}
			const prev = words[i - 1];
			const next = words[i + 1];
			const first = !prev || prev[1] !== b;
			const before = text.slice(first ? 0 : prev[3], start);
			const after = text.slice(end, next && next[1] === b ? next[2] : text.length);
			const space = /\s/u.test(before);
			const lead = space ? /\S*$/u.exec(before)![0] : first ? before : '';
			const trail = /^\S*/u.exec(after)![0];
			texts.push(lead + text.slice(start, end) + trail);
		}
		return texts;
	}

	/** The Block element holding the i-th Word (figures go after it, §8.2). */
	blockElement(i: number): Element | null {
		const entry = this.words.index.words[i];
		return entry ? (this.#block(entry[1])?.el ?? null) : null;
	}

	/** Index of the first Word that ends after the point (the Word at or after it), or -1. */
	firstWordFrom(node: Node, offset: number): number {
		let lo = 0;
		let hi = this.words.count - 1;
		let found = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const range = this.range(mid);
			if (!range) return -1;
			// Word end after the point?
			if (comparePoints(this.doc, node, offset, range.endContainer, range.endOffset) < 0) {
				found = mid;
				hi = mid - 1;
			} else lo = mid + 1;
		}
		return found;
	}

	/** Index of the last Word that starts before the point (the Word at or before it), or -1. */
	lastWordBefore(node: Node, offset: number): number {
		let lo = 0;
		let hi = this.words.count - 1;
		let found = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const range = this.range(mid);
			if (!range) return -1;
			if (comparePoints(this.doc, range.startContainer, range.startOffset, node, offset) < 0) {
				found = mid;
				lo = mid + 1;
			} else hi = mid - 1;
		}
		return found;
	}

	/** The Word containing a point, if any (a tap on a Word). */
	wordAt(node: Node, offset: number): number {
		const i = this.firstWordFrom(node, offset);
		if (i < 0) return -1;
		const range = this.range(i)!;
		return comparePoints(this.doc, range.startContainer, range.startOffset, node, offset) <= 0
			? i
			: -1;
	}

	/** A selection snapped to whole Words (Invariant 5), as first and last Word indexes. */
	snap(range: Range): [number, number] | null {
		if (range.collapsed) return null;
		const first = this.firstWordFrom(range.startContainer, range.startOffset);
		const last = this.lastWordBefore(range.endContainer, range.endOffset);
		if (first < 0 || last < 0 || last < first) return null;
		return [first, last];
	}

	/** A Range from the start of one Word to the end of another. */
	rangeBetween(first: number, last: number): Range | null {
		const a = this.range(first);
		const b = this.range(last);
		if (!a || !b) return null;
		const range = this.doc.createRange();
		range.setStart(a.startContainer, a.startOffset);
		range.setEnd(b.endContainer, b.endOffset);
		return range;
	}

	/** Up to 32 characters of Words before and after, joined by spaces (W3C TextQuoteSelector). */
	quote(first: number, last: number): TextQuote {
		const exact =
			first === last
				? this.text(first)
				: (this.rangeBetween(first, last)?.toString() ?? '').replace(/\s+/g, ' ').trim();
		let prefix = '';
		for (let i = first - 1; i >= 0 && prefix.length < QUOTE_CONTEXT; i--) {
			prefix = `${this.text(i)} ${prefix}`;
		}
		let suffix = '';
		for (let i = last + 1; i < this.words.count && suffix.length < QUOTE_CONTEXT; i++) {
			suffix = `${suffix} ${this.text(i)}`;
		}
		return {
			exact,
			prefix: prefix.trimEnd().slice(-QUOTE_CONTEXT),
			suffix: suffix.trimStart().slice(0, QUOTE_CONTEXT)
		};
	}

	pointAnchor(i: number): PointAnchor {
		const { manifest } = this.words;
		return {
			kind: 'point',
			bookId: manifest.bookId,
			revisionId: manifest.revisionId,
			wordId: this.words.wordIdAt(i),
			ordinal: this.words.ordinalAt(i),
			quote: this.quote(i, i)
		};
	}

	rangeAnchor(first: number, last: number): RangeAnchor {
		const { manifest } = this.words;
		return {
			kind: 'range',
			bookId: manifest.bookId,
			revisionId: manifest.revisionId,
			startWordId: this.words.wordIdAt(first),
			endWordId: this.words.wordIdAt(last),
			startOrdinal: this.words.ordinalAt(first),
			endOrdinal: this.words.ordinalAt(last),
			quote: this.quote(first, last)
		};
	}
}
