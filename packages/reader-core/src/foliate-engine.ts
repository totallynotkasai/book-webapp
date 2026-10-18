/**
 * `ReaderEngine` on foliate-js's paginator (ADR-001), pinned by git commit. We drive the paginator
 * directly rather than foliate's View, which tracks CFIs we never use (Invariant 2): our sections
 * come from text-pipeline output through the `ContentLoader`, positions come in and out as Anchors,
 * and highlights are painted with the CSS Custom Highlight API (no DOM changes, §9.1).
 */
import 'foliate-js/paginator.js';
import {
	chapterForOrdinal,
	type Anchor,
	type ChapterRecord,
	type LayoutMode,
	type PointAnchor,
	type RevisionManifest
} from '@book/core';
import { ChapterContent } from './content';
import type { CurlTurn, PageCurl } from './curl';
import { dragCommits, dragPose, easeOut } from './curl-geometry';
import { drawPage, pageStarts, type PageGeometry } from './pages';
import { BASE_CSS, MARGINS, themeCss, typographyCss } from './styles';
import { isSqueezed, TABLE_ROW, tableOfRow, tableRow, tableView } from './tables';
import type {
	ChapterPages,
	ChapterText,
	Decoration,
	EngineEvent,
	EngineEvents,
	EngineOptions,
	FigureInjection,
	PageDrawing,
	PageTurn,
	PublicationHandle,
	ReaderEngine,
	ReaderThemeTokens,
	TypographySettings,
	VisibleRange
} from './types';
import { ChapterWords, DocWordMap } from './word-map';

interface PaginatorSection {
	id: string;
	linear: 'yes' | 'no';
	size: number;
	load(): Promise<string>;
	unload(): void;
}

interface RelocateDetail {
	reason: string;
	range: Range;
	index: number;
	fraction?: number;
	size?: number;
}

/** The members of foliate-js's <foliate-paginator> the adapter uses. */
interface Paginator extends HTMLElement {
	open(book: { dir: string; sections: PaginatorSection[] }): void;
	goTo(target: { index: number; anchor?: (doc: Document) => Range | number | null }): Promise<void>;
	next(): Promise<void>;
	prev(): Promise<void>;
	setStyles(styles: [string, string]): void;
	getContents(): { index: number; doc: Document }[];
	destroy(): void;
	render(): void;
	/** Scrolls to an anchor and makes it the one re-layouts return to. */
	scrollToAnchor(anchor: Range | number, select?: boolean): Promise<void>;
	readonly page: number;
	/** The scroll offset of the visible area (pixels along the flow). */
	readonly start: number;
	readonly pages: number;
	/** A page's (or spread's) width along the flow. */
	readonly size: number;
	readonly scrolled: boolean;
	/** On the Book's first page, or its last: there's nothing to turn to. */
	readonly atStart: boolean;
	readonly atEnd: boolean;
}

/** A turn that's curling (P1-RDR-19): the curl on screen, and the paginator's move under it. */
interface CurlMove {
	turn: CurlTurn;
	dir: 1 | -1;
	/** The paginator's move, and the relocation it causes. */
	moved: Promise<void>;
	/** Where the reader was, to settle back to. */
	from: VisibleRange | null;
}

/** A finger on the page while the curl is on (P1-RDR-19). */
interface CurlTouch {
	id: number;
	start: { x: number; y: number; t: number };
	last: { x: number; y: number; t: number };
	/** Along x, in px/ms, smoothed. */
	velocity: number;
	dir?: 1 | -1;
	/** Set once the drag has become a turn. */
	move?: Promise<CurlMove | null>;
	/** No curl: a long press, a selection, or the end of the Book. */
	ignored?: boolean;
}

/** A Chapter's pages as overview mode measured them (P1-RDR-17). */
interface MeasuredPages {
	doc: Document;
	/** The geometry they were measured in: a change means measuring again. */
	key: string;
	geometry: PageGeometry;
	/** Each page's first Word, or -1. */
	starts: number[];
	punctuated?: string[];
}

type Listeners = { [E in EngineEvent]: Set<(payload: EngineEvents[E]) => void> };

/** Waits for layout to settle: two frames, or a timer when frames are paused (hidden tabs). */
function settle(): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, 120);
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				clearTimeout(timer);
				resolve();
			})
		);
	});
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A box in top-level coordinates (the frame sits inside foliate's shadow DOM). */
function toTop(rect: DOMRect, doc: Document): DOMRect {
	const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
	return frame
		? new DOMRect(rect.left + frame.left, rect.top + frame.top, rect.width, rect.height)
		: rect;
}

function caretPoint(doc: Document, x: number, y: number): [Node, number] | null {
	const d = doc as Document & {
		caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
	};
	const pos = d.caretPositionFromPoint?.(x, y);
	if (pos) return [pos.offsetNode, pos.offset];
	const range = d.caretRangeFromPoint?.(x, y);
	return range ? [range.startContainer, range.startOffset] : null;
}

export class FoliateEngine implements ReaderEngine {
	#paginator?: Paginator;
	#host?: HTMLElement;
	#manifest!: RevisionManifest;
	#content!: ChapterContent;
	#words = new Map<number, Promise<ChapterWords>>();
	#maps = new WeakMap<Document, DocWordMap>();
	#visible: VisibleRange | null = null;
	#typography!: TypographySettings;
	#theme: ReaderThemeTokens = {};
	#fontFaceCss = '';
	#layout: LayoutMode = 'paginated-single';
	#pageTurn: PageTurn = 'slide';
	#decorations = new Map<string, Decoration[]>();
	#figures: FigureInjection[] = [];
	#tableButton: EngineOptions['tableButton'];
	#listeners: Listeners = {
		relocated: new Set(),
		selection: new Set(),
		wordActivated: new Set(),
		contextMenu: new Set(),
		figureActivated: new Set(),
		tableActivated: new Set(),
		tap: new Set(),
		keydown: new Set(),
		externalLink: new Set(),
		pinch: new Set(),
		error: new Set()
	};
	#relocateWaiters: (() => void)[] = [];
	#lastRelocateAt = 0;
	/** The Word re-layouts keep on screen while changes overlap (a slider dragged quickly). */
	#pinned: PointAnchor | null = null;
	#adjusting = 0;
	#selectionTimer: ReturnType<typeof setTimeout> | undefined;
	/** The last selection reported, so an unchanged one isn't reported twice. */
	#lastSelection: string | null = null;
	#selectingByKeyboard = false;
	#destroyed = false;
	/** Set while following a link in the book, so the next relocation says so. */
	#linking = false;
	/** The pages overview mode last measured (P1-RDR-17), until the Chapter or layout changes. */
	#pages: MeasuredPages | null = null;
	/** The DOM range the paginator last said was visible (what the curl pictures). */
	#visibleDom: Range | null = null;
	/** The page curl (P1-RDR-19), loaded when the reader first chooses it; null if it can't draw. */
	#curl: PageCurl | null = null;
	#curlModule: typeof import('./curl') | null = null;
	#curlLoading: Promise<void> | null = null;
	#curlTouch: CurlTouch | null = null;
	/** The paginator's last move under a curl, until it's ready for another (it locks briefly). */
	#paginatorBusy: Promise<void> | null = null;
	/** Counts changes to what's on screen; a picture prepared at one version is good until the next. */
	#pageVersion = 0;
	#prepared: { snapshot: import('./snapshot').PageSnapshot; version: number } | null = null;
	#abort = new AbortController();
	/** While a finger holds a turn, relocations wait: a turn settled back never happened. */
	#holding = false;
	#held: VisibleRange | null = null;
	#warmTimer: ReturnType<typeof setTimeout> | undefined;

	#emit<E extends EngineEvent>(event: E, payload: EngineEvents[E]) {
		for (const cb of this.#listeners[event]) cb(payload);
	}

	on<E extends EngineEvent>(event: E, cb: (payload: EngineEvents[E]) => void): () => void {
		this.#listeners[event].add(cb);
		return () => this.#listeners[event].delete(cb);
	}

	// ---- loading ----

	#chapterWords(index: number): Promise<ChapterWords> {
		let words = this.#words.get(index);
		if (!words) {
			const chapter = this.#manifest.chapters[index]!;
			words = this.#content
				.wordIndex(chapter.chapterId)
				.then((wordIndex) => new ChapterWords(this.#manifest, chapter, wordIndex));
			this.#words.set(index, words);
		}
		return words;
	}

	async #map(doc: Document, index: number): Promise<DocWordMap> {
		let map = this.#maps.get(doc);
		if (!map) {
			map = new DocWordMap(doc, await this.#chapterWords(index));
			this.#maps.set(doc, map);
			const drifted = map.mismatchedBlocks();
			if (drifted.length) {
				console.warn(
					`Blocks ${drifted.join(', ')} of ${map.words.chapter.chapterId} don’t match their index (ADR-002).`
				);
			}
		}
		return map;
	}

	#current(): { doc: Document; index: number } | null {
		return this.#paginator?.getContents()[0] ?? null;
	}

	async mount(el: HTMLElement, publication: PublicationHandle, opts: EngineOptions): Promise<void> {
		this.#manifest = publication.manifest;
		this.#content = new ChapterContent(publication.loader);
		this.#typography = opts.typography;
		this.#theme = opts.theme;
		this.#fontFaceCss = opts.fontFaceCss;
		this.#tableButton = opts.tableButton;
		this.#host = el;

		const paginator = document.createElement('foliate-paginator') as Paginator;
		paginator.style.cssText = 'display:block;width:100%;height:100%';
		el.append(paginator);
		this.#paginator = paginator;
		paginator.addEventListener(
			'relocate',
			(e) => void this.#onRelocate((e as CustomEvent<RelocateDetail>).detail)
		);
		paginator.addEventListener('load', (e) => {
			const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
			void this.#onLoad(doc, index);
		});
		this.#watchCurlTouches(el, () => null);
		// A new window size lays the pages out again: a curl in progress ends.
		window.addEventListener(
			'resize',
			() => {
				this.#endCurl();
				this.#pageChanged();
			},
			{ signal: this.#abort.signal }
		);

		paginator.open({
			dir: this.#manifest.dir,
			sections: this.#manifest.chapters.map((chapter) => ({
				id: chapter.chapterId,
				linear: chapter.linear ? 'yes' : 'no',
				size: Math.max(1, chapter.wordCount * 6),
				load: () => this.#content.chapterUrl(chapter.href),
				unload: () => {}
			}))
		});
		this.#applyStyles();
		this.#applyLayoutAttributes(opts.layout);
		this.setPageTurn(opts.pageTurn);

		const start = opts.start ?? {
			chapterId:
				this.#manifest.chapters.find((c) => c.linear && c.wordCount > 0)?.chapterId ??
				this.#manifest.chapters[0]!.chapterId
		};
		await this.goTo(start);
	}

	destroy(): void {
		this.#destroyed = true;
		this.#abort.abort();
		clearTimeout(this.#warmTimer);
		this.#curl?.destroy();
		this.#curl = null;
		this.#paginator?.destroy();
		this.#paginator?.remove();
		this.#content?.release();
		for (const set of Object.values(this.#listeners)) set.clear();
	}

	async #onLoad(doc: Document, index: number) {
		const map = await this.#map(doc, index);
		this.#paintDecorations(doc, map);
		this.#placeFigures(doc, map);
		this.#watchTables(doc);

		// foliate-js scrolls to whatever gains focus, so Tab can reach a link on another page. A
		// click into the book focuses its <body>, which would jump back to the Chapter's first page.
		doc.addEventListener(
			'focusin',
			(event) => {
				if (event.target === doc.body || event.target === doc.documentElement) {
					event.stopPropagation();
				}
			},
			true
		);

		// A mouse selection is reported when the button comes up; a touch selection (whose native
		// handles send no pointer events) once it has been still for a moment.
		let mouseDown = false;
		let pointer: 'mouse' | 'touch' | 'pen' = 'mouse';
		// Mouse drags select through our own code. In Chromium, on any page but a Chapter's first,
		// a native drag inside foliate-js's scrolled view loses its starting point and leaves only
		// a caret. Double- and triple-clicks stay native (word, paragraph); Shift+click extends.
		let dragFrom: [Node, number] | null = null;
		doc.addEventListener('mousedown', (event) => {
			if (event.button !== 0 || event.detail > 1 || pointer !== 'mouse') return;
			if ((event.target as Element | null)?.closest?.(`a[href], [${TABLE_ROW}]`)) return;
			const point = caretPoint(doc, event.clientX, event.clientY);
			const selection = doc.getSelection();
			if (!point || !selection) return;
			event.preventDefault();
			if (event.shiftKey && selection.rangeCount && selection.anchorNode) {
				selection.setBaseAndExtent(
					selection.anchorNode,
					selection.anchorOffset,
					point[0],
					point[1]
				);
				dragFrom = [selection.anchorNode, selection.anchorOffset];
				return;
			}
			selection.removeAllRanges();
			dragFrom = point;
		});
		doc.addEventListener('mousemove', (event) => {
			if (!dragFrom || !(event.buttons & 1)) return;
			const point = caretPoint(doc, event.clientX, event.clientY);
			if (point) doc.getSelection()?.setBaseAndExtent(dragFrom[0], dragFrom[1], point[0], point[1]);
		});
		doc.addEventListener('mouseup', () => (dragFrom = null));
		doc.addEventListener('pointerdown', (event) => {
			pointer =
				event.pointerType === 'touch' || event.pointerType === 'pen' ? event.pointerType : 'mouse';
			mouseDown = pointer === 'mouse' && event.button === 0;
		});
		doc.addEventListener('pointerup', () => {
			if (!mouseDown) return;
			mouseDown = false;
			clearTimeout(this.#selectionTimer);
			this.#selectionTimer = setTimeout(() => this.#onSelection(doc, map, pointer), 0);
		});
		doc.addEventListener('selectionchange', () => {
			clearTimeout(this.#selectionTimer);
			if (mouseDown) return;
			const wait = this.#selectingByKeyboard ? 0 : pointer === 'mouse' ? 120 : 250;
			this.#selectionTimer = setTimeout(() => this.#onSelection(doc, map, pointer), wait);
		});
		doc.addEventListener('click', (event) => this.#onClick(event, doc, map));
		doc.addEventListener('contextmenu', (event) => {
			const selection = doc.getSelection();
			const snapped =
				selection && selection.rangeCount && !selection.isCollapsed
					? map.snap(selection.getRangeAt(0))
					: null;
			const point = caretPoint(doc, event.clientX, event.clientY);
			const i = point ? map.wordAt(point[0], point[1]) : -1;
			const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
			this.#emit('contextMenu', {
				anchor: snapped ? map.rangeAnchor(...snapped) : null,
				word: i >= 0 ? map.pointAnchor(i) : null,
				x: event.clientX + (frame?.left ?? 0),
				y: event.clientY + (frame?.top ?? 0),
				pointer,
				preventDefault: () => event.preventDefault()
			});
		});
		doc.addEventListener('keydown', (event) => this.#emit('keydown', event));
		this.#watchPinch(doc);
		const win = doc.defaultView;
		if (win) this.#watchCurlTouches(win, () => win.frameElement?.getBoundingClientRect() ?? null);
		// A picture arriving changes the page without moving it.
		doc.addEventListener('load', () => this.#pageChanged(), true);
		this.#pageChanged();
	}

	/** Pinch and Ctrl+wheel change the text size rather than zooming the page (§4.1). */
	#watchPinch(doc: Document) {
		doc.documentElement.style.setProperty('touch-action', 'pan-x pan-y');
		let start = 0;
		let scale = 1;
		const distance = (t: TouchList) =>
			Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
		doc.addEventListener('touchstart', (event) => {
			if (event.touches.length === 2) {
				start = distance(event.touches);
				scale = 1;
			}
		});
		doc.addEventListener(
			'touchmove',
			(event) => {
				if (event.touches.length !== 2 || !start) return;
				event.preventDefault();
				scale = distance(event.touches) / start;
				this.#emit('pinch', { scale, done: false });
			},
			{ passive: false }
		);
		doc.addEventListener('touchend', () => {
			if (!start) return;
			start = 0;
			this.#emit('pinch', { scale, done: true });
		});
		doc.addEventListener(
			'wheel',
			(event) => {
				if (!event.ctrlKey) return;
				event.preventDefault();
				this.#emit('pinch', { scale: event.deltaY < 0 ? 1.1 : 1 / 1.1, done: true });
			},
			{ passive: false }
		);
	}

	#onSelection(doc: Document, map: DocWordMap, pointer: 'mouse' | 'touch' | 'pen') {
		const keyboard = this.#selectingByKeyboard;
		this.#selectingByKeyboard = false;
		const selection = doc.getSelection();
		const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
		const snapped = range && !range.collapsed ? map.snap(range) : null;
		if (!selection || !range || !snapped) {
			if (this.#lastSelection !== null) this.#emit('selection', null);
			this.#lastSelection = null;
			return;
		}
		// Show a mouse selection as whole Words too, not only report it that way (Invariant 5). Not
		// on touch: a selection set from script loses Android's handles and menu, and long-press
		// already selects by Word there (ADR-004 check 5).
		const words = map.rangeBetween(...snapped);
		if (
			pointer === 'mouse' &&
			!keyboard &&
			words &&
			(range.compareBoundaryPoints(Range.START_TO_START, words) !== 0 ||
				range.compareBoundaryPoints(Range.END_TO_END, words) !== 0)
		) {
			selection.removeAllRanges();
			selection.addRange(words);
		}
		const anchor = map.rangeAnchor(...snapped);
		const key = `${anchor.startOrdinal}-${anchor.endOrdinal}`;
		if (key === this.#lastSelection) return;
		this.#lastSelection = key;
		this.#emit('selection', {
			anchor,
			text: (words ?? range).toString(),
			clientRect: toTop((words ?? range).getBoundingClientRect(), doc),
			pointer: keyboard ? 'keyboard' : pointer
		});
	}

	select(anchor: { startOrdinal: number; endOrdinal: number } | null): void {
		const current = this.#current();
		const map = current && this.#maps.get(current.doc);
		const selection = current?.doc.getSelection();
		if (!current || !map || !selection) return;
		if (!anchor) {
			selection.removeAllRanges();
			return;
		}
		const first = map.words.indexOfOrdinal(anchor.startOrdinal);
		const last = map.words.indexOfOrdinal(anchor.endOrdinal);
		const range = first >= 0 && last >= 0 ? map.rangeBetween(first, last) : null;
		if (!range) return;
		this.#selectingByKeyboard = true;
		selection.removeAllRanges();
		selection.addRange(range);
	}

	rectOf(anchor: Anchor): DOMRect | null {
		const current = this.#current();
		const map = current && this.#maps.get(current.doc);
		if (!current || !map || anchor.revisionId !== this.#manifest.revisionId) return null;
		const first = map.words.indexOfOrdinal(
			anchor.kind === 'point' ? anchor.ordinal : anchor.startOrdinal
		);
		const last = map.words.indexOfOrdinal(
			anchor.kind === 'point' ? anchor.ordinal : anchor.endOrdinal
		);
		const range = first >= 0 && last >= 0 ? map.rangeBetween(first, last) : null;
		if (!range) return null;
		// Only the parts on screen: a range can run on to the next page.
		const host = this.#host?.getBoundingClientRect();
		const rects = [...range.getClientRects()]
			.map((r) => toTop(r, current.doc))
			.filter((r) => r.width > 0 && (!host || (r.right > host.left && r.left < host.right)));
		if (!rects.length) return null;
		const left = Math.min(...rects.map((r) => r.left));
		const top = Math.min(...rects.map((r) => r.top));
		const right = Math.max(...rects.map((r) => r.right));
		const bottom = Math.max(...rects.map((r) => r.bottom));
		return new DOMRect(left, top, right - left, bottom - top);
	}

	#onClick(event: MouseEvent, doc: Document, map: DocWordMap) {
		const target = event.target as Element | null;
		const figure = target?.closest?.('figure[data-injected]');
		if (figure) {
			this.#emit('figureActivated', { id: figure.getAttribute('data-injected')! });
			return;
		}
		const open = target?.closest?.(`[${TABLE_ROW}] button`);
		if (open) {
			const table = open.parentElement && tableOfRow(open.parentElement);
			if (table) this.#emit('tableActivated', tableView(table, document));
			return;
		}
		const link = target?.closest?.('a[href]');
		if (link) {
			event.preventDefault();
			void this.#followLink(link.getAttribute('href')!, map);
			return;
		}
		if (!doc.getSelection()?.isCollapsed) return;
		const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
		const point = caretPoint(doc, event.clientX, event.clientY);
		const i = point ? map.wordAt(point[0], point[1]) : -1;
		if (i >= 0) {
			const rect = map.range(i)?.getBoundingClientRect();
			this.#emit('wordActivated', {
				wordId: map.words.wordIdAt(i),
				anchor: map.pointAnchor(i),
				clientRect: rect ? toTop(rect, doc) : new DOMRect(event.clientX, event.clientY, 0, 0)
			});
		}
		this.#emit('tap', {
			x: event.clientX + (frame?.left ?? 0),
			y: event.clientY + (frame?.top ?? 0)
		});
	}

	async #followLink(href: string, map: DocWordMap) {
		if (/^(https?:|mailto:)/i.test(href)) {
			this.#emit('externalLink', { href });
			return;
		}
		const base = `content/${map.words.chapter.href}`;
		let path: string;
		let fragment: string | null;
		try {
			const url = new URL(href, `https://book.invalid/${base}`);
			path = decodeURIComponent(url.pathname.slice(1)).replace(/^content\//, '');
			fragment = url.hash ? decodeURIComponent(url.hash.slice(1)) : null;
		} catch {
			return;
		}
		const index = this.#manifest.chapters.findIndex((c) => c.href === path);
		if (index < 0) return;
		this.#linking = true;
		await this.#paginator!.goTo({
			index,
			anchor: (doc) => {
				if (!fragment) return 0;
				const el = doc.getElementById(fragment);
				if (!el) return 0;
				const range = doc.createRange();
				range.selectNode(el);
				return range;
			}
		});
	}

	// ---- position ----

	async #onRelocate(detail: RelocateDetail) {
		this.#visibleDom = detail.range;
		this.#pageChanged();
		const current = this.#current();
		if (!current || this.#destroyed) return;
		const map = await this.#map(current.doc, detail.index);
		const range = detail.range;
		let first = map.firstWordFrom(range.startContainer, range.startOffset);
		let last = map.lastWordBefore(range.endContainer, range.endOffset);
		const words = map.words;
		if (first < 0 && last < 0) {
			// A page without Words (an illustration, a blank end page): use the nearest Word.
			first = last = words.count
				? detail.fraction && detail.fraction > 0.5
					? words.count - 1
					: 0
				: -1;
		}
		if (first < 0) first = last;
		if (last < 0 || last < first) last = first;
		if (this.#paginator!.scrolled) first = this.#edgeLineStart(map, first);
		if (first < 0) {
			// An empty Chapter (a cover page): position at the next Word in the Book.
			this.#visible = null;
			return this.#flushWaiters();
		}
		const firstAnchor = map.pointAnchor(first);
		const total = Math.max(1, this.#manifest.wordCount - 1);
		const p = this.#paginator!;
		this.#visible = {
			chapterId: words.chapter.chapterId,
			first: firstAnchor,
			last: map.pointAnchor(last),
			progression: Math.min(1, firstAnchor.ordinal / total),
			pageInChapter:
				p.scrolled || p.pages <= 2
					? undefined
					: { index: Math.max(0, p.page - 1), count: Math.max(1, p.pages - 2) },
			cause: this.#linking
				? 'link'
				: detail.reason === 'page' || detail.reason === 'snap'
					? 'turn'
					: detail.reason === 'scroll'
						? 'scroll'
						: 'navigation'
		};
		this.#linking = false;
		this.#lastRelocateAt = performance.now();
		if (this.#holding) this.#held = this.#visible;
		else this.#emit('relocated', this.#visible);
		this.#flushWaiters();
	}

	/**
	 * foliate-js counts a line that starts exactly at the top edge as hidden (its test is strict),
	 * so after scrolling to a Word it reports the next line first. Step back over Words that are
	 * on screen.
	 */
	#edgeLineStart(map: DocWordMap, first: number): number {
		const top = this.#paginator!.start - 1;
		while (first > 0) {
			const rect = map.range(first - 1)?.getBoundingClientRect();
			if (!rect || rect.height === 0 || rect.top < top) break;
			first--;
		}
		return first;
	}

	/** Resolves once no relocation has happened for `quietMs` (or after `maxMs`). */
	async #quiet(quietMs = 200, maxMs = 1500) {
		const started = performance.now();
		await settle();
		while (performance.now() - started < maxMs) {
			const since = performance.now() - this.#lastRelocateAt;
			if (since >= quietMs) return;
			await new Promise((r) => setTimeout(r, quietMs - since));
		}
	}

	#flushWaiters() {
		const waiters = this.#relocateWaiters.splice(0);
		for (const resolve of waiters) resolve();
	}

	#nextRelocate(timeout = 1500): Promise<void> {
		return new Promise((resolve) => {
			const timer = setTimeout(resolve, timeout);
			this.#relocateWaiters.push(() => {
				clearTimeout(timer);
				resolve();
			});
		});
	}

	getVisibleRange(): VisibleRange | null {
		return this.#visible;
	}

	#chapterOf(ordinal: number): number {
		const chapter = chapterForOrdinal(this.#manifest.chapters, ordinal);
		if (chapter) return this.#manifest.chapters.indexOf(chapter);
		// Past the end: the last Chapter with Words.
		const chapters: ChapterRecord[] = this.#manifest.chapters;
		for (let i = chapters.length - 1; i >= 0; i--) if (chapters[i]!.wordCount > 0) return i;
		return 0;
	}

	async goTo(target: Anchor | { progression: number } | { chapterId: string }): Promise<void> {
		const paginator = this.#paginator;
		if (!paginator) return;
		// A jump never curls: any turn still curling ends where it is.
		this.#endCurl();
		let ordinal: number | null = null;
		let index: number;
		if ('chapterId' in target) {
			index = Math.max(
				0,
				this.#manifest.chapters.findIndex((c) => c.chapterId === target.chapterId)
			);
		} else if ('progression' in target) {
			ordinal = Math.round(
				Math.min(1, Math.max(0, target.progression)) * Math.max(0, this.#manifest.wordCount - 1)
			);
			index = this.#chapterOf(ordinal);
		} else {
			if (target.revisionId !== this.#manifest.revisionId) {
				throw new Error('This Anchor belongs to another Revision; migrate it first (§6.2).');
			}
			ordinal = target.kind === 'point' ? target.ordinal : target.startOrdinal;
			index = this.#chapterOf(ordinal);
		}
		const words = await this.#chapterWords(index);
		const relocated = this.#nextRelocate();
		await paginator.goTo({
			index,
			anchor: (doc) => {
				if (ordinal === null) return 0;
				const i = words.indexOfOrdinal(ordinal);
				if (i < 0) return 0;
				let map = this.#maps.get(doc);
				if (!map) {
					map = new DocWordMap(doc, words);
					this.#maps.set(doc, map);
				}
				return map.range(i);
			}
		});
		await relocated;
	}

	async #turn(dir: 1 | -1) {
		const paginator = this.#paginator;
		if (!paginator) return;
		if (this.#pageTurn === 'curl') {
			await this.#loadCurl();
			if (this.#curlUsable()) {
				const move = await this.#beginCurl(dir, false);
				if (move === 'still') return;
				if (move) {
					void move.turn.play(dir > 0 ? 1 : 0);
					await move.moved;
					return;
				}
			}
		}
		const fade = this.#pageTurn === 'fade' && this.#host;
		if (fade) {
			this.#host!.style.transition = 'opacity 120ms ease';
			this.#host!.style.opacity = '0';
			await new Promise((r) => setTimeout(r, 120));
		}
		const relocated = this.#nextRelocate();
		await (dir > 0 ? paginator.next() : paginator.prev());
		await relocated;
		if (fade) this.#host!.style.opacity = '1';
	}

	next(): Promise<void> {
		return this.#turn(1);
	}

	prev(): Promise<void> {
		return this.#turn(-1);
	}

	/**
	 * Re-lays out, keeping the first visible Word on screen (§9.1). foliate-js re-lays out around
	 * its own anchor, the start of the old visible range, which can be a space at the end of the
	 * previous column; so the first Word's own range becomes the anchor first, and once layout
	 * has gone quiet (fonts load, styles apply in steps) the position is checked.
	 */
	async #keepPosition(change: () => void | Promise<void>) {
		const before = (this.#pinned ??= this.#visible?.first ?? null);
		this.#adjusting++;
		try {
			const current = this.#current();
			const map = current && this.#maps.get(current.doc);
			const index = before && map ? map.words.indexOfOrdinal(before.ordinal) : -1;
			const range = index >= 0 ? map!.range(index) : null;
			if (range) await this.#paginator!.scrollToAnchor(range);
			const relocated = this.#nextRelocate(800);
			await change();
			await relocated;
			await current?.doc.fonts?.ready;
			// Bigger text can squeeze a table without changing its width (P1-RDR-12).
			const now = this.#current();
			if (now) this.#markTables(now.doc);
			await this.#quiet();
			// While another change is still laying out, the last one to finish checks.
			if (this.#adjusting > 1) return;
			const after = this.#visible;
			if (
				before &&
				after &&
				(before.ordinal < after.first.ordinal || before.ordinal > after.last.ordinal)
			) {
				await this.goTo(before);
			}
		} finally {
			if (--this.#adjusting === 0) this.#pinned = null;
		}
	}

	// ---- presentation ----

	#applyStyles() {
		const before = `${this.#fontFaceCss}\n${BASE_CSS}`;
		const after = `${themeCss(this.#theme)}\n${typographyCss(this.#typography)}`;
		this.#paginator?.setStyles([before, after]);
	}

	#applyLayoutAttributes(mode: LayoutMode) {
		const p = this.#paginator!;
		this.#layout = mode;
		const margins = MARGINS[this.#typography.margins];
		p.setAttribute('flow', mode === 'scroll' ? 'scrolled' : 'paginated');
		p.setAttribute('max-column-count', mode === 'paginated-spread' ? '2' : '1');
		p.setAttribute('gap', margins.gap);
		p.setAttribute(
			'max-inline-size',
			`${Math.round(margins.inline * this.#typography.fontScale)}px`
		);
		p.setAttribute('margin', '32px');
	}

	async setLayout(mode: LayoutMode): Promise<void> {
		if (mode === this.#layout) return;
		this.#endCurl();
		await this.#keepPosition(() => this.#applyLayoutAttributes(mode));
	}

	async setTypography(t: TypographySettings): Promise<void> {
		this.#typography = t;
		this.#endCurl();
		await this.#keepPosition(() => {
			this.#applyStyles();
			this.#applyLayoutAttributes(this.#layout);
		});
	}

	setTheme(tokens: ReaderThemeTokens): void {
		this.#theme = tokens;
		this.#endCurl();
		this.#pageChanged();
		this.#applyStyles();
	}

	setPageTurn(turn: PageTurn): void {
		this.#pageTurn = turn;
		if (turn !== 'curl') this.#endCurl();
		else void this.#loadCurl();
		this.#applyAnimated();
	}

	/**
	 * foliate-js's own slide: for Slide, and for Curl where the curl can't draw (no WebGL), so a
	 * turn still moves. The curl turns the paginator without it.
	 */
	#applyAnimated() {
		const slide = this.#pageTurn === 'slide' || (this.#pageTurn === 'curl' && !this.#curl?.usable);
		if (slide) this.#paginator?.setAttribute('animated', '');
		else this.#paginator?.removeAttribute('animated');
	}

	// ---- page curl (P1-RDR-19) ----

	/** Loads the curl the first time it's chosen (its own chunk, §12.3). */
	#loadCurl(): Promise<void> {
		this.#curlLoading ??= (async () => {
			try {
				const module = await import('./curl');
				if (this.#destroyed || !this.#host) return;
				this.#curlModule = module;
				this.#curl = module.PageCurl.create(this.#host);
			} catch (e) {
				console.warn('The page curl couldn’t load; pages slide instead.', e);
			}
			this.#applyAnimated();
			this.#warmCurl();
		})();
		return this.#curlLoading;
	}

	/**
	 * Whether a turn now can curl: the reader chose it, the device draws it, and there are pages
	 * (not when scrolling, nor in vertical writing). Reduced motion turns it off too (Invariant
	 * 12), as the app already does.
	 */
	#curlUsable(): boolean {
		const p = this.#paginator;
		const current = this.#current();
		if (this.#pageTurn !== 'curl' || !this.#curl?.usable || !p || p.scrolled || !current) {
			return false;
		}
		if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
		const win = current.doc.defaultView;
		return !!win && !win.getComputedStyle(current.doc.body).writingMode.startsWith('vertical');
	}

	/** Whether the page shows as a spread: two columns to a page. */
	#spreadShown(doc: Document): boolean {
		const p = this.#paginator;
		const win = doc.defaultView;
		if (!p || !win || this.#layout !== 'paginated-spread') return false;
		const cs = win.getComputedStyle(doc.documentElement);
		const column = parseFloat(cs.columnWidth);
		const gap = parseFloat(cs.columnGap);
		if (!(column > 0)) return false;
		return Math.round(p.size / (column + (gap || 0))) >= 2;
	}

	#rtl(doc: Document): boolean {
		const win = doc.defaultView;
		return (
			doc.body.dir === 'rtl' ||
			doc.documentElement.dir === 'rtl' ||
			(!!win && win.getComputedStyle(doc.body).direction === 'rtl')
		);
	}

	/**
	 * Turns the page under a curl: pictures what's on screen, moves the paginator at once, then
	 * shows the curl over it (DESIGN.md §4.1). `hold` keeps the move's relocation back until the
	 * turn is committed (a finger may settle it back). 'still' when the paginator didn't move (it
	 * was still settling the last turn, or there's nothing to turn to); null when the curl couldn't
	 * start, so the turn goes on without it.
	 */
	async #beginCurl(dir: 1 | -1, hold: boolean): Promise<CurlMove | 'still' | null> {
		const p = this.#paginator;
		const curl = this.#curl;
		const module = this.#curlModule;
		const host = this.#host;
		const current = this.#current();
		if (!p || !curl || !module || !host || !current) return null;
		if (dir > 0 ? p.atEnd : p.atStart) return 'still';
		// The paginator ignores a turn while it settles the last one: no picture for nothing.
		if (this.#paginatorBusy) return 'still';
		const area = host.getBoundingClientRect();
		if (area.width < 1 || area.height < 1) return null;
		const layout = this.#spreadShown(current.doc) ? 'spread' : 'single';
		const rtl = this.#rtl(current.doc);
		const page = p.page;
		const prepared = this.#prepared;
		let before;
		if (
			prepared?.version === this.#pageVersion &&
			curl.ready(prepared.snapshot) &&
			prepared.snapshot.width === area.width &&
			prepared.snapshot.height === area.height
		) {
			// Pictured while the reader read, and nothing has changed since.
			before = prepared.snapshot;
		} else {
			try {
				before = await this.#captureReady(curl, {
					doc: current.doc,
					visible: this.#visibleDom,
					area
				});
			} catch (e) {
				console.warn(e);
				return null;
			}
		}
		this.#prepared = null;
		// Waiting for a font, the reader may have moved on.
		if (this.#current()?.doc !== current.doc || p.page !== page || this.#destroyed) return null;
		const from = this.#visible;
		if (hold) {
			this.#holding = true;
			this.#held = null;
		}
		const relocated = this.#nextRelocate();
		// Without the paginator's own slide: the curl is the animation.
		p.removeAttribute('animated');
		const moving = dir > 0 ? p.next() : p.prev();
		const busy = (this.#paginatorBusy = moving.finally(() => {
			if (this.#paginatorBusy === busy) this.#paginatorBusy = null;
		}));
		// Within a Chapter the paginator has moved by now; into another, it's loading it.
		if (p.page === page && this.#current()?.index === current.index) {
			if (hold) this.#release(false);
			await moving;
			return 'still';
		}
		const moved = Promise.all([moving, relocated]).then(() => undefined);
		const inChapter =
			this.#current()?.index === current.index && p.page >= 1 && p.page <= p.pages - 2;
		const scene = {
			layout,
			dir,
			rtl,
			width: area.width,
			height: area.height,
			spine: area.width / 2,
			before,
			after: null
		} as import('./curl').CurlScene;
		let turn: CurlTurn;
		const arriving = () => {
			const now = this.#current();
			return now && curl.capture({ doc: now.doc, visible: this.#visibleDom, area });
		};
		if (!module.needsAfter(layout, dir)) {
			// Forward on a single page: the real page turned to shows through as it curls away.
			turn = curl.start(scene);
		} else {
			if (inChapter) scene.after = arriving();
			if (!scene.after || scene.after.fontsPending) {
				// The next Chapter is still loading, or the page turned to needs a font first: the
				// old page stays in view meanwhile.
				const cover = curl.cover(before, area.width, area.height);
				await moved;
				if (scene.after?.fontsPending) await Promise.race([scene.after.fontsPending, wait(400)]);
				if (cover.done || this.#destroyed || !(scene.after = arriving())) {
					cover.end();
					return null;
				}
			}
			turn = curl.start(scene);
		}
		performance.mark('page-curl:start');
		return { turn, dir, moved, from };
	}

	/**
	 * A picture of what's on screen; drawn again once its fonts have loaded, if any hadn't (it
	 * would show in a fallback font). Rarely waits: the fonts load before the first turn.
	 */
	async #captureReady(
		curl: PageCurl,
		source: Parameters<PageCurl['capture']>[0]
	): Promise<import('./snapshot').PageSnapshot> {
		const snapshot = curl.capture(source);
		if (!snapshot.fontsPending) return snapshot;
		await Promise.race([snapshot.fontsPending, wait(400)]);
		return curl.capture(source);
	}

	/** Lets held relocations through: the turn was committed (or never moved). */
	#release(emit: boolean) {
		this.#holding = false;
		const held = this.#held;
		this.#held = null;
		if (emit && held) this.#emit('relocated', held);
	}

	/** Ends any curl at once (a jump, a new layout or theme): the real page shows. */
	#endCurl() {
		this.#pageChanged();
		this.#curl?.stop();
		this.#curlTouch = null;
		// A turn a finger was holding: the paginator has moved, so the app hears where to.
		this.#release(true);
	}

	/**
	 * Settles a held turn back: the curl lies flat again, then the paginator returns under it
	 * without telling anyone (no relocation), and the overlay goes.
	 */
	async #settleBack(move: CurlMove) {
		const p = this.#paginator;
		await move.turn.play(move.dir > 0 ? 0 : 1, this.#curlModule?.CURL_MS, easeOut, true);
		await move.moved;
		if (p && !this.#destroyed) {
			const back = this.#nextRelocate();
			await (move.dir > 0 ? p.prev() : p.next());
			await back;
			this.#visible = move.from;
		}
		this.#holding = false;
		this.#held = null;
		move.turn.end();
		this.#applyAnimated();
	}

	/**
	 * A finger on the page while the curl is on: a sideways drag anywhere lifts the page and the
	 * curl follows it (D-045); let go and it turns over or settles back. Taps still reach the
	 * page (tap zones, links, Words). Two fingers are a pinch, left to the pinch handler. The
	 * paginator's own swipe never sees these touches.
	 */
	#watchCurlTouches(target: EventTarget, frame: () => DOMRect | null) {
		const point = (touch: Touch) => {
			const f = frame();
			return { x: touch.clientX + (f?.left ?? 0), y: touch.clientY + (f?.top ?? 0) };
		};
		const options = { capture: true, passive: false } as const;
		target.addEventListener(
			'touchstart',
			(e) => {
				const event = e as TouchEvent;
				if (event.touches.length > 1) {
					// A second finger: a pinch. A drag in progress settles back.
					void this.#dropTouch(false);
					return;
				}
				if (!this.#curlUsable() || this.#curlTouch?.move) return;
				event.stopPropagation();
				const touch = event.changedTouches[0]!;
				const at = { ...point(touch), t: event.timeStamp };
				this.#curlTouch = { id: touch.identifier, start: at, last: at, velocity: 0 };
			},
			options
		);
		target.addEventListener(
			'touchmove',
			(e) => {
				const event = e as TouchEvent;
				const state = this.#curlTouch;
				if (!state || event.touches.length > 1) return;
				const touch = [...event.changedTouches].find((t) => t.identifier === state.id);
				if (!touch) return;
				event.stopPropagation();
				event.preventDefault();
				if (state.ignored) return;
				const at = { ...point(touch), t: event.timeStamp };
				const dt = Math.max(1, at.t - state.last.t);
				state.velocity = state.velocity * 0.4 + ((at.x - state.last.x) / dt) * 0.6;
				state.last = at;
				if (!state.move) this.#startDrag(state, event);
				else void state.move.then((move) => move && this.#dragTo(move, state));
			},
			options
		);
		const end = (e: Event) => {
			const event = e as TouchEvent;
			const state = this.#curlTouch;
			if (!state) return;
			if (![...event.changedTouches].some((t) => t.identifier === state.id)) return;
			event.stopPropagation();
			void this.#dropTouch(event.type === 'touchend');
		};
		target.addEventListener('touchend', end, options);
		target.addEventListener('touchcancel', end, options);
	}

	/** Becomes a turn once the finger has clearly moved sideways (not a tap, not a long press). */
	#startDrag(state: CurlTouch, event: TouchEvent) {
		const dx = state.last.x - state.start.x;
		const dy = state.last.y - state.start.y;
		if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) {
			if (Math.hypot(dx, dy) > 24) state.ignored = true;
			return;
		}
		const current = this.#current();
		const selected = current && !current.doc.getSelection()?.isCollapsed;
		if (selected || event.timeStamp - state.start.t > 600) {
			state.ignored = true;
			return;
		}
		const rtl = current ? this.#rtl(current.doc) : false;
		const dir: 1 | -1 = dx < 0 !== rtl ? 1 : -1;
		state.dir = dir;
		state.move = this.#beginCurl(dir, true).then((move) => {
			if (move === 'still' || !move) {
				state.ignored = true;
				return null;
			}
			if (this.#curlTouch === state) this.#dragTo(move, state);
			return move;
		});
	}

	#dragTo(move: CurlMove, state: CurlTouch) {
		if (move.turn.done || !this.#curl) return;
		const { scene } = move.turn;
		const area = this.#host!.getBoundingClientRect();
		const local = (p: { x: number; y: number }) => {
			const x = p.x - area.left;
			return { x: scene.rtl ? scene.width - x : x, y: p.y - area.top };
		};
		const sheet = this.#curl.sheetOf(scene);
		move.turn.set(dragPose(sheet, local(state.start), local(state.last), move.dir));
	}

	/** The finger lifted (or a second one landed): finish the turn, or settle it back. */
	async #dropTouch(lifted: boolean) {
		const state = this.#curlTouch;
		this.#curlTouch = null;
		if (!state?.move) return;
		const move = await state.move;
		if (!move || move.turn.done) {
			if (this.#holding) this.#release(true);
			return;
		}
		const velocity = move.turn.scene.rtl ? -state.velocity : state.velocity;
		const commit = lifted && dragCommits(move.turn.progress, velocity, move.dir);
		if (!commit) return this.#settleBack(move);
		const played = move.turn.play(move.dir > 0 ? 1 : 0, this.#curlModule?.CURL_MS, easeOut);
		await move.moved;
		this.#release(true);
		this.#applyAnimated();
		await played;
	}

	/**
	 * Something on screen changed (a turn, a highlight, the theme, a picture loading): a picture
	 * prepared for the next turn is out of date, and a new one is drawn once the page has been
	 * still for half a second. Not while narration moves its highlight Word by Word: the turn
	 * then draws its own.
	 */
	#pageChanged() {
		this.#pageVersion++;
		this.#warmCurl();
	}

	/**
	 * Pictures the page and uploads it while the reader reads (PageCurl.prepare), so a turn
	 * starts with nothing to draw. It also loads the fonts a curl needs before the first turn: a
	 * picture drawn before then would use a fallback font, so it's drawn again once they load.
	 */
	#warmCurl(delay = 500) {
		if (this.#pageTurn !== 'curl' || !this.#curl) return;
		clearTimeout(this.#warmTimer);
		this.#warmTimer = setTimeout(() => {
			const current = this.#current();
			const host = this.#host;
			if (!current || !host || !this.#curlUsable() || this.#holding) return;
			if (this.#curl?.turning) return this.#warmCurl(200);
			const version = this.#pageVersion;
			try {
				const snapshot = this.#curl!.prepare({
					doc: current.doc,
					visible: this.#visibleDom,
					area: host.getBoundingClientRect()
				});
				if (snapshot.fontsPending) {
					this.#prepared = null;
					void snapshot.fontsPending.then(() => this.#warmCurl(0));
				} else this.#prepared = { snapshot, version };
			} catch {
				// Only a head start: the turn draws its own picture.
				this.#prepared = null;
			}
		}, delay);
	}

	// ---- decorations and figures ----

	setDecorations(group: string, items: Decoration[]): void {
		this.#decorations.set(group, items);
		this.#pageChanged();
		const current = this.#current();
		const map = current && this.#maps.get(current.doc);
		if (current && map) this.#paintDecorations(current.doc, map);
	}

	#paintDecorations(doc: Document, map: DocWordMap) {
		// Focus mode needs no Custom Highlights: it dims with attributes.
		this.#paintFocus(doc, map);
		const win = doc.defaultView as (Window & typeof globalThis) | null;
		if (!win || !('highlights' in win.CSS)) return;
		const byName = new Map<string, Range[]>();
		const { chapter } = map.words;
		for (const items of this.#decorations.values()) {
			for (const item of items) {
				const { anchor } = item;
				if (item.style === 'focus') continue;
				if (anchor.revisionId !== this.#manifest.revisionId) continue;
				if (anchor.endOrdinal < chapter.firstOrdinal || anchor.startOrdinal > chapter.lastOrdinal)
					continue;
				const first = map.words.indexOfOrdinal(Math.max(anchor.startOrdinal, chapter.firstOrdinal));
				const last = map.words.indexOfOrdinal(Math.min(anchor.endOrdinal, chapter.lastOrdinal));
				const range = first >= 0 && last >= 0 ? map.rangeBetween(first, last) : null;
				if (!range) continue;
				const colour = (item.color ?? 'highlight-1').replace(/^highlight-/, '');
				const name =
					item.style === 'highlight'
						? `rd-highlight-${colour}`
						: item.style === 'underline'
							? `rd-underline-${colour}`
							: `rd-${item.style}`;
				byName.set(name, [...(byName.get(name) ?? []), range]);
			}
		}
		for (const name of [...win.CSS.highlights.keys()]) {
			if (String(name).startsWith('rd-')) win.CSS.highlights.delete(name);
		}
		for (const [name, ranges] of byName) {
			const highlight = new win.Highlight(...ranges);
			// The narrated Word shows over the reader's own highlights.
			if (name === 'rd-narration') highlight.priority = 1;
			win.CSS.highlights.set(name, highlight);
		}
	}

	/**
	 * Focus mode (P1-RDR-11): the Blocks holding the focus decoration's Words stay bright, the
	 * Chapter's other Blocks dim (styles.ts). Attributes only, so the pages don't move.
	 */
	#paintFocus(doc: Document, map: DocWordMap) {
		const focus = [...this.#decorations.values()]
			.flat()
			.find((d) => d.style === 'focus' && d.anchor.revisionId === this.#manifest.revisionId);
		const root = doc.documentElement;
		const focused = new Set<Element>();
		if (focus) {
			const { chapter } = map.words;
			const from = Math.max(focus.anchor.startOrdinal, chapter.firstOrdinal);
			const to = Math.min(focus.anchor.endOrdinal, chapter.lastOrdinal);
			for (let ordinal = from; ordinal <= to; ordinal++) {
				const block = map.blockElement(map.words.indexOfOrdinal(ordinal));
				if (block) focused.add(block);
			}
		}
		for (const el of doc.querySelectorAll('[data-rd-focused]')) {
			if (!focused.has(el)) el.removeAttribute('data-rd-focused');
		}
		for (const el of focused) el.setAttribute('data-rd-focused', '');
		if (focus) root.setAttribute('data-rd-focus', '');
		else root.removeAttribute('data-rd-focus');
	}

	async chapterText(chapterId: string): Promise<ChapterText> {
		const index = this.#manifest.chapters.findIndex((c) => c.chapterId === chapterId);
		if (index < 0) throw new Error(`This Revision has no Chapter ${chapterId}.`);
		const words = await this.#chapterWords(index);
		const current = this.#current();
		const map =
			(current?.index === index && this.#maps.get(current.doc)) ||
			new DocWordMap(
				await this.#content.chapterDocument(this.#manifest.chapters[index]!.href),
				words
			);
		return {
			chapterId,
			firstOrdinal: words.index.firstOrdinal,
			wordIds: words.index.words.map((w) => w[0]),
			texts: map.punctuatedTexts(),
			blocks: words.index.words.map((w) => w[1])
		};
	}

	// ---- overview mode (P1-RDR-17) ----

	/** The current Chapter's page geometry, or null when it has no pages to show. */
	#geometry(doc: Document): PageGeometry | null {
		const p = this.#paginator;
		const win = doc.defaultView;
		if (!p || !win || p.scrolled) return null;
		const body = win.getComputedStyle(doc.body);
		if (body.writingMode.startsWith('vertical')) return null;
		const count = p.pages - 2;
		if (count < 1) return null;
		return {
			size: p.size,
			height: win.innerHeight,
			count,
			frameWidth: win.innerWidth,
			rtl: doc.body.dir === 'rtl' || body.direction === 'rtl' || doc.documentElement.dir === 'rtl'
		};
	}

	/** The pages measured for the Chapter on screen, measuring again when anything moved. */
	#measure(): MeasuredPages | null {
		const current = this.#current();
		const map = current && this.#maps.get(current.doc);
		const geometry = current && this.#geometry(current.doc);
		if (!current || !map || !geometry) return null;
		const key = JSON.stringify(geometry);
		if (this.#pages?.doc !== current.doc || this.#pages.key !== key) {
			this.#pages = { doc: current.doc, key, geometry, starts: pageStarts(map, geometry) };
		}
		return this.#pages;
	}

	chapterPages(): ChapterPages | null {
		const measured = this.#measure();
		const current = this.#current();
		const map = current && this.#maps.get(current.doc);
		if (!measured || !current || !map) return null;
		const win = current.doc.defaultView!;
		return {
			chapterId: map.words.chapter.chapterId,
			width: measured.geometry.size,
			height: measured.geometry.height,
			background: win.getComputedStyle(current.doc.body).backgroundColor,
			dir: measured.geometry.rtl ? 'rtl' : 'ltr',
			current: Math.min(measured.geometry.count - 1, Math.max(0, this.#paginator!.page - 1)),
			pages: measured.starts.map((i) => ({ first: i >= 0 ? map.pointAnchor(i) : null }))
		};
	}

	drawPage(index: number): PageDrawing | null {
		const measured = this.#measure();
		const map = measured && this.#maps.get(measured.doc);
		if (!measured || !map || index < 0 || index >= measured.geometry.count) return null;
		measured.punctuated ??= map.punctuatedTexts();
		return drawPage(map, measured.geometry, index, measured.starts, measured.punctuated);
	}

	async goToPage(index: number): Promise<void> {
		const measured = this.#measure();
		const current = this.#current();
		const map = current && this.#maps.get(current.doc);
		if (!measured || !current || !map || index < 0 || index >= measured.geometry.count) return;
		const first = measured.starts[index]!;
		if (first >= 0) return this.goTo(map.pointAnchor(first));
		// A page with no Word on it (a picture): by its place among the Chapter's pages.
		const relocated = this.#nextRelocate();
		await this.#paginator!.goTo({
			index: current.index,
			anchor: () => index / Math.max(1, measured.geometry.count - 1)
		});
		await relocated;
	}

	injectFigures(items: FigureInjection[]): void {
		this.#figures = items;
		const current = this.#current();
		const map = current && this.#maps.get(current.doc);
		if (!current || !map) return;
		this.#endCurl();
		// New figures change the pages: lay out again around the first visible Word.
		void this.#keepPosition(() => {
			this.#placeFigures(current.doc, map);
			this.#paginator?.render();
		});
	}

	relayout(change: () => void | Promise<void>): Promise<void> {
		this.#endCurl();
		return this.#keepPosition(async () => {
			await change();
			// The paginator notices size changes itself; this makes sure it happens now.
			this.#paginator?.render();
		});
	}

	// ---- squeezed tables (P1-RDR-12) ----

	/**
	 * Marks the Chapter's squeezed tables now, once its fonts have loaded, and whenever a table's
	 * size changes (the window, the margins, a panel opening). The row each gets changes the
	 * layout, which foliate-js follows, keeping its place, as it does for a late image.
	 */
	#watchTables(doc: Document) {
		if (!this.#tableButton || !doc.querySelector('table')) return;
		this.#markTables(doc);
		void doc.fonts?.ready.then(() => !this.#destroyed && this.#markTables(doc));
		const win = doc.defaultView as (Window & typeof globalThis) | null;
		if (!win?.ResizeObserver) return;
		let frame = 0;
		const observer = new win.ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				if (doc.defaultView && !this.#destroyed) this.#markTables(doc);
			});
		});
		for (const table of this.#tablesOf(doc)) observer.observe(table);
	}

	/** The Chapter's tables, but not those inside another (they open with it). */
	#tablesOf(doc: Document): Element[] {
		return [...doc.querySelectorAll('table')].filter((t) => !t.parentElement?.closest('table'));
	}

	/** Shows the "Open table" row above each squeezed table, and only those. */
	#markTables(doc: Document) {
		const button = this.#tableButton;
		if (!button) return;
		for (const table of this.#tablesOf(doc)) {
			const before = table.previousElementSibling;
			const row = before?.hasAttribute(TABLE_ROW) ? before : null;
			const squeezed = isSqueezed(table);
			if (squeezed && !row) table.before(tableRow(doc, button));
			else if (!squeezed && row) row.remove();
			else continue;
			this.#pageChanged();
		}
	}

	#placeFigures(doc: Document, map: DocWordMap) {
		for (const old of doc.querySelectorAll('figure[data-injected]')) old.remove();
		const { chapter } = map.words;
		const ns = 'http://www.w3.org/1999/xhtml';
		for (const item of this.#figures) {
			const anchor = item.anchor;
			if (anchor.revisionId !== this.#manifest.revisionId) continue;
			const end = anchor.kind === 'point' ? anchor.ordinal : anchor.endOrdinal;
			const i = map.words.indexOfOrdinal(end);
			if (end < chapter.firstOrdinal || end > chapter.lastOrdinal || i < 0) continue;
			const block = map.blockElement(i);
			if (!block) continue;
			const figure = doc.createElementNS(ns, 'figure');
			figure.setAttribute('data-injected', item.id);
			if (item.placement === 'full_page') figure.setAttribute('class', 'full-page');
			const img = doc.createElementNS(ns, 'img');
			img.setAttribute('src', item.src);
			if (item.srcset) img.setAttribute('srcset', item.srcset);
			img.setAttribute('alt', item.alt);
			if (item.width && item.height) {
				img.setAttribute('width', String(item.width));
				img.setAttribute('height', String(item.height));
				// Its box is settled before the image arrives, so the pages don't shift after the
				// engine has checked the reader's place (§9.1). The figure CSS's width:auto would
				// otherwise size it 300 px wide until it decodes.
				const ratio = (item.width / item.height).toFixed(4);
				const tallest = item.placement === 'full_page' ? 80 : 60;
				img.setAttribute(
					'style',
					`aspect-ratio:${item.width}/${item.height};width:min(100%,calc(${tallest}vh*${ratio}));height:auto`
				);
			}
			figure.append(img);
			if (item.caption) {
				const caption = doc.createElementNS(ns, 'figcaption');
				caption.textContent = item.caption;
				figure.append(caption);
			}
			block.after(figure);
		}
	}
}
