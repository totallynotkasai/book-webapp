// SPIKE (P0-04): throwaway. foliate-js behind the spike interface.
// foliate-js has no TypeScript types; the few members used are typed loosely in foliate-js.d.ts.
import 'foliate-js/view.js';
import {
	findVisibleWords,
	frames,
	insertFigure,
	paintHighlight,
	selectionToWords,
	wordMap,
	type SpikeEngine,
	type SpikeLayout,
	type SpikeOptions,
	type SpikeSelection
} from './engine';
import type { SpikePublication } from './publication';

interface FoliateRenderer extends HTMLElement {
	goTo(target: { index: number; anchor?: unknown }): Promise<void>;
	next(): Promise<void>;
	prev(): Promise<void>;
	setStyles(styles: string | [string, string]): void;
	getContents(): { index: number; doc: Document }[];
	readonly pages: number;
	readonly page: number;
}

interface FoliateView extends HTMLElement {
	open(book: unknown): Promise<void>;
	close(): void;
	renderer: FoliateRenderer;
}

export class FoliateEngine implements SpikeEngine {
	readonly name = 'foliate-js';
	#view?: FoliateView;
	#layout: SpikeLayout = 'paginated';
	#fontScale = 1;
	#relocateListeners = new Set<() => void>();
	#selectionListeners = new Set<(s: SpikeSelection | null) => void>();
	#index = 0;
	#pub?: SpikePublication;

	#map() {
		return this.#pub ? wordMap(this.#pub, this.#index) : null;
	}

	async mount(container: HTMLElement, pub: SpikePublication, options: SpikeOptions) {
		this.#pub = pub;
		const sections = pub.sections.map((s) => ({
			id: s.href,
			linear: s.linear ? 'yes' : 'no',
			size: Math.max(1, s.wordCount * 6),
			load: () => pub.documentUrl(s.href),
			createDocument: async () =>
				new DOMParser().parseFromString(await pub.document(s.href), 'application/xhtml+xml')
		}));
		const book = {
			dir: 'ltr',
			metadata: { title: pub.title, language: pub.lang, author: pub.creator },
			toc: pub.toc.map((t) => ({ label: t.label, href: t.href })),
			sections,
			splitTOCHref: (href: string) => href.split('#'),
			getTOCFragment: (doc: Document, id: string) => doc.getElementById(id),
			resolveHref: (href: string) => {
				const [path, fragment] = href.split('#');
				return {
					index: sections.findIndex((s) => s.id === path),
					anchor: (doc: Document) => (fragment ? doc.getElementById(fragment) : null)
				};
			}
		};

		const view = document.createElement('foliate-view') as FoliateView;
		view.style.cssText = 'display:block;width:100%;height:100%;';
		container.append(view);
		this.#view = view;
		view.addEventListener('relocate', ((e: CustomEvent<{ section?: { current?: number } }>) => {
			// foliate-js reports the section index as `section.current`.
			const current = e.detail?.section?.current;
			if (typeof current === 'number') this.#index = current;
			for (const cb of this.#relocateListeners) cb();
		}) as EventListener);
		view.addEventListener('load', ((e: CustomEvent<{ doc: Document; index: number }>) => {
			const { doc, index } = e.detail;
			const map = wordMap(pub, index);
			doc.addEventListener('selectionchange', () => {
				const selection = map ? selectionToWords(doc, map) : null;
				for (const cb of this.#selectionListeners) cb(selection);
			});
		}) as EventListener);

		await view.open(book);
		this.#fontScale = options.fontScale;
		this.#applyStyles();
		await this.setLayout(options.layout);
		const first = pub.sections.findIndex((s) => s.linear && s.wordCount > 0);
		const relocated = this.nextRelocate();
		await view.renderer.goTo({ index: Math.max(0, first) });
		await relocated;
	}

	#applyStyles() {
		// The user's font scale and a calm default, like the app's reader tokens will (§9.4).
		this.#view?.renderer.setStyles(
			`html { font-size: ${Math.round(this.#fontScale * 100)}% !important; }
			 body { line-height: 1.6; }
			 img { max-width: 100%; height: auto; }`
		);
	}

	nextRelocate() {
		return new Promise<void>((resolve) => {
			const off = this.onRelocate(() => {
				off();
				frames().then(resolve);
			});
		});
	}

	async next() {
		const done = this.nextRelocate();
		await this.#view!.renderer.next();
		await done;
	}

	async prev() {
		const done = this.nextRelocate();
		await this.#view!.renderer.prev();
		await done;
	}

	async goToSection(index: number) {
		const done = this.nextRelocate();
		await this.#view!.renderer.goTo({ index });
		await done;
	}

	async goToWord(wordId: number) {
		const done = this.nextRelocate();
		await this.#view!.renderer.goTo({
			index: this.#index,
			anchor: (doc: Document) => this.#map()?.range(doc, wordId) ?? null
		});
		await Promise.race([done, new Promise((r) => setTimeout(r, 800))]);
	}

	highlightCount() {
		return this.documents().reduce(
			(n, doc) =>
				n + ((doc.defaultView as (Window & typeof globalThis) | null)?.CSS.highlights?.size ?? 0),
			0
		);
	}

	async setFontScale(scale: number) {
		this.#fontScale = scale;
		const done = this.nextRelocate();
		this.#applyStyles();
		await Promise.race([done, new Promise((r) => setTimeout(r, 1500))]);
		await frames();
	}

	async setLayout(layout: SpikeLayout) {
		const renderer = this.#view!.renderer;
		this.#layout = layout;
		const done = this.nextRelocate();
		renderer.setAttribute('flow', layout === 'scroll' ? 'scrolled' : 'paginated');
		renderer.setAttribute('max-column-count', layout === 'spread' ? '2' : '1');
		renderer.setAttribute('max-inline-size', '720px');
		renderer.setAttribute('gap', '6%');
		await Promise.race([done, new Promise((r) => setTimeout(r, 800))]);
	}

	documents() {
		return this.#view?.renderer.getContents().map((c) => c.doc) ?? [];
	}

	visibleWords() {
		const [doc] = this.documents();
		const map = this.#map();
		if (!doc || !this.#view || !map) return null;
		return findVisibleWords(
			doc,
			map,
			this.#visibleArea(doc),
			this.#layout === 'scroll',
			this.#index
		);
	}

	/**
	 * The part of the view where text shows. foliate-js centres the page in a column narrower than
	 * the view (max-inline-size), and the neighbouring pages sit beside it, hidden by a clipping
	 * container inside its shadow DOM; the view's own box would count them as on screen (found by
	 * P0-06, whose auto page-turn needs the real last visible Word).
	 */
	#visibleArea(doc: Document): DOMRect {
		const view = this.#view!.getBoundingClientRect();
		let left = view.left;
		let top = view.top;
		let right = view.right;
		let bottom = view.bottom;
		let el: Element | null = doc.defaultView?.frameElement ?? null;
		while (el && el !== this.#view) {
			if (getComputedStyle(el).overflow !== 'visible') {
				const box = el.getBoundingClientRect();
				left = Math.max(left, box.left);
				top = Math.max(top, box.top);
				right = Math.min(right, box.right);
				bottom = Math.min(bottom, box.bottom);
			}
			const root = el.getRootNode();
			el = el.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
		}
		return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
	}

	// foliate-js draws annotations as SVG overlays keyed by CFI; the spike uses its iframe access
	// with the CSS Custom Highlight API instead, which is what our adapter would do.
	highlight(from: number, to: number) {
		const map = this.#map();
		if (map) for (const doc of this.documents()) paintHighlight(doc, map, from, to);
	}

	clearHighlights() {
		for (const doc of this.documents()) {
			(doc.defaultView as (Window & typeof globalThis) | null)?.CSS.highlights?.delete('spike');
		}
	}

	pageCount() {
		// foliate-js's paginator counts a blank page at each end of a section.
		return Math.max(1, (this.#view?.renderer.pages ?? 2) - 2);
	}

	async injectFigure(afterWordId: number, src: string, alt: string) {
		const before = this.pageCount();
		const [doc] = this.documents();
		const map = this.#map();
		if (!doc || !map || !insertFigure(doc, map, afterWordId, src, alt))
			return { before, after: before };
		const img = doc.querySelector<HTMLImageElement>('[data-injected] img');
		if (img && !img.complete)
			await new Promise((r) => img.addEventListener('load', r, { once: true }));
		// foliate-js watches the section's size with a ResizeObserver and re-paginates by itself.
		await new Promise((r) => setTimeout(r, 300));
		await frames();
		return { before, after: this.pageCount() };
	}

	onRelocate(callback: () => void) {
		this.#relocateListeners.add(callback);
		return () => this.#relocateListeners.delete(callback);
	}

	onSelection(callback: (s: SpikeSelection | null) => void) {
		this.#selectionListeners.add(callback);
		return () => this.#selectionListeners.delete(callback);
	}

	async destroy() {
		this.#view?.close();
		this.#view?.remove();
		this.#relocateListeners.clear();
		this.#selectionListeners.clear();
	}
}
