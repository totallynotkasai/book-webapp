// SPIKE (P0-04): throwaway. Readium ts-toolkit behind the spike interface. Readium renders a
// Readium Web Publication Manifest; here it's built from the prepared sections and served by a
// custom Fetcher, as backend-local (or text-pipeline output) would serve it.
import {
	EpubNavigator,
	EpubPreferences,
	type EpubNavigatorListeners,
	type FrameManager
} from '@readium/navigator';
import { Link, Locator, Manifest, Publication, Resource, type Fetcher } from '@readium/shared';
import {
	findVisibleWords,
	frames,
	insertFigure,
	selectionToWords,
	wordMap,
	type WordMap,
	type SpikeEngine,
	type SpikeLayout,
	type SpikeOptions,
	type SpikeSelection
} from './engine';
import type { SpikePublication } from './publication';

const XHTML = 'application/xhtml+xml';

class PreparedResource extends Resource {
	constructor(
		private readonly linkValue: Link,
		private readonly pub: SpikePublication
	) {
		super();
	}
	async link() {
		return this.linkValue;
	}
	async length() {
		return (await this.read())?.byteLength;
	}
	async read() {
		return new TextEncoder().encode(await this.pub.document(this.linkValue.href));
	}
	close() {}
}

class PreparedFetcher implements Fetcher {
	constructor(
		private readonly readingOrder: Link[],
		private readonly pub: SpikePublication
	) {}
	links() {
		return this.readingOrder;
	}
	get(link: Link): Resource {
		return new PreparedResource(link, this.pub);
	}
	close() {}
}

function preferencesFor(layout: SpikeLayout, fontScale: number) {
	return new EpubPreferences({
		fontSize: fontScale,
		lineHeight: 1.6,
		scroll: layout === 'scroll',
		columnCount: layout === 'spread' ? 2 : 1
	});
}

export class ReadiumEngine implements SpikeEngine {
	readonly name = 'Readium';
	/** Public for console debugging (spike only). */
	nav?: EpubNavigator;
	#container?: HTMLElement;
	#pub?: SpikePublication;
	#layout: SpikeLayout = 'paginated';
	#fontScale = 1;
	#relocateListeners = new Set<() => void>();
	#selectionListeners = new Set<(s: SpikeSelection | null) => void>();
	#hooked = new WeakSet<Document>();
	#readingOrder: Link[] = [];

	async mount(container: HTMLElement, pub: SpikePublication, options: SpikeOptions) {
		this.#container = container;
		// Readium leaves sizing its iframes to the host page; without this they stay 300×150.
		const style = document.createElement('style');
		style.textContent = `.readium-navigator-iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }`;
		container.append(style);
		this.#pub = pub;
		this.#layout = options.layout;
		this.#fontScale = options.fontScale;
		const manifest = Manifest.deserialize({
			'@context': 'https://readium.org/webpub-manifest/context.jsonld',
			metadata: { title: pub.title, language: [pub.lang], readingProgression: 'ltr' },
			links: [],
			readingOrder: pub.sections.map((s) => ({ href: s.href, type: XHTML, title: s.title })),
			toc: pub.toc.map((t) => ({ href: t.href, type: XHTML, title: t.label }))
		});
		if (!manifest) throw new Error('Could not build a Readium manifest.');
		this.#readingOrder = [...manifest.readingOrder.items];
		const publication = new Publication({
			manifest,
			fetcher: new PreparedFetcher(this.#readingOrder, pub)
		});
		const total = pub.sections.length;
		const positions = pub.sections.map((s, i) =>
			Locator.deserialize({
				href: s.href,
				type: XHTML,
				title: s.title,
				locations: { position: i + 1, progression: 0, totalProgression: i / total }
			})!
		);

		const noop = () => {};
		const listeners: EpubNavigatorListeners = {
			frameLoaded: (wnd) => this.#hook(wnd.document),
			positionChanged: () => {
				for (const cb of this.#relocateListeners) cb();
			},
			timelineItemChanged: noop,
			tap: () => false,
			click: () => false,
			zoom: noop,
			miscPointer: noop,
			scroll: noop,
			customEvent: noop,
			handleLocator: () => false,
			textSelected: noop,
			contentProtection: noop,
			contextMenu: noop,
			peripheral: noop
		};

		const first = pub.sections.findIndex((s) => s.linear && s.wordCount > 0);
		this.nav = new EpubNavigator(
			container,
			publication,
			listeners,
			positions,
			positions[Math.max(0, first)],
			{ preferences: preferencesFor(this.#layout, this.#fontScale), defaults: {} }
		);
		const relocated = this.nextRelocate();
		await this.nav.load();
		await Promise.race([relocated, new Promise((r) => setTimeout(r, 1500))]);
	}

	#index() {
		const href = this.nav?.currentLocator.href;
		return this.#pub?.sections.findIndex((s) => s.href === href) ?? -1;
	}

	#map(): WordMap | null {
		return this.#pub ? wordMap(this.#pub, this.#index()) : null;
	}

	#hook(doc: Document) {
		if (this.#hooked.has(doc)) return;
		this.#hooked.add(doc);
		doc.addEventListener('selectionchange', () => {
			const map = this.#map();
			const selection = map ? selectionToWords(doc, map) : null;
			for (const cb of this.#selectionListeners) cb(selection);
		});
	}

	#frames(): FrameManager[] {
		return (this.nav?._cframes ?? []).filter((f): f is FrameManager => {
			try {
				// FrameManager.window throws until the frame exists.
				return !!f && 'window' in f && !!f.window?.document;
			} catch {
				return false;
			}
		});
	}

	nextRelocate() {
		return new Promise<void>((resolve) => {
			const off = this.onRelocate(() => {
				off();
				frames().then(resolve);
			});
		});
	}

	#step(direction: 'forward' | 'backward') {
		return new Promise<void>((resolve) => {
			const nav = this.nav!;
			const done = this.nextRelocate();
			const cb = (ok: boolean) => (ok ? done.then(resolve) : resolve());
			if (direction === 'forward') nav.goForward(false, cb);
			else nav.goBackward(false, cb);
		});
	}

	next() {
		return this.#step('forward');
	}

	prev() {
		return this.#step('backward');
	}

	goToSection(index: number) {
		return new Promise<void>((resolve) => {
			const link = this.#readingOrder[index];
			if (!link || !this.nav) return resolve();
			const done = this.nextRelocate();
			this.nav.goLink(link, false, (ok) => (ok ? done.then(resolve) : resolve()));
		});
	}

	goToWord(wordId: number) {
		return new Promise<void>((resolve) => {
			const href = this.nav?.currentLocator.href;
			if (!href || !this.nav) return resolve();
			// Readium's go() ignores domRange; it looks for a text quote under a CSS selector.
			const map = this.#map();
			const doc = this.documents()[0];
			if (!map || !doc) return resolve();
			const word = map.text(doc, wordId);
			// Option A targets the Word span; option B its Block (the quote finds the Word inside).
			const block = map.block(doc, wordId)?.getAttribute('data-b');
			const cssSelector = map.marking === 'spans' ? `[data-w="${wordId}"]` : `[data-b="${block}"]`;
			const locator = Locator.deserialize({
				href,
				type: XHTML,
				locations: { cssSelector },
				text: { highlight: word }
			});
			if (!locator) return resolve();
			const done = this.nextRelocate();
			const timeout = new Promise<void>((r) => setTimeout(r, 800));
			this.nav.go(locator, false, () => Promise.race([done, timeout]).then(resolve));
		});
	}

	highlightCount() {
		return this.documents().reduce(
			(n, doc) =>
				n + ((doc.defaultView as (Window & typeof globalThis) | null)?.CSS.highlights?.size ?? 0),
			0
		);
	}

	async #submit() {
		const done = this.nextRelocate();
		await this.nav!.submitPreferences(preferencesFor(this.#layout, this.#fontScale));
		await Promise.race([done, new Promise((r) => setTimeout(r, 800))]);
		await frames();
	}

	setFontScale(scale: number) {
		this.#fontScale = scale;
		return this.#submit();
	}

	setLayout(layout: SpikeLayout) {
		this.#layout = layout;
		return this.#submit();
	}

	documents() {
		return this.#frames().map((f) => f.window.document);
	}

	visibleWords() {
		const doc = this.documents()[0];
		if (!doc || !this.#container) return null;
		const href = this.nav?.currentLocator.href;
		const index = this.#pub?.sections.findIndex((s) => s.href === href) ?? -1;
		const map = this.#map();
		if (!map) return null;
		return findVisibleWords(
			doc,
			map,
			this.#container.getBoundingClientRect(),
			this.#layout === 'scroll',
			index
		);
	}

	// Readium's own decoration API, which paints with the CSS Custom Highlight API in the frame.
	highlight(from: number, to: number) {
		const href = this.nav?.currentLocator.href;
		if (!href || !this.nav) return;
		// Readium 2.10's decorator resolves only text quotes across the frame boundary (domRange and
		// cssSelector locators fail), so send the Anchor's TextQuote: exact text plus 32 characters
		// either side, as DESIGN.md §6.1 stores it.
		const map = this.#map();
		const doc = this.documents()[0];
		const start = doc && map?.range(doc, from);
		const end = doc && map?.range(doc, to);
		if (!doc || !start || !end) return;
		const exact = doc.createRange();
		exact.setStart(start.startContainer, start.startOffset);
		exact.setEnd(end.endContainer, end.endOffset);
		const before = doc.createRange();
		before.setStart(doc.body, 0);
		before.setEnd(start.startContainer, start.startOffset);
		const after = doc.createRange();
		after.setStart(end.endContainer, end.endOffset);
		after.setEnd(doc.body, doc.body.childNodes.length);
		const locator = Locator.deserialize({
			href,
			type: XHTML,
			locations: { progression: 0 },
			text: {
				highlight: exact.toString(),
				before: before.toString().slice(-32),
				after: after.toString().slice(0, 32)
			}
		});
		if (!locator) return;
		this.nav.applyDecorations(
			[
				{ id: `spike-${from}-${to}`, locator, style: { type: 'highlight', tint: 'rgb(255 214 0)' } }
			],
			'spike'
		);
	}

	clearHighlights() {
		this.nav?.applyDecorations([], 'spike');
	}

	pageCount() {
		const frame = this.#frames()[0];
		if (!frame) return 1;
		const doc = frame.window.document.documentElement;
		if (this.#layout === 'scroll')
			return Math.max(1, Math.round(doc.scrollHeight / frame.window.innerHeight));
		const columns = this.#layout === 'spread' ? 2 : 1;
		return Math.max(1, Math.round(doc.scrollWidth / frame.window.innerWidth / columns));
	}

	async injectFigure(afterWordId: number, src: string, alt: string) {
		const before = this.pageCount();
		const doc = this.documents()[0];
		const map = this.#map();
		if (!doc || !map || !insertFigure(doc, map, afterWordId, src, alt))
			return { before, after: before };
		const img = doc.querySelector<HTMLImageElement>('[data-injected] img');
		if (img && !img.complete)
			await new Promise((r) => img.addEventListener('load', r, { once: true }));
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
		await this.nav?.destroy();
		this.#relocateListeners.clear();
		this.#selectionListeners.clear();
	}
}
