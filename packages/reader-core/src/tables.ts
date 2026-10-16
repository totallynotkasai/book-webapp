/**
 * Squeezed tables and the table viewer (P1-RDR-12, DESIGN.md §4.10).
 *
 * A table is squeezed when the page is too narrow for it without breaking its words: laid out
 * at its narrowest with every word whole, it's wider than the room it has (the status window's
 * stat table on a phone at 200%, whose cells otherwise wrap a letter or two per line). Such a
 * table gets an "Open table" button above its corner, and the viewer shows a copy of it.
 *
 * The copy is for the app's own document, so it's rebuilt rather than cloned: elements and
 * attributes from an allowlist, text only as text, links as plain text, pictures only from the
 * Revision's own blob URLs, and the look the frame computed (fonts, colours, borders, spacing)
 * set inline. Book content is untrusted (Invariant 10): nothing of its markup or CSS crosses as
 * it was.
 */
import type { TableView } from './types';

const XHTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';

/** Marks the "Open table" row injected above a squeezed table (skipped by the word map). */
export const TABLE_ROW = 'data-rd-table';

/** Marks the copy measured to find a table's narrowest layout (styles.ts). */
const PROBE = 'data-rd-probe';

/**
 * A box's own width. A table split across pages (the paginator's columns) has a bounding box,
 * and an `offsetWidth`, as wide as all its pieces together; each piece is as wide as the table.
 */
function widthOf(el: Element): number {
	return Math.max(0, ...[...el.getClientRects()].map((r) => r.width));
}

/** Whether a laid-out table is squeezed. Measures a copy beside it, removed straight away. */
export function isSqueezed(table: Element): boolean {
	const width = widthOf(table);
	if (!width) return false;
	const probe = table.cloneNode(true) as Element;
	// Block indexes and ids stay unique: the word map finds Blocks by `data-b`.
	for (const el of [probe, ...probe.querySelectorAll('[data-b], [id]')]) {
		el.removeAttribute('data-b');
		el.removeAttribute('id');
	}
	probe.setAttribute(PROBE, '');
	table.after(probe);
	const narrowest = widthOf(probe);
	probe.remove();
	return narrowest > width + 1;
}

/** The row with the "Open table" button, placed just before the table. */
export function tableRow(doc: Document, button: { label: string; icon: string }): Element {
	const row = doc.createElementNS(XHTML, 'div');
	row.setAttribute('data-injected', 'table');
	row.setAttribute(TABLE_ROW, '');
	const open = doc.createElementNS(XHTML, 'button');
	open.setAttribute('type', 'button');
	const pill = doc.createElementNS(XHTML, 'span');
	const svg = doc.createElementNS(SVG, 'svg');
	svg.setAttribute('viewBox', '0 -960 960 960');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	const path = doc.createElementNS(SVG, 'path');
	path.setAttribute('d', button.icon);
	svg.append(path);
	pill.append(svg, doc.createTextNode(button.label));
	open.append(pill);
	row.append(open);
	return row;
}

/** The table a row's button opens. */
export function tableOfRow(row: Element): Element | null {
	const next = row.nextElementSibling;
	return next?.localName === 'table' ? next : null;
}

/** Elements copied as themselves; anything else is unwrapped (its contents kept). */
const ELEMENTS = new Set([
	'table',
	'caption',
	'colgroup',
	'col',
	'thead',
	'tbody',
	'tfoot',
	'tr',
	'th',
	'td',
	'p',
	'div',
	'span',
	'br',
	'b',
	'strong',
	'i',
	'em',
	'u',
	's',
	'small',
	'sub',
	'sup',
	'code',
	'kbd',
	'samp',
	'var',
	'abbr',
	'cite',
	'q',
	'mark',
	'dfn',
	'ul',
	'ol',
	'li',
	'dl',
	'dt',
	'dd',
	'pre',
	'blockquote',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6'
]);

/** Left out with everything in them. */
const DROPPED = new Set([
	'script',
	'style',
	'link',
	'template',
	'iframe',
	'object',
	'embed',
	'svg',
	'math',
	'video',
	'audio',
	'canvas',
	'button',
	'input',
	'select',
	'textarea',
	'form',
	'noscript'
]);

/** Attributes that keep a table's meaning, per element; `lang` and `dir` on any. */
const ATTRIBUTES: Record<string, readonly string[]> = {
	th: ['colspan', 'rowspan', 'scope', 'abbr'],
	td: ['colspan', 'rowspan'],
	col: ['span'],
	colgroup: ['span'],
	ol: ['start', 'reversed', 'type'],
	abbr: ['title']
};

/** The computed look carried across, as inline styles. */
const LOOK = [
	'font-family',
	'font-size',
	'font-weight',
	'font-style',
	'font-variant-numeric',
	'line-height',
	'letter-spacing',
	'text-align',
	'text-transform',
	'text-decoration-line',
	'vertical-align',
	'white-space',
	'color',
	'background-color',
	'list-style-type'
];
const BOX = ['top', 'right', 'bottom', 'left'].flatMap((side) => [
	`padding-${side}`,
	`border-${side}-width`,
	`border-${side}-style`,
	`border-${side}-color`
]);
const MARGINS = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
const TABLE_LOOK = ['border-collapse', 'border-spacing', 'caption-side'];
/** A table's own parts, which take no margins. */
const TABLE_PARTS = new Set([
	'table',
	'caption',
	'colgroup',
	'col',
	'thead',
	'tbody',
	'tfoot',
	'tr',
	'th',
	'td',
	'br'
]);

function copyLook(from: Element, to: HTMLElement, names: readonly string[]) {
	const style = from.ownerDocument.defaultView?.getComputedStyle(from);
	if (!style) return;
	for (const name of names) {
		const value = style.getPropertyValue(name);
		// Computed values are concrete (px, rgb()); nothing here can load anything.
		if (value && !/url\(|expression|image-set/i.test(value)) to.style.setProperty(name, value);
	}
}

function copyAttributes(from: Element, to: HTMLElement) {
	for (const name of [...(ATTRIBUTES[from.localName] ?? []), 'lang', 'dir']) {
		const value =
			from.getAttribute(name) ?? (name === 'lang' ? from.getAttribute('xml:lang') : null);
		if (value !== null && /^[\w\s-]{0,40}$/.test(value)) to.setAttribute(name, value);
	}
}

function copyNode(node: Node, target: Document, into: Node) {
	if (node.nodeType === 3 /* Node.TEXT_NODE */) {
		into.appendChild(target.createTextNode(node.nodeValue ?? ''));
		return;
	}
	if (node.nodeType !== 1 /* Node.ELEMENT_NODE */) return;
	const el = node as Element;
	const name = el.localName;
	if (DROPPED.has(name) || el.hasAttribute('data-injected') || el.hasAttribute(TABLE_ROW)) return;
	if (name === 'img') {
		copyImage(el, target, into);
		return;
	}
	if (!ELEMENTS.has(name)) {
		// A link is its text (the viewer is for reading); anything unknown, its contents.
		for (const child of el.childNodes) copyNode(child, target, into);
		return;
	}
	const copy = target.createElement(name);
	copyAttributes(el, copy);
	if (name !== 'br') copyLook(el, copy, [...LOOK, ...BOX]);
	// Paragraphs and lists in a cell keep their spacing; the table's own parts have none.
	if (!TABLE_PARTS.has(name)) copyLook(el, copy, MARGINS);
	for (const child of el.childNodes) copyNode(child, target, copy);
	into.appendChild(copy);
}

/** A picture from the Revision itself (a blob URL) is kept; anything else becomes its alt text. */
function copyImage(img: Element, target: Document, into: Node) {
	const src = img.getAttribute('src') ?? '';
	const alt = img.getAttribute('alt') ?? '';
	if (!src.startsWith('blob:')) {
		if (alt) into.appendChild(target.createTextNode(alt));
		return;
	}
	const copy = target.createElement('img');
	copy.setAttribute('src', src);
	copy.setAttribute('alt', alt);
	const box = img.getBoundingClientRect();
	if (box.width && box.height) {
		copy.style.width = `${box.width}px`;
		copy.style.height = `${box.height}px`;
	}
	into.appendChild(copy);
}

/** The colour behind a table in the page: the first ancestor with a background, else the page's. */
function backgroundOf(table: Element): string {
	const view = table.ownerDocument.defaultView;
	for (let el: Element | null = table; el; el = el.parentElement) {
		const colour = view?.getComputedStyle(el).backgroundColor;
		if (colour && colour !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(colour)) return colour;
	}
	return 'transparent';
}

/** A copy of a table in the frame for the viewer, made in `target` (the app's document). */
export function tableView(table: Element, target: Document): TableView {
	const holder = target.createElement('div');
	copyNode(table, target, holder);
	const copy = holder.firstElementChild as HTMLTableElement;
	copyLook(table, copy, TABLE_LOOK);
	const caption = table.querySelector(':scope > caption')?.textContent?.replace(/\s+/g, ' ').trim();
	const view = table.ownerDocument.defaultView;
	return {
		table: copy,
		background: backgroundOf(table),
		color: view?.getComputedStyle(table).color ?? '',
		caption: caption || null
	};
}
