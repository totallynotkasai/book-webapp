/**
 * Prepares a Chapter for the engine (ADR-001): reads it through the `ContentLoader`, points its
 * images, stylesheets and fonts at blob URLs (a blob document can't resolve relative URLs), adds
 * a strict Content-Security-Policy (§9.8), and hands foliate-js a blob URL to load.
 *
 * In Phase 2 the loader can serve content-token URLs, where relative URLs resolve by themselves;
 * the rewriting then simply finds nothing to do.
 */
import { revisionPaths, wordIndexSchema, type WordIndex } from '@book/core';
import type { ContentLoader } from './types';

const XHTML = 'application/xhtml+xml';
const CSP =
	"default-src 'none'; img-src blob: data:; style-src blob: 'unsafe-inline'; font-src blob: data: 'self'; script-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'";

function resolve(from: string, href: string): string | null {
	if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//'))
		return null;
	try {
		const url = new URL(href, `https://book.invalid/${from}`);
		return decodeURIComponent(url.pathname.slice(1));
	} catch {
		return null;
	}
}

export class ChapterContent {
	readonly #loader: ContentLoader;
	readonly #urls = new Map<string, Promise<string>>();
	readonly #created: string[] = [];

	constructor(loader: ContentLoader) {
		this.#loader = loader;
	}

	async #blobUrl(blob: Blob): Promise<string> {
		const url = URL.createObjectURL(blob);
		this.#created.push(url);
		return url;
	}

	/** A blob URL for a Revision file; stylesheets get their own url()s rewritten first. */
	resourceUrl(path: string): Promise<string> {
		let url = this.#urls.get(path);
		if (!url) {
			url = (async () => {
				const blob = await this.#loader.read(path);
				if (path.endsWith('.css') || blob.type === 'text/css') {
					const css = await this.#rewriteCss(await blob.text(), path);
					return this.#blobUrl(new Blob([css], { type: 'text/css' }));
				}
				return this.#blobUrl(blob);
			})();
			this.#urls.set(path, url);
		}
		return url;
	}

	async #rewriteCss(css: string, path: string): Promise<string> {
		const matches = [...css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)];
		let out = css;
		for (const [match, , ref] of matches) {
			const target = ref ? resolve(path, ref) : null;
			if (!target) continue;
			try {
				out = out.replace(match, `url("${await this.resourceUrl(target)}")`);
			} catch {
				// A missing file: leave the reference to fail quietly, as a browser would.
			}
		}
		return out;
	}

	/** The Chapter as a blob URL foliate-js can load into its frame. */
	async chapterUrl(href: string): Promise<string> {
		const path = revisionPaths.chapter(href);
		const text = await (await this.#loader.read(path)).text();
		let doc = new DOMParser().parseFromString(text, XHTML);
		if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(text, 'text/html');

		const refs: [Element, string][] = [];
		for (const el of doc.querySelectorAll('img[src], link[href], image')) {
			for (const name of ['src', 'href', 'xlink:href']) {
				const value = el.getAttribute(name);
				if (value) refs.push([el, name]);
			}
		}
		await Promise.all(
			refs.map(async ([el, name]) => {
				const target = resolve(path, el.getAttribute(name)!);
				if (!target) return;
				try {
					const url = await this.resourceUrl(target);
					if (name === 'xlink:href') el.setAttributeNS('http://www.w3.org/1999/xlink', name, url);
					else el.setAttribute(name, url);
				} catch {
					// Missing resource: leave it broken rather than fail the Chapter.
				}
			})
		);
		for (const el of doc.querySelectorAll('[style*="url("]')) {
			el.setAttribute('style', await this.#rewriteCss(el.getAttribute('style')!, path));
		}
		for (const el of doc.querySelectorAll('style')) {
			el.textContent = await this.#rewriteCss(el.textContent ?? '', path);
		}

		const head = doc.querySelector('head');
		if (head) {
			const meta = doc.createElementNS('http://www.w3.org/1999/xhtml', 'meta');
			meta.setAttribute('http-equiv', 'Content-Security-Policy');
			meta.setAttribute('content', CSP);
			head.prepend(meta);
		}
		const serialised = new XMLSerializer().serializeToString(doc);
		return this.#blobUrl(new Blob([serialised], { type: XHTML }));
	}

	async wordIndex(chapterId: string): Promise<WordIndex> {
		const blob = await this.#loader.read(revisionPaths.wordIndex(chapterId));
		return wordIndexSchema.parse(JSON.parse(await blob.text())) as WordIndex;
	}

	release() {
		for (const url of this.#created) URL.revokeObjectURL(url);
		this.#created.length = 0;
		this.#urls.clear();
	}
}
