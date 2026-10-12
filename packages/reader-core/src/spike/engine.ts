// SPIKE (P0-04/P0-05): throwaway. The surface both candidate engines implement for the side-by-side
// page. It is deliberately smaller than DESIGN.md §9.1's ReaderEngine; P1-RDR-01 builds that.
import {
	BLOCK_SELECTOR,
	type SpikePublication,
	type SpikeSection,
	type WordEntry,
	type WordMarking
} from './publication';

export type SpikeLayout = 'paginated' | 'spread' | 'scroll';

export interface SpikeOptions {
	fontScale: number;
	layout: SpikeLayout;
}

export interface VisibleWords {
	sectionIndex: number;
	first: number | null;
	last: number | null;
	count: number;
}

export interface SpikeSelection {
	text: string;
	startWordId: number;
	endWordId: number;
}

export interface SpikeEngine {
	readonly name: string;
	mount(
		container: HTMLElement,
		publication: SpikePublication,
		options: SpikeOptions
	): Promise<void>;
	next(): Promise<void>;
	prev(): Promise<void>;
	goToSection(index: number): Promise<void>;
	setFontScale(scale: number): Promise<void>;
	setLayout(layout: SpikeLayout): Promise<void>;
	/** The Words currently on screen, worked out from the DOM. */
	visibleWords(): VisibleWords | null;
	/** Highlights Words `from`..`to` through the engine's decoration route. */
	highlight(from: number, to: number): void;
	clearHighlights(): void;
	/** Puts a <figure> after the Block holding `afterWordId`; returns pages in the section before/after. */
	injectFigure(
		afterWordId: number,
		src: string,
		alt: string
	): Promise<{ before: number; after: number }>;
	/** Jumps so a Word is on screen (how our adapter keeps the first visible Word, §9.1). */
	goToWord(wordId: number): Promise<void>;
	/** Highlights currently registered in the engine's frames (CSS Custom Highlight API). */
	highlightCount(): number;
	/** Pages (screens) in the current section. */
	pageCount(): number;
	/** Resolves on the next relocation (after a turn, re-layout or jump). */
	nextRelocate(): Promise<void>;
	onRelocate(callback: () => void): () => void;
	onSelection(callback: (selection: SpikeSelection | null) => void): () => void;
	/** The current section's document(s), for measurement. */
	documents(): Document[];
	destroy(): Promise<void>;
}

/** Two animation frames, so layout has settled. Falls back to a timer: hidden tabs pause rAF. */
export function frames(): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, 100);
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				clearTimeout(timer);
				resolve();
			})
		);
	});
}

/** Where a Word's box sits relative to the visible area: before (-1), on screen (0), after (1). */
function classify(rect: DOMRect, view: DOMRect, scroll: boolean): -1 | 0 | 1 {
	if (scroll) {
		if (rect.bottom <= view.top + 1) return -1;
		if (rect.top >= view.bottom - 1) return 1;
		return 0;
	}
	if (rect.right <= view.left + 1) return -1;
	if (rect.left >= view.right - 1) return 1;
	if (rect.bottom <= view.top + 1) return -1;
	if (rect.top >= view.bottom - 1) return 1;
	return 0;
}

/** A box in the top-level viewport (frames may be nested inside shadow roots). */
function rectInTop(target: Element | Range, doc: Document): DOMRect {
	const rect = target.getBoundingClientRect();
	let x = rect.left;
	let y = rect.top;
	let win: Window | null = doc.defaultView;
	while (win && win.frameElement) {
		const frameRect = win.frameElement.getBoundingClientRect();
		x += frameRect.left;
		y += frameRect.top;
		win = win.parent;
	}
	return new DOMRect(x, y, rect.width, rect.height);
}

/**
 * Finds Words in a section's document, whichever marking option it uses (P0-05):
 * A, a <span data-w> per Word; or B, data-b Blocks plus a word index of character offsets.
 */
export interface WordMap {
	readonly marking: WordMarking;
	/** WordIds in reading order. */
	readonly ids: readonly number[];
	range(doc: Document, id: number): Range | null;
	/** The Block element holding a Word. */
	block(doc: Document, id: number): Element | null;
	/** The Word's own text. */
	text(doc: Document, id: number): string;
}

const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, table, figure, div';

function spanMap(section: SpikeSection): WordMap {
	const ids = Array.from({ length: section.wordCount }, (_, i) => section.firstWordId + i);
	const span = (doc: Document, id: number) => doc.querySelector(`[data-w="${id}"]`);
	return {
		marking: 'spans',
		ids,
		range(doc, id) {
			const el = span(doc, id);
			if (!el) return null;
			const range = doc.createRange();
			range.selectNodeContents(el);
			return range;
		},
		block: (doc, id) => span(doc, id)?.closest(BLOCKS) ?? null,
		text: (doc, id) => span(doc, id)?.textContent ?? ''
	};
}

function offsetMap(section: SpikeSection): WordMap {
	const byId = new Map<number, WordEntry>(section.words.map((w) => [w.id, w]));
	// Per document and Block: the Block's own text nodes with their starting offsets.
	const cache = new WeakMap<Document, Map<number, { node: Text; start: number }[]>>();
	function nodesOf(doc: Document, block: number) {
		let blocks = cache.get(doc);
		if (!blocks) cache.set(doc, (blocks = new Map()));
		let nodes = blocks.get(block);
		if (!nodes) {
			nodes = [];
			const el = doc.querySelector(`[data-b="${block}"]`);
			if (el) {
				const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
				let start = 0;
				while (walker.nextNode()) {
					const node = walker.currentNode as Text;
					// Text in a nested Block belongs to that Block, as at indexing time.
					if (node.parentElement?.closest(BLOCK_SELECTOR) !== el) continue;
					if (node.parentElement?.closest('script, style, svg')) continue;
					nodes.push({ node, start });
					start += node.data.length;
				}
			}
			blocks.set(block, nodes);
		}
		return nodes;
	}
	function point(doc: Document, block: number, offset: number): [Text, number] | null {
		const nodes = nodesOf(doc, block);
		for (let i = nodes.length - 1; i >= 0; i--) {
			const n = nodes[i]!;
			if (offset >= n.start) return [n.node, Math.min(offset - n.start, n.node.data.length)];
		}
		return null;
	}
	return {
		marking: 'offsets',
		ids: section.words.map((w) => w.id),
		range(doc, id) {
			const word = byId.get(id);
			if (!word) return null;
			const start = point(doc, word.block, word.start);
			const end = point(doc, word.block, word.end);
			if (!start || !end) return null;
			const range = doc.createRange();
			range.setStart(...start);
			range.setEnd(...end);
			return range;
		},
		block(doc, id) {
			const word = byId.get(id);
			return word ? doc.querySelector(`[data-b="${word.block}"]`) : null;
		},
		text(doc, id) {
			return this.range(doc, id)?.toString() ?? '';
		}
	};
}

export function wordMap(publication: SpikePublication, sectionIndex: number): WordMap | null {
	const section = publication.sections[sectionIndex];
	if (!section || section.wordCount === 0) return null;
	if (publication.marking === 'spans') return spanMap(section);
	if (publication.marking === 'offsets') return offsetMap(section);
	return null;
}

/**
 * Finds the first and last Word on screen by binary search over the Words in reading order
 * (on-screen Words are contiguous), using each Word's Range box.
 */
export function findVisibleWords(
	doc: Document,
	map: WordMap,
	viewport: DOMRect,
	scroll: boolean,
	sectionIndex: number
): VisibleWords | null {
	const { ids } = map;
	if (ids.length === 0) return null;
	const at = (i: number) => {
		const range = map.range(doc, ids[i]!);
		return range ? classify(rectInTop(range, doc), viewport, scroll) : 1;
	};

	let lo = 0;
	let hi = ids.length - 1;
	let firstIndex = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const c = at(mid);
		if (c < 0) lo = mid + 1;
		else {
			if (c === 0) firstIndex = mid;
			hi = mid - 1;
		}
	}
	if (firstIndex < 0) return { sectionIndex, first: null, last: null, count: 0 };
	lo = firstIndex;
	hi = ids.length - 1;
	let lastIndex = firstIndex;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const c = at(mid);
		if (c > 0) hi = mid - 1;
		else {
			if (c === 0) lastIndex = mid;
			lo = mid + 1;
		}
	}
	return {
		sectionIndex,
		first: ids[firstIndex]!,
		last: ids[lastIndex]!,
		count: lastIndex - firstIndex + 1
	};
}

/** Snaps a DOM selection to whole Words (Invariant 5). */
export function selectionToWords(doc: Document, map: WordMap): SpikeSelection | null {
	const selection = doc.getSelection();
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
	const selected = selection.getRangeAt(0);
	// A Word counts if it ends after the selection starts and starts before the selection ends.
	const touches = (id: number) => {
		const word = map.range(doc, id);
		if (!word) return false;
		const endsAfterStart =
			selected.comparePoint(word.endContainer, word.endOffset) >= 0 &&
			!(word.endContainer === selected.startContainer && word.endOffset === selected.startOffset);
		const startsBeforeEnd =
			selected.comparePoint(word.startContainer, word.startOffset) <= 0 &&
			!(word.startContainer === selected.endContainer && word.startOffset === selected.endOffset);
		return endsAfterStart && startsBeforeEnd;
	};
	const hits = map.ids.filter(touches);
	if (hits.length === 0) return null;
	return {
		text: selection.toString(),
		startWordId: hits[0]!,
		endWordId: hits[hits.length - 1]!
	};
}

/** Inserts a figure after the Block containing a Word. Returns false if the Word isn't here. */
export function insertFigure(
	doc: Document,
	map: WordMap,
	afterWordId: number,
	src: string,
	alt: string
): boolean {
	const block = map.block(doc, afterWordId);
	if (!block) return false;
	const ns = 'http://www.w3.org/1999/xhtml';
	const figure = doc.createElementNS(ns, 'figure');
	figure.setAttribute('data-injected', '');
	figure.setAttribute('style', 'margin: 1em 0; text-align: center; break-inside: avoid;');
	const img = doc.createElementNS(ns, 'img');
	img.setAttribute('src', src);
	img.setAttribute('alt', alt);
	img.setAttribute('style', 'max-width: 100%; max-height: 80vh; height: auto;');
	const caption = doc.createElementNS(ns, 'figcaption');
	caption.textContent = alt;
	figure.append(img, caption);
	block.after(figure);
	return true;
}

/** Paints Words `from`..`to` with the CSS Custom Highlight API (no DOM changes, §9.1). */
export function paintHighlight(
	doc: Document,
	map: WordMap,
	from: number,
	to: number,
	name = 'spike'
): boolean {
	const win = doc.defaultView as (Window & typeof globalThis) | null;
	const start = map.range(doc, from);
	const end = map.range(doc, to);
	if (!win || !start || !end || !('highlights' in win.CSS)) return false;
	const range = doc.createRange();
	range.setStart(start.startContainer, start.startOffset);
	range.setEnd(end.endContainer, end.endOffset);
	win.CSS.highlights.set(name, new win.Highlight(range));
	if (!doc.getElementById('spike-highlight-style')) {
		const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
		style.id = 'spike-highlight-style';
		style.textContent = `::highlight(${name}) { background-color: rgb(255 214 0 / 0.55); color: inherit; }`;
		(doc.head ?? doc.documentElement).append(style);
	}
	return true;
}
