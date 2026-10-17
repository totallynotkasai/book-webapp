/**
 * Overview mode (P1-RDR-17, DESIGN.md §4.1): the current Chapter's pages, measured from the
 * layout the paginator already has. Nothing is laid out again, so it never touches more than the
 * current Chapter (§9.2), and a thumbnail shows exactly the Words its page shows.
 *
 * foliate-js lays a Chapter out in columns, one page (or spread) per `size` pixels along the
 * frame: page k of a left-to-right Chapter is x ∈ [k·size, (k+1)·size) in the frame's own
 * coordinates; a right-to-left Chapter's pages run from the frame's right edge. A page's
 * drawing is its lines of text (each Word's punctuation with it), pictures and the boxes behind
 * styled blocks, in page coordinates: the look the page computed, never the Book's markup
 * (Invariant 10).
 */
import type { PageBox, PageDrawing } from './types';
import type { DocWordMap } from './word-map';

export interface PageGeometry {
	/** A page's (or spread's) width, and its height. */
	size: number;
	height: number;
	/** How many pages the Chapter has. */
	count: number;
	/** The frame's width: every page side by side. */
	frameWidth: number;
	rtl: boolean;
}

/** Where page k starts along the frame. */
function pageLeft(g: PageGeometry, k: number): number {
	return g.rtl ? g.frameWidth - (k + 1) * g.size : k * g.size;
}

/** The page a box is on, by its centre. */
export function pageOf(g: PageGeometry, rect: { left: number; right: number }): number {
	const centre = (rect.left + rect.right) / 2;
	const k = Math.floor((g.rtl ? g.frameWidth - centre : centre) / g.size);
	return Math.min(g.count - 1, Math.max(0, k));
}

const shown = (r: DOMRect) => r.width > 0 || r.height > 0;

/** The page a Word starts on, or -1 when it isn't laid out (hidden, or no box). */
function wordPage(map: DocWordMap, g: PageGeometry, i: number): number {
	const rect = [...(map.range(i)?.getClientRects() ?? [])].find(shown);
	return rect ? pageOf(g, rect) : -1;
}

/**
 * The first Word on each page, by binary search over the Chapter's Words (they're in reading
 * order, so their pages never go back): a page that no Word starts on gets -1.
 */
export function pageStarts(map: DocWordMap, g: PageGeometry): number[] {
	const n = map.words.count;
	const pages = new Map<number, number>();
	/** The page of Word i, or of the next Word that has one (count past the end). */
	const at = (i: number): number => {
		for (let j = i; j < n; j++) {
			let p = pages.get(j);
			if (p === undefined) pages.set(j, (p = wordPage(map, g, j)));
			if (p >= 0) return p;
		}
		return g.count;
	};
	const starts: number[] = [];
	/** Pages only go forward: each search starts from the last page's first Word. */
	let after = 0;
	for (let k = 0; k < g.count; k++) {
		let lo = after;
		let hi = n - 1;
		let found = n;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (at(mid) >= k) {
				found = mid;
				hi = mid - 1;
			} else lo = mid + 1;
		}
		// The first Word on or after page k: it starts on page k, or k has none.
		let first = found;
		while (first < n && pages.get(first) === -1) first++;
		if (first < n && at(first) === k) {
			starts.push(first);
			after = first;
		} else starts.push(-1);
	}
	return starts;
}

interface Line {
	x: number;
	y: number;
	right: number;
	bottom: number;
	/** The edge the next Word continues from: the right one, or the left in right-to-left text. */
	edge: number;
	runs: { text: string; style: number }[];
	lastWord: number;
}

const TRANSPARENT = /^(transparent|rgba\([^)]*,\s*0\))$/;

/** One page's lines, pictures and boxes (see the module comment). */
export function drawPage(
	map: DocWordMap,
	g: PageGeometry,
	k: number,
	starts: number[],
	punctuated: string[]
): PageDrawing {
	const doc = map.doc;
	const win = doc.defaultView!;
	const left = pageLeft(g, k);
	const n = map.words.count;
	const words = map.words.index.words;
	// From the Word before this page's first (it may run on to this page) to the next page's.
	const startOf = (p: number) => {
		for (let q = p; q < g.count; q++) if (starts[q]! >= 0) return starts[q]!;
		return n;
	};
	const from = Math.max(0, startOf(k) - 1);
	const to = startOf(k + 1) - 1;

	const styles: PageDrawing['styles'] = [];
	const styleIds = new Map<string, number>();
	const byElement = new Map<Element, number>();
	const styleOf = (el: Element): number => {
		let id = byElement.get(el);
		if (id !== undefined) return id;
		const cs = win.getComputedStyle(el);
		const variant = cs.fontVariantCaps === 'small-caps' ? 'small-caps ' : '';
		const style = {
			font: `${cs.fontStyle} ${variant}${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
			color: cs.color,
			transform: cs.textTransform === 'none' ? '' : cs.textTransform,
			spacing: cs.letterSpacing === 'normal' ? '' : cs.letterSpacing
		};
		const key = JSON.stringify(style);
		id = styleIds.get(key);
		if (id === undefined) {
			id = styles.length;
			styles.push(style);
			styleIds.set(key, id);
		}
		byElement.set(el, id);
		return id;
	};

	const blockTexts = new Map<number, string>();
	/** Whether the page has a space before Word i ("Rabbit-Hole" has none after the hyphen). */
	const spaced = (i: number) => {
		const before = words[i - 1];
		const word = words[i]!;
		if (!before || before[1] !== word[1]) return true;
		let text = blockTexts.get(word[1]);
		if (text === undefined) blockTexts.set(word[1], (text = map.blockText(word[1])));
		return /\s/u.test(text.slice(before[3], word[2]));
	};

	const hyphenation = new Map<Element, boolean>();
	const hyphenates = (el: Element) => {
		let h = hyphenation.get(el);
		if (h === undefined) {
			const cs = win.getComputedStyle(el) as CSSStyleDeclaration & { webkitHyphens?: string };
			h = (cs.hyphens || cs.webkitHyphens) === 'auto';
			hyphenation.set(el, h);
		}
		return h;
	};

	const lines: Line[] = [];
	const containers = new Set<Element>();
	for (let i = from; i <= to && i < n; i++) {
		const range = map.range(i);
		if (!range) continue;
		const text = punctuated[i] ?? range.toString();
		// Measured with its punctuation (“Well!”), where it's in the same text node, so a line
		// takes the room its quotes and full stops take on the page.
		const own = range.toString();
		const lead = Math.max(0, text.indexOf(own));
		const trail = Math.max(0, text.length - lead - own.length);
		const wide = range.cloneRange();
		if (lead && wide.startContainer.nodeType === 3 && wide.startOffset >= lead) {
			wide.setStart(wide.startContainer, wide.startOffset - lead);
		}
		const end = wide.endContainer;
		if (trail && end.nodeType === 3 && wide.endOffset + trail <= (end as Text).length) {
			wide.setEnd(end, wide.endOffset + trail);
		}
		// One box per line the Word is on: a Word across inline elements has several on one line.
		const rects: { left: number; right: number; top: number; bottom: number; width: number }[] = [];
		for (const r of wide.getClientRects()) {
			if (!shown(r) || pageOf(g, r) !== k) continue;
			const last = rects.at(-1);
			if (last && Math.abs(r.top - last.top) < Math.max(4, (last.bottom - last.top) / 2)) {
				last.left = Math.min(last.left, r.left);
				last.right = Math.max(last.right, r.right);
				last.top = Math.min(last.top, r.top);
				last.bottom = Math.max(last.bottom, r.bottom);
				last.width = last.right - last.left;
			} else {
				rects.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width });
			}
		}
		if (!rects.length) continue;
		const parent =
			range.startContainer.nodeType === 1
				? (range.startContainer as Element)
				: range.startContainer.parentElement;
		if (!parent) continue;
		for (let el: Element | null = parent; el && el !== doc.body; el = el.parentElement) {
			containers.add(el);
		}
		const style = styleOf(parent);
		// A Word broken across lines shares its letters by width, with a hyphen where the page
		// hyphenates (a squeezed table's cell breaks a long Word without one).
		const hyphen = rects.length > 1 && hyphenates(parent) ? '-' : '';
		const total = rects.reduce((sum, r) => sum + r.width, 0) || 1;
		let used = 0;
		rects.forEach((r, j) => {
			const end =
				j === rects.length - 1 ? text.length : used + Math.round((text.length * r.width) / total);
			const part = text.slice(used, end) + (j < rects.length - 1 ? hyphen : '');
			used = end;
			const x = r.left - left;
			const line = lines.at(-1);
			const sameLine =
				line &&
				Math.abs(r.top - line.y) < Math.max(4, (line.bottom - line.y) / 2) &&
				(g.rtl ? r.right <= line.edge + 2 : r.left >= line.edge - 2);
			if (!sameLine) {
				lines.push({
					x,
					y: r.top,
					right: x + r.width,
					bottom: r.bottom,
					edge: g.rtl ? r.left : r.right,
					runs: [{ text: part, style }],
					lastWord: i
				});
				return;
			}
			const last = line.runs.at(-1)!;
			const joined = (j === 0 && spaced(i) ? ' ' : '') + part;
			if (last.style === style) last.text += joined;
			else line.runs.push({ text: joined, style });
			line.x = Math.min(line.x, x);
			line.right = Math.max(line.right, x + r.width);
			line.y = Math.min(line.y, r.top);
			line.bottom = Math.max(line.bottom, r.bottom);
			line.edge = g.rtl ? r.left : r.right;
			line.lastWord = i;
		});
	}

	/** A justified Block's lines fill their width, except the Block's last. */
	const justified = new Map<number, boolean>();
	const justifies = (i: number) => {
		const b = words[i]![1];
		let j = justified.get(b);
		if (j === undefined) {
			const el = map.blockElement(i);
			j = !!el && win.getComputedStyle(el).textAlign === 'justify';
			justified.set(b, j);
		}
		return j && i + 1 < n && words[i + 1]![1] === b;
	};

	const background = win.getComputedStyle(doc.body).backgroundColor;
	const boxes: PageBox[] = [];
	const candidates = [...containers, ...doc.querySelectorAll('hr')].sort((a, b) =>
		a === b ? 0 : a.compareDocumentPosition(b) & 4 /* FOLLOWING */ ? -1 : 1
	);
	for (const el of new Set(candidates)) {
		const cs = win.getComputedStyle(el);
		const side = (s: 'Top' | 'Right' | 'Bottom' | 'Left') => {
			const width = parseFloat(cs[`border${s}Width` as const]);
			const style = cs[`border${s}Style` as const];
			const colour = cs[`border${s}Color` as const];
			return width > 0 && style !== 'none' && style !== 'hidden' && !TRANSPARENT.test(colour)
				? `${width}px ${style} ${colour}`
				: '';
		};
		const border = {
			top: side('Top'),
			right: side('Right'),
			bottom: side('Bottom'),
			left: side('Left')
		};
		const fill =
			!TRANSPARENT.test(cs.backgroundColor) && cs.backgroundColor !== background
				? cs.backgroundColor
				: '';
		if (!fill && !border.top && !border.right && !border.bottom && !border.left) continue;
		for (const r of el.getClientRects()) {
			if (!shown(r) || pageOf(g, r) !== k) continue;
			boxes.push({
				x: r.left - left,
				y: r.top,
				width: r.width,
				height: r.height,
				background: fill,
				border,
				radius: cs.borderRadius === '0px' ? '' : cs.borderRadius
			});
		}
	}

	const images: PageDrawing['images'] = [];
	for (const el of doc.querySelectorAll('img, svg, video')) {
		if (el.parentElement?.closest('svg')) continue;
		const r = el.getBoundingClientRect();
		if (!r.width || !r.height || pageOf(g, r) !== k) continue;
		const img = el.localName === 'img' ? (el as HTMLImageElement) : null;
		const src = img ? img.currentSrc || img.src : '';
		images.push({
			x: r.left - left,
			y: r.top,
			width: r.width,
			height: r.height,
			// Only the Revision's own pictures (blob URLs, §9.8); anything else is a placeholder.
			src: src.startsWith('blob:') ? src : null
		});
	}

	return {
		styles,
		boxes,
		images,
		lines: lines.map((l) => ({
			x: l.x,
			y: l.y,
			width: l.right - l.x,
			height: l.bottom - l.y,
			justify: justifies(l.lastWord),
			runs: l.runs
		}))
	};
}
