/**
 * A small DOM layer over htmlparser2, the same in browsers, Web Workers (no DOMParser there) and
 * Node, plus our own serializer, so ingest output is byte-identical everywhere (§7.1).
 */
import { CDATA, Comment, Document, Element, ProcessingInstruction, Text } from 'domhandler';
import type { ChildNode, ParentNode } from 'domhandler';
import { parseDocument } from 'htmlparser2';

export { Document, Element, Text };
export type { ChildNode, ParentNode };

export const XHTML_NS = 'http://www.w3.org/1999/xhtml';
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';
export const EPUB_NS = 'http://www.idpf.org/2007/ops';
export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

/**
 * Parses markup leniently: HTML entity decoding, case-insensitive tags and implied end tags, so
 * real-world EPUBs that aren't well-formed still parse. Self-closing tags are honoured as XML has
 * them, and attribute names keep their case (SVG needs viewBox); sanitise.ts restores the few
 * camelCase SVG element names.
 */
export function parseMarkup(text: string): Document {
	return parseDocument(text, {
		xmlMode: false,
		decodeEntities: true,
		lowerCaseTags: true,
		lowerCaseAttributeNames: false,
		recognizeCDATA: true,
		recognizeSelfClosing: true
	});
}

/** Parses an XML document that isn't XHTML (container.xml, the OPF, NCX). */
export function parseXml(text: string): Document {
	return parseDocument(text, { xmlMode: true, decodeEntities: true });
}

export function isElement(node: ChildNode | ParentNode | null | undefined): node is Element {
	return node instanceof Element;
}

export function isText(node: ChildNode | null | undefined): node is Text {
	return node instanceof Text;
}

/** The name without a namespace prefix, lowercased: `epub:switch` → `switch`. */
export function localName(element: Element): string {
	const name = element.name;
	const colon = name.indexOf(':');
	return (colon >= 0 ? name.slice(colon + 1) : name).toLowerCase();
}

/** Elements in document order, depth first. */
export function* elements(root: ParentNode): Generator<Element> {
	for (const child of [...root.children]) {
		if (isElement(child)) {
			yield child;
			yield* elements(child);
		}
	}
}

export function findFirst(root: ParentNode, test: (el: Element) => boolean): Element | undefined {
	for (const el of elements(root)) if (test(el)) return el;
	return undefined;
}

export function findAll(root: ParentNode, test: (el: Element) => boolean): Element[] {
	return [...elements(root)].filter(test);
}

/** Elements matching a local name, ignoring any namespace prefix (`dc:title` matches `title`). */
export function byLocalName(root: ParentNode, name: string): Element[] {
	return findAll(root, (el) => localName(el) === name);
}

export function textContent(node: ChildNode | ParentNode): string {
	if (node instanceof Text) return node.data;
	if ('children' in node) return node.children.map((c) => textContent(c)).join('');
	return '';
}

/** An attribute by exact name, or by local name across prefixes (`epub:type`, `xlink:href`). */
export function attr(element: Element, name: string): string | undefined {
	const exact = element.attribs[name];
	if (exact !== undefined) return exact;
	for (const [key, value] of Object.entries(element.attribs)) {
		const colon = key.indexOf(':');
		if (colon >= 0 && key.slice(colon + 1) === name) return value;
	}
	return undefined;
}

function setParent(nodes: ChildNode[], parent: ParentNode) {
	nodes.forEach((node, i) => {
		node.parent = parent;
		node.prev = nodes[i - 1] ?? null;
		node.next = nodes[i + 1] ?? null;
	});
}

export function setChildren(parent: ParentNode, children: ChildNode[]) {
	parent.children = children;
	setParent(children, parent);
}

export function removeNode(node: ChildNode) {
	const parent = node.parent;
	if (!parent) return;
	setChildren(
		parent,
		parent.children.filter((c) => c !== node)
	);
	node.parent = null;
}

/** Replaces an element with its children. */
export function unwrap(element: Element) {
	const parent = element.parent;
	if (!parent) return;
	const index = parent.children.indexOf(element);
	setChildren(parent, [
		...parent.children.slice(0, index),
		...element.children,
		...parent.children.slice(index + 1)
	]);
}

export function replaceNode(node: ChildNode, replacement: ChildNode[]) {
	const parent = node.parent;
	if (!parent) return;
	const index = parent.children.indexOf(node);
	setChildren(parent, [
		...parent.children.slice(0, index),
		...replacement,
		...parent.children.slice(index + 1)
	]);
}

export function createElement(name: string, attribs: Record<string, string> = {}): Element {
	return new Element(name, attribs, []);
}

export function createText(data: string): Text {
	return new Text(data);
}

export function appendChild(parent: ParentNode, child: ChildNode) {
	setChildren(parent, [...parent.children, child]);
}

/**
 * Simplifies a parsed tree for XHTML output: CDATA becomes text (browsers' XML parser would make
 * it a CDATASection, which text walkers skip), comments and processing instructions go.
 */
export function normaliseTree(root: ParentNode) {
	const out: ChildNode[] = [];
	for (const child of root.children) {
		if (child instanceof CDATA) {
			out.push(createText(textContent(child)));
		} else if (child instanceof Comment || child instanceof ProcessingInstruction) {
			continue;
		} else {
			if (child instanceof Element) normaliseTree(child);
			out.push(child);
		}
	}
	// Merge neighbouring text so the tree matches what a browser parses from our output.
	const merged: ChildNode[] = [];
	for (const node of out) {
		const last = merged[merged.length - 1];
		if (node instanceof Text && last instanceof Text) last.data += node.data;
		else merged.push(node);
	}
	setChildren(
		root,
		merged.filter((n) => !(n instanceof Text && n.data === ''))
	);
}

const TEXT_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const ATTR_ESCAPES: Record<string, string> = { ...TEXT_ESCAPES, '"': '&quot;' };

function escapeText(text: string): string {
	return text.replace(/[&<>]/g, (c) => TEXT_ESCAPES[c]!);
}

function escapeAttr(text: string): string {
	// Tabs and newlines in attribute values are kept as character references, or XML would
	// normalise them to spaces.
	return text
		.replace(/[&<>"]/g, (c) => ATTR_ESCAPES[c]!)
		.replace(/\t/g, '&#9;')
		.replace(/\n/g, '&#10;');
}

/** Serialises well-formed XML. Empty elements self-close; attribute order is kept. */
export function serialize(node: ChildNode | ParentNode): string {
	if (node instanceof Text) return escapeText(node.data);
	if (node instanceof Element) {
		const attrs = Object.entries(node.attribs)
			.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
			.join('');
		if (node.children.length === 0) return `<${node.name}${attrs}/>`;
		return `<${node.name}${attrs}>${node.children.map(serialize).join('')}</${node.name}>`;
	}
	if ('children' in node) return node.children.map(serialize).join('');
	return '';
}

/** True for UTF-16 code units XML 1.0 can't hold (C0 controls except tab, LF, CR; U+FFFE/FFFF). */
function forbiddenInXml(unit: number): boolean {
	return (
		(unit < 0x20 && unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) ||
		unit === 0xfffe ||
		unit === 0xffff
	);
}

/**
 * Normalises raw text before parsing: a leading BOM goes, line endings become LF (as XML parsers
 * do), and characters XML can't hold (including unpaired surrogates) are removed, so offsets
 * computed here match the browser's DOM.
 */
export function normaliseSource(text: string): string {
	const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	let out = '';
	let start = 0;
	for (let i = 0; i < source.length; i++) {
		const unit = source.charCodeAt(i);
		let drop = forbiddenInXml(unit);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = source.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				i++;
				continue;
			}
			drop = true;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) drop = true;
		if (drop) {
			out += source.slice(start, i);
			start = i + 1;
		}
	}
	out += source.slice(start);
	return out.replace(/\r\n?/g, '\n');
}

/** Decodes a file's bytes, honouring a BOM or an XML encoding declaration. */
export function decodeText(bytes: Uint8Array): string {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
	const head = new TextDecoder('ascii').decode(bytes.subarray(0, 200));
	const declared = /^<\?xml[^>]*encoding=["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1];
	if (declared && declared.toLowerCase() !== 'utf-8') {
		try {
			return new TextDecoder(declared).decode(bytes);
		} catch {
			// An encoding the runtime doesn't know: fall back to UTF-8, the EPUB default.
		}
	}
	return new TextDecoder('utf-8').decode(bytes);
}
