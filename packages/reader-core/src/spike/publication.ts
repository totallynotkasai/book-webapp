// SPIKE (P0-04/P0-05): throwaway. Reads an EPUB into "prepared" documents that both engines
// render, standing in for text-pipeline output served through an OpenBook loader:
//   - resources (images, CSS) are rewritten to blob: URLs, as a local loader would serve them;
//   - Words are optionally wrapped in <span data-w> (P0-05 option A) with book-wide IDs.
// Both adapters get exactly the same files, so the comparison is about the engines.
import { openZip, type ZipArchive } from './zip';

export type WordMarking = 'spans' | 'none';

export interface SpikeSection {
	/** Path inside the archive (or a virtual path). */
	href: string;
	title: string;
	linear: boolean;
	/** Words in this section, when marked. */
	wordCount: number;
	/** First and last WordId, when marked. */
	firstWordId: number;
	lastWordId: number;
}

export interface SpikePublication {
	title: string;
	creator: string;
	lang: string;
	sections: SpikeSection[];
	toc: { label: string; href: string }[];
	marking: WordMarking;
	/** Prepared XHTML for a section: ready to render, all resources are blob: URLs. */
	document(href: string): Promise<string>;
	/** A blob: URL of the prepared section (foliate-js renders URLs). */
	documentUrl(href: string): Promise<string>;
	/** Raw bytes of any archive file. */
	file(path: string): Promise<Uint8Array>;
	release(): void;
}

export interface OpenOptions {
	marking: WordMarking;
	/** Merge these spine items (inclusive, linear only) into one long chapter, for budget tests. */
	mergeChapters?: { from: number; to: number };
}

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

function resolvePath(base: string, href: string): string {
	const url = new URL(href, `https://book.invalid/${base}`);
	return decodeURIComponent(url.pathname.slice(1));
}

function dirname(path: string): string {
	return path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
}

function mediaTypeFor(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase();
	return (
		{
			xhtml: 'application/xhtml+xml',
			html: 'application/xhtml+xml',
			htm: 'application/xhtml+xml',
			css: 'text/css',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			png: 'image/png',
			gif: 'image/gif',
			svg: 'image/svg+xml',
			webp: 'image/webp',
			woff2: 'font/woff2',
			woff: 'font/woff',
			ttf: 'font/ttf',
			otf: 'font/otf'
		}[ext ?? ''] ?? 'application/octet-stream'
	);
}

function parseXml(text: string, type: DOMParserSupportedType = 'application/xml'): Document {
	const doc = new DOMParser().parseFromString(text, type);
	if (doc.querySelector('parsererror')) {
		// Plenty of real EPUBs are not well-formed XHTML; fall back to the HTML parser.
		return new DOMParser().parseFromString(text, 'text/html');
	}
	return doc;
}

/** Wraps every word-like segment of the body's text in <span data-w="N">. Returns the next ID. */
export function markWords(doc: Document, lang: string, firstId: number): number {
	const segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
	const body = doc.body ?? doc.getElementsByTagNameNS(XHTML_NS, 'body')[0];
	if (!body) return firstId;
	const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node.parentElement?.closest('script, style, svg, [data-w]')
				? NodeFilter.FILTER_REJECT
				: NodeFilter.FILTER_ACCEPT
	});
	const textNodes: Text[] = [];
	while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

	let id = firstId;
	for (const node of textNodes) {
		const text = node.data;
		if (!/\p{L}|\p{N}/u.test(text)) continue;
		const fragment = doc.createDocumentFragment();
		for (const segment of segmenter.segment(text)) {
			if (segment.isWordLike) {
				const span = doc.createElementNS(XHTML_NS, 'span');
				span.setAttribute('data-w', String(id++));
				span.textContent = segment.segment;
				fragment.append(span);
			} else {
				fragment.append(doc.createTextNode(segment.segment));
			}
		}
		node.replaceWith(fragment);
	}
	return id;
}

export async function openPublication(
	epub: ArrayBuffer,
	options: OpenOptions
): Promise<SpikePublication> {
	const zip: ZipArchive = openZip(epub);
	const text = async (path: string) => new TextDecoder().decode(await zip.read(path));
	const blobUrls = new Map<string, Promise<string>>();
	const created: string[] = [];

	const container = parseXml(await text('META-INF/container.xml'));
	const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
	if (!opfPath) throw new Error('No OPF in container.xml');
	const opf = parseXml(await text(opfPath));
	const opfDir = dirname(opfPath);
	const meta = (name: string) =>
		opf.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', name)[0]?.textContent?.trim() ??
		'';
	const lang = meta('language') || 'en';

	const manifest = new Map<string, { href: string; properties: string }>();
	for (const item of opf.querySelectorAll('manifest > item')) {
		manifest.set(item.getAttribute('id') ?? '', {
			href: resolvePath(opfDir, item.getAttribute('href') ?? ''),
			properties: item.getAttribute('properties') ?? ''
		});
	}

	// TOC from the EPUB 3 nav document, for titles.
	const toc: { label: string; href: string }[] = [];
	const navItem = [...manifest.values()].find((i) => i.properties.split(' ').includes('nav'));
	if (navItem) {
		const nav = parseXml(await text(navItem.href), 'application/xhtml+xml');
		const tocNav =
			[...nav.querySelectorAll('nav')].find((n) =>
				(
					n.getAttribute('epub:type') ?? n.getAttributeNS('http://www.idpf.org/2007/ops', 'type')
				)?.includes('toc')
			) ?? nav.querySelector('nav');
		for (const a of tocNav?.querySelectorAll('a[href]') ?? []) {
			toc.push({
				label: a.textContent?.replace(/\s+/g, ' ').trim() ?? '',
				href: resolvePath(navItem.href, a.getAttribute('href') ?? '')
			});
		}
	}

	let spine = [...opf.querySelectorAll('spine > itemref')].map((ref) => ({
		href: manifest.get(ref.getAttribute('idref') ?? '')?.href ?? '',
		linear: ref.getAttribute('linear') !== 'no'
	}));
	spine = spine.filter((s) => s.href);

	async function blobUrl(path: string): Promise<string> {
		let url = blobUrls.get(path);
		if (!url) {
			url = (async () => {
				let data: BlobPart = (await zip.read(path)) as BlobPart;
				const type = mediaTypeFor(path);
				if (type === 'text/css')
					data = await rewriteCss(path, new TextDecoder().decode(data as Uint8Array));
				const href = URL.createObjectURL(new Blob([data], { type }));
				created.push(href);
				return href;
			})();
			blobUrls.set(path, url);
		}
		return url;
	}

	async function rewriteCss(path: string, css: string): Promise<string> {
		const urls = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)];
		for (const [match, , ref] of urls) {
			if (!ref || /^(data:|https?:|blob:)/.test(ref)) continue;
			const target = resolvePath(path, ref);
			if (zip.entries.has(target)) css = css.replace(match, `url("${await blobUrl(target)}")`);
		}
		return css;
	}

	async function prepare(path: string, body?: Element[]): Promise<Document> {
		const doc = parseXml(await text(path), 'application/xhtml+xml');
		if (body) {
			const target = doc.body ?? doc.getElementsByTagNameNS(XHTML_NS, 'body')[0];
			if (target) target.replaceChildren(...body.map((n) => doc.importNode(n, true)));
		}
		const refs: [Element, string][] = [];
		for (const el of doc.querySelectorAll('[src], link[href], image')) {
			for (const attr of ['src', 'href', 'xlink:href']) {
				const value = el.getAttribute(attr);
				if (value && !/^(#|data:|https?:|blob:|mailto:)/.test(value)) refs.push([el, attr]);
			}
		}
		for (const [el, attr] of refs) {
			const target = resolvePath(path, el.getAttribute(attr) ?? '');
			if (!zip.entries.has(target)) continue;
			const url = await blobUrl(target);
			if (attr === 'xlink:href')
				el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
			else el.setAttribute(attr, url);
		}
		return doc;
	}

	// Optionally merge chapters into one long section (criterion 7).
	interface Planned {
		href: string;
		source: string;
		linear: boolean;
		merge?: string[];
	}
	let planned: Planned[] = spine.map((s) => ({ href: s.href, source: s.href, linear: s.linear }));
	if (options.mergeChapters) {
		const linear = planned.filter((p) => p.linear);
		const group = linear.slice(options.mergeChapters.from, options.mergeChapters.to + 1);
		planned = [
			{
				href: `${group[0]!.href}.merged.xhtml`,
				source: group[0]!.href,
				linear: true,
				merge: group.map((g) => g.href)
			}
		];
	}

	// Prepare every section once, assigning book-wide WordIds in reading order.
	const prepared = new Map<string, string>();
	const sections: SpikeSection[] = [];
	let nextWordId = 1;
	for (const item of planned) {
		let body: Element[] | undefined;
		if (item.merge) {
			body = [];
			for (const href of item.merge) {
				const part = parseXml(await text(href), 'application/xhtml+xml');
				const partBody = part.body ?? part.getElementsByTagNameNS(XHTML_NS, 'body')[0];
				body.push(...[...(partBody?.children ?? [])]);
			}
		}
		const doc = await prepare(item.source, body);
		const first = nextWordId;
		if (options.marking === 'spans') nextWordId = markWords(doc, lang, nextWordId);
		const title =
			toc.find((t) => t.href.split('#')[0] === item.source)?.label ??
			doc.querySelector('h1, h2, h3')?.textContent?.trim() ??
			item.href;
		prepared.set(item.href, new XMLSerializer().serializeToString(doc));
		sections.push({
			href: item.href,
			title: item.merge
				? `${title} (chapters ${options.mergeChapters!.from + 1}–${options.mergeChapters!.to + 1} merged)`
				: title,
			linear: item.linear,
			wordCount: nextWordId - first,
			firstWordId: first,
			lastWordId: nextWordId - 1
		});
	}

	const docUrls = new Map<string, string>();
	async function preparedDocument(href: string): Promise<string> {
		const doc = prepared.get(href);
		if (doc === undefined) throw new Error(`No section ${href}`);
		return doc;
	}
	return {
		title: meta('title'),
		creator: meta('creator'),
		lang,
		sections,
		toc,
		marking: options.marking,
		document: preparedDocument,
		async documentUrl(href) {
			let url = docUrls.get(href);
			if (!url) {
				url = URL.createObjectURL(
					new Blob([await preparedDocument(href)], { type: 'application/xhtml+xml' })
				);
				docUrls.set(href, url);
				created.push(url);
			}
			return url;
		},
		file: (path) => zip.read(path),
		release() {
			for (const url of created) URL.revokeObjectURL(url);
		}
	};
}
