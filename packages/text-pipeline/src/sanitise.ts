/**
 * XHTML sanitising (DESIGN.md §7.1 step 2, §10.2, Invariant 10). Book content is untrusted: scripts,
 * frames, forms, embedded objects and media go; event handlers and `javascript:` URLs go; only an
 * allowlist of attributes survives; CSS goes through the allowlist in css.ts; anything that would
 * load from outside the EPUB is removed. Unknown elements are unwrapped rather than dropped, so
 * their text survives. The result is a clean XHTML tree, ready for Block marking.
 */
import type { IngestWarningCode } from '@book/core';
import { sanitiseDeclarations, sanitiseStylesheet, type CssContext } from './css';
import {
	attr,
	createElement,
	createText,
	EPUB_NS,
	isElement,
	isText,
	localName,
	MATHML_NS,
	normaliseTree,
	removeNode,
	replaceNode,
	setChildren,
	SVG_NS,
	textContent,
	unwrap,
	XHTML_NS,
	XLINK_NS,
	type ChildNode,
	type Document,
	type Element
} from './dom';
import { resolveInArchive } from './paths';

export interface SanitiseContext {
	/** Archive path of the document being sanitised. */
	path: string;
	/** The href to write for a file in the EPUB, or null if the file doesn't exist. */
	resourceHref(archivePath: string): string | null;
	/** The href to write for a link to another document, or null if it isn't a Chapter. */
	documentHref(archivePath: string, fragment: string | null): string | null;
	warn(code: IngestWarningCode, count?: number): void;
}

export interface SanitisedDocument {
	html: Element;
	head: Element;
	body: Element;
}

/** Removed with everything inside them. */
const REMOVE = new Set([
	'script',
	'iframe',
	'frame',
	'frameset',
	'object',
	'embed',
	'applet',
	'template',
	'base',
	'canvas',
	'input',
	'select',
	'textarea',
	'button',
	'option',
	'optgroup',
	'datalist',
	'output',
	'meter',
	'progress',
	'keygen',
	'portal',
	'noembed',
	'noframes',
	'param',
	'source',
	'track',
	'map',
	'area',
	'meta',
	'link',
	'head',
	'case'
]);
const MEDIA = new Set(['audio', 'video']);

/** Kept as they are (XHTML content elements). Anything else is unwrapped. */
const KEEP = new Set([
	'a',
	'abbr',
	'acronym',
	'address',
	'article',
	'aside',
	'b',
	'bdi',
	'bdo',
	'big',
	'blockquote',
	'br',
	'caption',
	'cite',
	'code',
	'col',
	'colgroup',
	'dd',
	'del',
	'details',
	'dfn',
	'div',
	'dl',
	'dt',
	'em',
	'figcaption',
	'figure',
	'footer',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'hgroup',
	'hr',
	'i',
	'img',
	'ins',
	'kbd',
	'li',
	'main',
	'mark',
	'nav',
	'ol',
	'p',
	'pre',
	'q',
	'rb',
	'rp',
	'rt',
	'rtc',
	'ruby',
	's',
	'samp',
	'section',
	'small',
	'span',
	'strike',
	'strong',
	'sub',
	'summary',
	'sup',
	'table',
	'tbody',
	'td',
	'tfoot',
	'th',
	'thead',
	'time',
	'tr',
	'tt',
	'u',
	'ul',
	'var',
	'wbr'
]);

const GLOBAL_ATTRS = new Set([
	'id',
	'class',
	'lang',
	'xml:lang',
	'dir',
	'title',
	'style',
	'role',
	'epub:type',
	'xml:space'
]);

const ELEMENT_ATTRS: Record<string, readonly string[]> = {
	a: ['href'],
	img: ['src', 'alt', 'width', 'height'],
	td: ['colspan', 'rowspan', 'headers', 'scope', 'abbr', 'align', 'valign', 'width'],
	th: ['colspan', 'rowspan', 'headers', 'scope', 'abbr', 'align', 'valign', 'width'],
	col: ['span', 'width'],
	colgroup: ['span', 'width'],
	ol: ['start', 'reversed', 'type'],
	ul: ['type'],
	li: ['value'],
	time: ['datetime'],
	ins: ['datetime'],
	del: ['datetime'],
	table: ['border', 'cellpadding', 'cellspacing', 'summary', 'width', 'align'],
	tr: ['align', 'valign'],
	p: ['align'],
	div: ['align'],
	h1: ['align'],
	h2: ['align'],
	h3: ['align'],
	h4: ['align'],
	h5: ['align'],
	h6: ['align'],
	details: ['open'],
	bdo: ['dir']
};

const SVG_ELEMENTS = new Set([
	'svg',
	'g',
	'path',
	'rect',
	'circle',
	'ellipse',
	'line',
	'polyline',
	'polygon',
	'text',
	'tspan',
	'title',
	'desc',
	'defs',
	'image',
	'lineargradient',
	'radialgradient',
	'stop',
	'clippath',
	'mask',
	'pattern',
	'symbol',
	'use'
]);

/** SVG element names are case-sensitive; the parser lowercases them. */
const SVG_CASE: Record<string, string> = {
	lineargradient: 'linearGradient',
	radialgradient: 'radialGradient',
	clippath: 'clipPath'
};

const SVG_ATTRS = new Set([
	'viewBox',
	'width',
	'height',
	'x',
	'y',
	'x1',
	'x2',
	'y1',
	'y2',
	'cx',
	'cy',
	'r',
	'rx',
	'ry',
	'd',
	'points',
	'fill',
	'fill-rule',
	'fill-opacity',
	'stroke',
	'stroke-width',
	'stroke-opacity',
	'stroke-linecap',
	'stroke-linejoin',
	'stroke-dasharray',
	'transform',
	'preserveAspectRatio',
	'opacity',
	'font-size',
	'font-family',
	'font-weight',
	'font-style',
	'text-anchor',
	'dominant-baseline',
	'offset',
	'stop-color',
	'stop-opacity',
	'gradientUnits',
	'gradientTransform',
	'clip-path',
	'clipPathUnits',
	'mask',
	'patternUnits',
	'version',
	'id',
	'class',
	'style',
	'href',
	'xlink:href'
]);

const RASTER_DATA_URI = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const SAFE_EXTERNAL = /^(https?:|mailto:)/i;

export function sanitiseDocument(doc: Document, ctx: SanitiseContext): SanitisedDocument {
	normaliseTree(doc);
	const css: CssContext = {
		resolveUrl: (url) => {
			const target = resolveInArchive(ctx.path, url);
			return target ? ctx.resourceHref(target.path) : null;
		}
	};

	let html = doc.children.find((c): c is Element => isElement(c) && localName(c) === 'html');
	if (!html) {
		// A fragment without <html>: wrap it.
		html = createElement('html');
		setChildren(html, [...doc.children]);
		setChildren(doc, [html]);
	}
	const sourceHead = html.children.find(
		(c): c is Element => isElement(c) && localName(c) === 'head'
	);
	let sourceBody = html.children.find((c): c is Element => isElement(c) && localName(c) === 'body');
	if (!sourceBody) {
		sourceBody = createElement('body');
		setChildren(
			sourceBody,
			html.children.filter((c) => c !== sourceHead)
		);
	}

	// <head>: the title and the book's own styles, sanitised.
	const head = createElement('head');
	const headChildren: ChildNode[] = [];
	let title = '';
	const styleElements: { href?: string; css?: string }[] = [];
	for (const el of sourceHead ? [...walkElements(sourceHead)] : []) {
		const name = localName(el);
		if (name === 'title') title = textContent(el).trim();
		if (name === 'link' && /\bstylesheet\b/i.test(attr(el, 'rel') ?? '')) {
			const target = resolveInArchive(ctx.path, attr(el, 'href') ?? '');
			const href = target ? ctx.resourceHref(target.path) : null;
			if (href) styleElements.push({ href });
			else ctx.warn('external_resource_removed');
		}
		if (name === 'style') {
			const result = sanitiseStylesheet(textContent(el), css);
			if (result.removed) ctx.warn('css_removed', result.removed);
			if (result.css) styleElements.push({ css: result.css });
		}
		if (name === 'script') ctx.warn('script_removed');
	}
	headChildren.push(withText(createElement('title'), title));
	for (const style of styleElements) {
		headChildren.push(
			style.href
				? createElement('link', { rel: 'stylesheet', type: 'text/css', href: style.href })
				: withText(createElement('style'), style.css!)
		);
	}
	setChildren(head, headChildren);

	// <body>: sanitised in place.
	const body = createElement('body', keepAttributes(sourceBody, 'body', ctx, css));
	setChildren(body, [...sourceBody.children]);
	sanitiseChildren(body, ctx, css, 'html');

	const rootAttrs: Record<string, string> = { xmlns: XHTML_NS, 'xmlns:epub': EPUB_NS };
	for (const name of ['lang', 'xml:lang', 'dir']) {
		const value = attr(html, name);
		if (value && (name !== 'dir' || /^(ltr|rtl|auto)$/.test(value))) rootAttrs[name] = value;
	}
	const root = createElement('html', rootAttrs);
	setChildren(root, [head, createText('\n'), body]);
	return { html: root, head, body };
}

function withText(element: Element, text: string): Element {
	if (text) setChildren(element, [createText(text)]);
	return element;
}

function* walkElements(root: Element): Generator<Element> {
	for (const child of root.children) {
		if (isElement(child)) {
			yield child;
			yield* walkElements(child);
		}
	}
}

type Mode = 'html' | 'svg' | 'math';

function sanitiseChildren(parent: Element, ctx: SanitiseContext, css: CssContext, mode: Mode) {
	for (const child of [...parent.children]) {
		if (isText(child)) continue;
		if (!isElement(child)) {
			removeNode(child);
			continue;
		}
		sanitiseElement(child, ctx, css, mode);
	}
}

function sanitiseElement(el: Element, ctx: SanitiseContext, css: CssContext, mode: Mode) {
	const name = localName(el);

	if (mode === 'html') {
		if (name === 'svg') return sanitiseSvgRoot(el, ctx, css);
		if (name === 'math') return sanitiseMath(el, ctx);
		if (name === 'script') {
			ctx.warn('script_removed');
			return removeNode(el);
		}
		if (MEDIA.has(name)) {
			ctx.warn('unsupported_media_removed');
			return removeNode(el);
		}
		if (name === 'style') {
			// A <style> in the body: keep its rules as a sanitised <style> in place.
			const result = sanitiseStylesheet(textContent(el), css);
			if (result.removed) ctx.warn('css_removed', result.removed);
			if (!result.css) return removeNode(el);
			el.name = 'style';
			el.attribs = {};
			setChildren(el, [createText(result.css)]);
			return;
		}
		if (el.name.toLowerCase() === 'epub:switch') {
			// EPUB 3 switch: keep only the default content.
			const fallback = el.children.find(
				(c): c is Element => isElement(c) && localName(c) === 'default'
			);
			replaceNode(el, fallback ? [...fallback.children] : []);
			if (fallback) {
				for (const child of fallback.children)
					if (isElement(child)) sanitiseElement(child, ctx, css, mode);
			}
			return;
		}
		if (REMOVE.has(name)) {
			ctx.warn('unsafe_element_removed');
			return removeNode(el);
		}
		if (name === 'img' && !sanitiseImage(el, ctx)) return removeNode(el);
		if (!KEEP.has(name)) {
			sanitiseChildren(el, ctx, css, mode);
			return unwrap(el);
		}
		el.name = name;
		el.attribs = keepAttributes(el, name, ctx, css);
		sanitiseChildren(el, ctx, css, mode);
	}
}

function keepAttributes(
	el: Element,
	name: string,
	ctx: SanitiseContext,
	css: CssContext
): Record<string, string> {
	const out: Record<string, string> = {};
	const allowed = ELEMENT_ATTRS[name] ?? [];
	let unsafe = 0;
	for (const [rawName, value] of Object.entries(el.attribs)) {
		const attrName = rawName.toLowerCase();
		if (attrName.startsWith('on')) {
			unsafe++;
			continue;
		}
		if (attrName === 'style') {
			const result = sanitiseDeclarations(value, css);
			if (result.removed) ctx.warn('css_removed', result.removed);
			if (result.css) out.style = result.css;
			continue;
		}
		if (attrName === 'href' && name === 'a') {
			const href = linkHref(value, ctx);
			if (href === null) unsafe++;
			else if (href !== undefined) out.href = href;
			continue;
		}
		if (attrName === 'src' || attrName === 'alt') {
			if (name === 'img') out[attrName] = value;
			continue;
		}
		if (attrName.startsWith('aria-') || GLOBAL_ATTRS.has(attrName) || allowed.includes(attrName)) {
			out[attrName] = value;
		}
	}
	if (unsafe) ctx.warn('unsafe_attribute_removed', unsafe);
	return out;
}

/** The href to write for a link, undefined to drop it quietly, or null if it was unsafe. */
function linkHref(value: string, ctx: SanitiseContext): string | null | undefined {
	const trimmed = value.trim();
	if (trimmed.startsWith('#')) return trimmed;
	if (SAFE_EXTERNAL.test(trimmed)) return trimmed;
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
	const target = resolveInArchive(ctx.path, trimmed);
	if (!target) return undefined;
	return ctx.documentHref(target.path, target.fragment) ?? undefined;
}

/** Rewrites an image's src; returns false if the image has to go. */
function sanitiseImage(el: Element, ctx: SanitiseContext): boolean {
	const src = (attr(el, 'src') ?? '').trim();
	if (attr(el, 'alt') === undefined) ctx.warn('missing_alt');
	if (RASTER_DATA_URI.test(src)) return true;
	const target = resolveInArchive(ctx.path, src);
	if (!target) {
		ctx.warn('external_resource_removed');
		return false;
	}
	const href = ctx.resourceHref(target.path);
	if (!href) {
		ctx.warn('missing_resource');
		return false;
	}
	el.attribs.src = href;
	return true;
}

function sanitiseSvgRoot(el: Element, ctx: SanitiseContext, css: CssContext) {
	sanitiseSvg(el, ctx, css);
	el.attribs.xmlns = SVG_NS;
	if (Object.keys(el.attribs).some((a) => a.startsWith('xlink:')) || usesXlink(el)) {
		el.attribs['xmlns:xlink'] = XLINK_NS;
	}
}

function usesXlink(el: Element): boolean {
	return el.children.some(
		(c) =>
			isElement(c) && (Object.keys(c.attribs).some((a) => a.startsWith('xlink:')) || usesXlink(c))
	);
}

/** SVG keeps its case-sensitive names (viewBox, linearGradient) and an allowlist of the rest. */
export function sanitiseSvg(el: Element, ctx: SanitiseContext, css: CssContext) {
	const name = localName(el);
	if (!SVG_ELEMENTS.has(name)) {
		if (name === 'script') ctx.warn('script_removed');
		else ctx.warn('unsafe_element_removed');
		return removeNode(el);
	}
	el.name = SVG_CASE[name] ?? name;
	const out: Record<string, string> = {};
	for (const [attrName, value] of Object.entries(el.attribs)) {
		if (!SVG_ATTRS.has(attrName)) continue;
		if (attrName === 'style') {
			const result = sanitiseDeclarations(value, css);
			if (result.css) out.style = result.css;
			continue;
		}
		if (attrName === 'href' || attrName === 'xlink:href') {
			const trimmed = value.trim();
			if (trimmed.startsWith('#')) out[attrName] = trimmed;
			else if (name === 'image' && RASTER_DATA_URI.test(trimmed)) out[attrName] = trimmed;
			else if (name === 'image') {
				const target = resolveInArchive(ctx.path, trimmed);
				const href = target ? ctx.resourceHref(target.path) : null;
				if (href) out[attrName] = href;
				else ctx.warn(target ? 'missing_resource' : 'external_resource_removed');
			}
			continue;
		}
		if (/url\(\s*['"]?(?!#)/i.test(value)) continue;
		out[attrName] = value;
	}
	el.attribs = out;
	for (const child of [...el.children]) {
		if (isText(child)) continue;
		if (isElement(child)) sanitiseSvg(child, ctx, css);
		else removeNode(child);
	}
}

/** MathML: elements kept, anything that could link or run removed. */
function sanitiseMath(el: Element, ctx: SanitiseContext) {
	const visit = (node: Element) => {
		node.name = localName(node);
		let unsafe = 0;
		for (const name of Object.keys(node.attribs)) {
			const lower = name.toLowerCase();
			if (lower.startsWith('on') || lower.includes('href') || lower === 'src') {
				delete node.attribs[name];
				unsafe++;
			}
		}
		if (unsafe) ctx.warn('unsafe_attribute_removed', unsafe);
		for (const child of [...node.children]) {
			if (isElement(child)) {
				if (localName(child) === 'script') {
					ctx.warn('script_removed');
					removeNode(child);
				} else visit(child);
			} else if (!isText(child)) removeNode(child);
		}
	};
	visit(el);
	el.attribs.xmlns = MATHML_NS;
}
