// SPIKE (P0-04/P0-05): throwaway. The surface both candidate engines implement for the side-by-side
// page. It is deliberately smaller than DESIGN.md §9.1's ReaderEngine; P1-RDR-01 builds that.
import type { SpikePublication } from './publication';

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

/** A Word's box in the top-level viewport (frames may be nested inside shadow roots). */
function rectInTop(el: Element): DOMRect {
	const rect = el.getBoundingClientRect();
	let x = rect.left;
	let y = rect.top;
	let win: Window | null = el.ownerDocument.defaultView;
	while (win && win.frameElement) {
		const frameRect = win.frameElement.getBoundingClientRect();
		x += frameRect.left;
		y += frameRect.top;
		win = win.parent;
	}
	return new DOMRect(x, y, rect.width, rect.height);
}

/**
 * Finds the first and last Word on screen by binary search over the Word spans (they are in
 * reading order, and on-screen Words are contiguous). Needs `data-w` spans (P0-05 option A);
 * option B would walk the word index instead.
 */
export function findVisibleWords(
	doc: Document,
	viewport: DOMRect,
	scroll: boolean,
	sectionIndex: number
): VisibleWords | null {
	const words = doc.querySelectorAll<HTMLElement>('[data-w]');
	if (words.length === 0) return null;
	const at = (i: number) => classify(rectInTop(words[i]!), viewport, scroll);

	let lo = 0;
	let hi = words.length - 1;
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
	hi = words.length - 1;
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
	const id = (i: number) => Number(words[i]!.dataset.w);
	return {
		sectionIndex,
		first: id(firstIndex),
		last: id(lastIndex),
		count: lastIndex - firstIndex + 1
	};
}

const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, table, figure, div';

/** Snaps a DOM selection to whole Words (Invariant 5) using the Word spans. */
export function selectionToWords(doc: Document): SpikeSelection | null {
	const selection = doc.getSelection();
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	const words = [...doc.querySelectorAll<HTMLElement>('[data-w]')].filter((w) =>
		range.intersectsNode(w)
	);
	if (words.length === 0) return null;
	return {
		text: selection.toString(),
		startWordId: Number(words[0]!.dataset.w),
		endWordId: Number(words[words.length - 1]!.dataset.w)
	};
}

/** Inserts a figure after the Block containing a Word. Returns false if the Word isn't here. */
export function insertFigure(
	doc: Document,
	afterWordId: number,
	src: string,
	alt: string
): boolean {
	const word = doc.querySelector(`[data-w="${afterWordId}"]`);
	const block = word?.closest(BLOCKS);
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
export function paintHighlight(doc: Document, from: number, to: number, name = 'spike'): boolean {
	const win = doc.defaultView as (Window & typeof globalThis) | null;
	const start = doc.querySelector(`[data-w="${from}"]`);
	const end = doc.querySelector(`[data-w="${to}"]`);
	if (!win || !start || !end || !('highlights' in win.CSS)) return false;
	const range = doc.createRange();
	range.setStartBefore(start);
	range.setEndAfter(end);
	win.CSS.highlights.set(name, new win.Highlight(range));
	if (!doc.getElementById('spike-highlight-style')) {
		const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
		style.id = 'spike-highlight-style';
		style.textContent = `::highlight(${name}) { background-color: rgb(255 214 0 / 0.55); color: inherit; }`;
		(doc.head ?? doc.documentElement).append(style);
	}
	return true;
}
