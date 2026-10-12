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
import { BASE_CSS, MARGINS, themeCss, typographyCss } from './styles';
import type {
	ChapterText,
	Decoration,
	EngineEvent,
	EngineEvents,
	EngineOptions,
	FigureInjection,
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
	readonly scrolled: boolean;
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
	#listeners: Listeners = {
		relocated: new Set(),
		selection: new Set(),
		wordActivated: new Set(),
		contextMenu: new Set(),
		figureActivated: new Set(),
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
		this.#paginator?.destroy();
		this.#paginator?.remove();
		this.#content?.release();
		for (const set of Object.values(this.#listeners)) set.clear();
	}

	async #onLoad(doc: Document, index: number) {
		const map = await this.#map(doc, index);
		this.#paintDecorations(doc, map);
		this.#placeFigures(doc, map);

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
			if ((event.target as Element | null)?.closest?.('a[href]')) return;
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
		this.#emit('relocated', this.#visible);
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
		await this.#keepPosition(() => this.#applyLayoutAttributes(mode));
	}

	async setTypography(t: TypographySettings): Promise<void> {
		this.#typography = t;
		await this.#keepPosition(() => {
			this.#applyStyles();
			this.#applyLayoutAttributes(this.#layout);
		});
	}

	setTheme(tokens: ReaderThemeTokens): void {
		this.#theme = tokens;
		this.#applyStyles();
	}

	setPageTurn(turn: PageTurn): void {
		this.#pageTurn = turn;
		if (turn === 'slide') this.#paginator?.setAttribute('animated', '');
		else this.#paginator?.removeAttribute('animated');
	}

	// ---- decorations and figures ----

	setDecorations(group: string, items: Decoration[]): void {
		this.#decorations.set(group, items);
		const current = this.#current();
		const map = current && this.#maps.get(current.doc);
		if (current && map) this.#paintDecorations(current.doc, map);
	}

	#paintDecorations(doc: Document, map: DocWordMap) {
		const win = doc.defaultView as (Window & typeof globalThis) | null;
		if (!win || !('highlights' in win.CSS)) return;
		const byName = new Map<string, Range[]>();
		const { chapter } = map.words;
		for (const items of this.#decorations.values()) {
			for (const item of items) {
				const { anchor } = item;
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
			texts: words.index.words.map((_, i) => map.text(i)),
			blocks: words.index.words.map((w) => w[1])
		};
	}

	injectFigures(items: FigureInjection[]): void {
		this.#figures = items;
		const current = this.#current();
		const map = current && this.#maps.get(current.doc);
		if (!current || !map) return;
		// New figures change the pages: lay out again around the first visible Word.
		void this.#keepPosition(() => {
			this.#placeFigures(current.doc, map);
			this.#paginator?.render();
		});
	}

	relayout(change: () => void | Promise<void>): Promise<void> {
		return this.#keepPosition(async () => {
			await change();
			// The paginator notices size changes itself; this makes sure it happens now.
			this.#paginator?.render();
		});
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
