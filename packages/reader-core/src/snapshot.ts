/**
 * Page curl (P1-RDR-19): a picture of what's on screen, for the curl to bend. It's drawn on a
 * canvas in the app's document from what the page computed, never from the Book's markup
 * (Invariant 10): each run of text exactly where the page put it, in its computed font and
 * colour; the Revision's own pictures; the boxes and rules of styled blocks (§9.6); highlights
 * and underlines; focus mode's dimming. Overview mode's drawing (pages.ts) is the same idea at
 * thumbnail size; this one is exact, so the curl's first frame matches the page it replaces.
 *
 * Fonts: the reading fonts are the app's own (fonts.css is loaded in the app's document too), and
 * a Book's own fonts ("Publisher default") are copied in under names of their own, so a Book can
 * never restyle the app by naming one of its fonts.
 */

/** What's on screen, for `capture`. */
export interface CaptureSource {
	/** The Chapter's frame. */
	doc: Document;
	/** What the paginator says is visible; the whole Chapter is searched without it. */
	visible: Range | null;
	/** The reading area, in top-level coordinates: the picture's size and place. */
	area: DOMRect;
	dpr: number;
}

export interface PageSnapshot {
	canvas: HTMLCanvasElement;
	width: number;
	height: number;
	/** The page colour, 0–1, for the back of the sheet. */
	paper: [number, number, number];
	/** Whether the page is dark (light text on a dark page), for the shading. */
	dark: boolean;
	/** Fonts that weren't loaded yet, so the picture used a fallback: capture again once done. */
	fontsPending: Promise<unknown> | null;
}

interface TextStyle {
	font: string;
	color: string;
	transform: string;
	spacing: string;
	direction: CanvasDirection;
	alpha: number;
	visible: boolean;
	decorations: { line: string; color: string; size: number }[];
	size: number;
}

/** Where a Word may break with a hyphen. */
const SOFT_HYPHEN = String.fromCharCode(0xad);
const ROUND = /^0px( 0px)*$/;

/** The colours highlights are painted in, read once per frame from the page's own tokens. */
const HIGHLIGHT_BACKGROUNDS: Record<string, string> = {
	'rd-narration': 'color-mix(in srgb,var(--md-sys-color-primary) 26%,transparent)',
	'rd-search': 'var(--md-sys-color-tertiary-container)'
};
for (const n of [1, 2, 3, 4, 5]) {
	HIGHLIGHT_BACKGROUNDS[`rd-highlight-${n}`] = `var(--md-sys-color-highlight-${n})`;
}

/** Book fonts copied into the app's document, per frame: family name → our own name for it. */
const bookFonts = new WeakMap<Document, Map<string, string>>();
/** Every copy made, so a Chapter that shares a Book's fonts with the last reuses them. */
const copied = new Map<string, string>();
const added = new Set<string>();

function unquote(name: string): string {
	return name.trim().replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * The Book's @font-face rules, copied into the app's document under names of our own (so the
 * Book's "Nunito" never becomes the app's). Only blob URLs: the Revision's own files (§9.8).
 */
function copyBookFonts(doc: Document): Map<string, string> {
	let names = bookFonts.get(doc);
	if (names) return names;
	names = new Map();
	bookFonts.set(doc, names);
	const win = doc.defaultView as (Window & typeof globalThis) | null;
	if (!win || typeof FontFace === 'undefined') return names;
	const rules: CSSFontFaceRule[] = [];
	const visit = (list: CSSRuleList) => {
		for (const rule of list) {
			if (rule instanceof win.CSSFontFaceRule) rules.push(rule);
			else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
				visit((rule as CSSGroupingRule).cssRules);
			}
		}
	};
	for (const sheet of doc.styleSheets) {
		try {
			visit(sheet.cssRules);
		} catch {
			// A sheet we can't read: its fonts stay the fallback's.
		}
	}
	// A family's faces, by family: they share one name of ours.
	const families = new Map<string, CSSFontFaceRule[]>();
	for (const rule of rules) {
		const family = unquote(rule.style.getPropertyValue('font-family')).toLowerCase();
		const src = rule.style.getPropertyValue('src');
		const urls = [...src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]!);
		if (!family || !urls.length || urls.some((u) => !u.startsWith('blob:'))) continue;
		families.set(family, [...(families.get(family) ?? []), rule]);
	}
	for (const [family, faces] of families) {
		const key = `${family}\n${faces.map((f) => f.style.getPropertyValue('src')).join('\n')}`;
		let alias = copied.get(key);
		if (!alias) {
			alias = `rd-book-font-${copied.size + 1}`;
			copied.set(key, alias);
		}
		names.set(family, alias);
		for (const rule of faces) {
			const descriptor = (name: string) => rule.style.getPropertyValue(name) || undefined;
			const face = `${alias}\n${rule.cssText}`;
			if (added.has(face)) continue;
			added.add(face);
			try {
				document.fonts.add(
					new FontFace(alias, rule.style.getPropertyValue('src'), {
						style: descriptor('font-style'),
						weight: descriptor('font-weight'),
						stretch: descriptor('font-stretch'),
						unicodeRange: descriptor('unicode-range')
					})
				);
			} catch {
				// An unusable rule: the fallback font draws it.
			}
		}
	}
	return names;
}

/** The font families a document has @font-face rules for (lower case). */
function webFamilies(fonts: FontFaceSet): Set<string> {
	const out = new Set<string>();
	fonts.forEach((face) => out.add(unquote(face.family).toLowerCase()));
	return out;
}

/**
 * A computed font-family list as the canvas should use it, to draw in the font the frame drew
 * in: the Book's own fonts swapped for their copies, and the app's web fonts that the frame
 * doesn't have left out (the frame went past them to the next family).
 */
function familyFor(
	family: string,
	names: Map<string, string>,
	inFrame: Set<string>,
	inApp: Set<string>
): string {
	const kept = family
		.split(',')
		.map((name) => {
			const key = unquote(name).toLowerCase();
			const alias = names.get(key);
			if (alias) return `"${alias}"`;
			if (!inFrame.has(key) && inApp.has(key)) return null;
			return name.trim();
		})
		.filter((name): name is string => !!name);
	return kept.length ? kept.join(', ') : 'serif';
}

/** Turns a computed colour (rgb(), or color(srgb …) from color-mix) into one a canvas takes. */
export function canvasColour(css: string): string {
	const srgb =
		/^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+%?))?\)$/.exec(
			css.trim()
		);
	if (!srgb) return css;
	const channel = (v: string) => Math.round(Math.min(1, Math.max(0, Number(v))) * 255);
	const alpha = srgb[4]
		? srgb[4].endsWith('%')
			? Number(srgb[4].slice(0, -1)) / 100
			: Number(srgb[4])
		: 1;
	return `rgba(${channel(srgb[1]!)},${channel(srgb[2]!)},${channel(srgb[3]!)},${alpha})`;
}

/** rgb(a) → 0–1 channels; anything else reads as white. */
export function rgbOf(css: string): [number, number, number] {
	const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(canvasColour(css));
	return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : [1, 1, 1];
}

function luminance([r, g, b]: [number, number, number]): number {
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const TRANSPARENT = /^(transparent|rgba\([^)]*,\s*0\)|color\(srgb [^/]*\/\s*0\))$/;

/** Draws the reading area as it is now onto `canvas` (sized to fit), and describes it. */
export function capture(source: CaptureSource, canvas: HTMLCanvasElement): PageSnapshot {
	const { doc, area, dpr } = source;
	const win = doc.defaultView!;
	const frame = win.frameElement?.getBoundingClientRect();
	const dx = (frame?.left ?? 0) - area.left;
	const dy = (frame?.top ?? 0) - area.top;
	const width = Math.max(1, area.width);
	const height = Math.max(1, area.height);
	const pixelWidth = Math.max(1, Math.round(width * dpr));
	const pixelHeight = Math.max(1, Math.round(height * dpr));
	if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
	if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
	const ctx = canvas.getContext('2d', { alpha: false })!;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	const background = win.getComputedStyle(doc.body).backgroundColor;
	const page = TRANSPARENT.test(background) ? 'rgb(255,255,255)' : background;
	ctx.fillStyle = canvasColour(page);
	ctx.fillRect(0, 0, width, height);
	const paper = rgbOf(page);

	/** On screen: the rect, moved into the picture, overlaps it. */
	const place = (r: DOMRect | DOMRectReadOnly) => ({
		x: r.left + dx,
		y: r.top + dy,
		width: r.width,
		height: r.height
	});
	const onScreen = (r: { x: number; y: number; width: number; height: number }) =>
		(r.width > 0 || r.height > 0) &&
		r.x < width &&
		r.x + r.width > 0 &&
		r.y < height &&
		r.y + r.height > 0;

	const names = copyBookFonts(doc);
	const inFrame = webFamilies(doc.fonts);
	const inApp = webFamilies(document.fonts);
	const styles = new Map<Element, TextStyle>();
	const opacities = new Map<Element, number>();
	const opacityOf = (el: Element | null): number => {
		if (!el || el === doc.documentElement) return 1;
		let o = opacities.get(el);
		if (o === undefined) {
			o = Number(win.getComputedStyle(el).opacity) * opacityOf(el.parentElement);
			opacities.set(el, o);
		}
		return o;
	};
	const decorationsOf = (el: Element | null): TextStyle['decorations'] => {
		// Text decorations carry down to an element's text but aren't inherited, so collect them
		// from the inline ancestors up to the block they're in.
		const out: TextStyle['decorations'] = [];
		for (let e = el; e && e !== doc.body; e = e.parentElement) {
			const cs = win.getComputedStyle(e);
			const line = cs.textDecorationLine;
			if (line && line !== 'none') {
				for (const part of line.split(' ')) {
					if (part === 'underline' || part === 'line-through' || part === 'overline') {
						out.push({
							line: part,
							color: canvasColour(cs.textDecorationColor || cs.color),
							size: parseFloat(cs.fontSize)
						});
					}
				}
			}
			if (cs.display !== 'inline') break;
		}
		return out;
	};
	const styleOf = (el: Element): TextStyle => {
		let style = styles.get(el);
		if (style) return style;
		const cs = win.getComputedStyle(el);
		const variant = cs.fontVariantCaps === 'small-caps' ? 'small-caps ' : '';
		style = {
			font: `${cs.fontStyle} ${variant}${cs.fontWeight} ${cs.fontSize} ${familyFor(cs.fontFamily, names, inFrame, inApp)}`,
			color: canvasColour(cs.color),
			transform: cs.textTransform,
			spacing: cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing,
			direction: cs.direction === 'rtl' ? 'rtl' : 'ltr',
			alpha: opacityOf(el),
			visible: cs.visibility === 'visible' && !el.closest('[data-rd-probe]'),
			decorations: decorationsOf(el),
			size: parseFloat(cs.fontSize)
		};
		styles.set(el, style);
		return style;
	};

	// Fonts the picture needs: any not loaded yet are drawn in a fallback, and loaded for next time.
	const pending: Promise<unknown>[] = [];
	const checked = new Set<string>();
	const ascents = new Map<string, number>();
	// The canvas reports its font back normalised, so the last one set is tracked here.
	let currentFont = '';
	const useFont = (font: string): number => {
		if (currentFont !== font) {
			ctx.font = font;
			currentFont = font;
		}
		if (!checked.has(font)) {
			checked.add(font);
			try {
				if (!document.fonts.check(font)) pending.push(document.fonts.load(font));
			} catch {
				// An unparsable font: the canvas keeps its last one.
			}
		}
		let ascent = ascents.get(font);
		if (ascent === undefined) {
			ascent = baselineOf(font);
			ascents.set(font, ascent);
		}
		return ascent;
	};

	// ---- what to walk: the Blocks the visible range starts and ends in, and everything between.
	const blockOf = (node: Node | null): Node | null => {
		const el = node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
		return el?.closest('[data-b]') ?? el;
	};
	const startBlock = source.visible ? blockOf(source.visible.startContainer) : doc.body;
	const endBlock = source.visible ? blockOf(source.visible.endContainer) : doc.body;

	const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
	if (startBlock && startBlock !== doc.body) walker.currentNode = startBlock;
	let node: Node | null = startBlock?.nodeType === 3 ? startBlock : walker.nextNode();

	const texts: { el: Element; text: Text }[] = [];
	while (node) {
		if (
			endBlock &&
			endBlock !== doc.body &&
			!endBlock.contains(node) &&
			endBlock.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING
		) {
			break;
		}
		const parent = (node as Text).parentElement;
		if (parent && (node as Text).data.trim()) texts.push({ el: parent, text: node as Text });
		node = walker.nextNode();
	}

	// ---- boxes behind styled blocks and rules (§9.6), outermost first.
	const containers = new Set<Element>();
	for (const { el } of texts) {
		for (let e: Element | null = el; e && e !== doc.body; e = e.parentElement) containers.add(e);
	}
	for (const hr of doc.querySelectorAll('hr')) containers.add(hr);
	const ordered = [...containers].sort((a, b) =>
		a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
	);
	const pageBackground = background;
	for (const el of ordered) {
		const cs = win.getComputedStyle(el);
		if (cs.visibility !== 'visible' || el.closest('[data-rd-probe]')) continue;
		const fill =
			!TRANSPARENT.test(cs.backgroundColor) && cs.backgroundColor !== pageBackground
				? canvasColour(cs.backgroundColor)
				: '';
		const sides = (['Top', 'Right', 'Bottom', 'Left'] as const).map((s) => {
			const w = parseFloat(cs[`border${s}Width`]);
			const style = cs[`border${s}Style`];
			const colour = cs[`border${s}Color`];
			return w > 0 && style !== 'none' && style !== 'hidden' && !TRANSPARENT.test(colour)
				? { w, style, colour: canvasColour(colour) }
				: null;
		});
		if (!fill && !sides.some(Boolean)) continue;
		const radius = ROUND.test(cs.borderRadius) ? 0 : parseFloat(cs.borderTopLeftRadius) || 0;
		ctx.globalAlpha = opacityOf(el);
		for (const r of el.getClientRects()) {
			const box = place(r);
			if (!onScreen(box)) continue;
			if (fill) {
				ctx.fillStyle = fill;
				ctx.beginPath();
				roundRect(ctx, box.x, box.y, box.width, box.height, radius);
				ctx.fill();
			}
			const [top, right, bottom, left] = sides;
			if (radius && top && right && bottom && left && top.colour === left.colour) {
				ctx.strokeStyle = top.colour;
				ctx.lineWidth = top.w;
				ctx.setLineDash(dash(top.style, top.w));
				ctx.beginPath();
				roundRect(
					ctx,
					box.x + top.w / 2,
					box.y + top.w / 2,
					box.width - top.w,
					box.height - top.w,
					Math.max(0, radius - top.w / 2)
				);
				ctx.stroke();
				continue;
			}
			const edge = (
				side: (typeof sides)[number] | undefined,
				x1: number,
				y1: number,
				x2: number,
				y2: number
			) => {
				if (!side) return;
				ctx.strokeStyle = side.colour;
				ctx.lineWidth = side.w;
				ctx.setLineDash(dash(side.style, side.w));
				ctx.beginPath();
				ctx.moveTo(x1, y1);
				ctx.lineTo(x2, y2);
				ctx.stroke();
			};
			const { x, y, width: w, height: h } = box;
			edge(top, x, y + (top?.w ?? 0) / 2, x + w, y + (top?.w ?? 0) / 2);
			edge(bottom, x, y + h - (bottom?.w ?? 0) / 2, x + w, y + h - (bottom?.w ?? 0) / 2);
			edge(left, x + (left?.w ?? 0) / 2, y, x + (left?.w ?? 0) / 2, y + h);
			edge(right, x + w - (right?.w ?? 0) / 2, y, x + w - (right?.w ?? 0) / 2, y + h);
		}
	}
	ctx.setLineDash([]);

	// ---- pictures: the Revision's own (blob URLs), as the page fits them.
	for (const el of doc.querySelectorAll('img, image')) {
		const r = place(el.getBoundingClientRect());
		if (!onScreen(r)) continue;
		const cs = win.getComputedStyle(el);
		if (cs.visibility !== 'visible') continue;
		ctx.globalAlpha = opacityOf(el);
		if (el.localName === 'img') {
			const img = el as HTMLImageElement;
			const src = img.currentSrc || img.src;
			if (!src.startsWith('blob:') || !img.complete || !img.naturalWidth) continue;
			let box = r;
			if (cs.objectFit === 'contain' || cs.objectFit === 'scale-down') {
				const scale = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
				const s = cs.objectFit === 'scale-down' ? Math.min(1, scale) : scale;
				const w = img.naturalWidth * s;
				const h = img.naturalHeight * s;
				box = { x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, width: w, height: h };
			}
			const radius = ROUND.test(cs.borderRadius) ? 0 : parseFloat(cs.borderTopLeftRadius) || 0;
			ctx.save();
			if (radius) {
				ctx.beginPath();
				roundRect(ctx, box.x, box.y, box.width, box.height, radius);
				ctx.clip();
			}
			try {
				ctx.drawImage(img, box.x, box.y, box.width, box.height);
			} catch {
				// Not decodable here: left out.
			}
			ctx.restore();
		} else {
			const href =
				el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
			if (!href?.startsWith('blob:')) continue;
			try {
				ctx.drawImage(el as SVGImageElement, r.x, r.y, r.width, r.height);
			} catch {
				// Not loaded yet: left out.
			}
		}
	}
	// The "Open table" button's icon (P1-RDR-12): our own markup, so its path can be drawn.
	for (const svg of doc.querySelectorAll('[data-rd-table] svg')) {
		const r = place(svg.getBoundingClientRect());
		if (!onScreen(r)) continue;
		const box = (svg.getAttribute('viewBox') ?? '0 -960 960 960').split(/[\s,]+/).map(Number);
		const [vx = 0, vy = -960, vw = 960, vh = 960] = box;
		ctx.save();
		ctx.globalAlpha = opacityOf(svg);
		ctx.translate(r.x, r.y);
		ctx.scale(r.width / vw, r.height / vh);
		ctx.translate(-vx, -vy);
		ctx.fillStyle = canvasColour(win.getComputedStyle(svg).fill);
		for (const path of svg.querySelectorAll('path')) {
			const d = path.getAttribute('d');
			if (d) ctx.fill(new Path2D(d));
		}
		ctx.restore();
	}

	// ---- list bullets and numbers: generated content, so drawn here as text on the item's first
	// line, ending where its content starts (outside) or starting there (inside).
	const range0 = doc.createRange();
	for (const el of ordered) {
		const cs = win.getComputedStyle(el);
		if (cs.display !== 'list-item' || cs.visibility !== 'visible') continue;
		const marker = markerText(el, cs.listStyleType);
		if (!marker) continue;
		const walk = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let firstText: Text | null = null;
		for (let n = walk.nextNode(); n; n = walk.nextNode()) {
			if ((n as Text).data.trim()) {
				firstText = n as Text;
				break;
			}
		}
		const parent = firstText?.parentElement;
		if (!firstText || !parent) continue;
		const lead = firstText.data.search(/\S/);
		range0.setStart(firstText, lead);
		range0.setEnd(firstText, lead + 1);
		const rect = [...range0.getClientRects()].find((r) => r.width > 0 || r.height > 0);
		if (!rect) continue;
		const line = place(rect);
		if (!onScreen(line)) continue;
		const own = styleOf(el);
		const baseline = line.y + useFont(styleOf(parent).font);
		useFont(own.font);
		const box = place(el.getBoundingClientRect());
		const rtl = own.direction === 'rtl';
		const edge = rtl
			? box.x + box.width - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth)
			: box.x + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
		ctx.fillStyle = own.color;
		ctx.globalAlpha = own.alpha;
		ctx.direction = own.direction;
		const outside = cs.listStylePosition !== 'inside';
		ctx.textAlign = outside !== rtl ? 'right' : 'left';
		ctx.fillText(`${marker} `, edge, baseline);
	}
	ctx.globalAlpha = 1;

	// ---- highlights (CSS Custom Highlights, §9.1): behind the text, narration on top.
	const underlines: { rects: ReturnType<typeof place>[]; colour: string }[] = [];
	const registry = (win.CSS as unknown as { highlights?: Map<string, Set<AbstractRange>> })
		.highlights;
	if (registry) {
		const probe = doc.createElement('span');
		probe.style.cssText = 'position:absolute;visibility:hidden';
		doc.body.append(probe);
		const resolve = (value: string, prop: 'backgroundColor' | 'color') => {
			probe.style[prop] = '';
			probe.style[prop] = value;
			return canvasColour(win.getComputedStyle(probe)[prop]);
		};
		const entries = [...registry.entries()]
			.filter(([name]) => String(name).startsWith('rd-'))
			.sort(([a], [b]) => (a === 'rd-narration' ? 1 : b === 'rd-narration' ? -1 : 0));
		ctx.globalAlpha = 1;
		for (const [name, ranges] of entries) {
			const underline = /^rd-underline-(\d)$/.exec(String(name));
			const colour = underline
				? resolve(`var(--md-sys-color-highlight-${underline[1]})`, 'color')
				: HIGHLIGHT_BACKGROUNDS[String(name)]
					? resolve(HIGHLIGHT_BACKGROUNDS[String(name)]!, 'backgroundColor')
					: '';
			if (!colour) continue;
			const rects: ReturnType<typeof place>[] = [];
			for (const abstract of ranges) {
				for (const r of textRects(doc, abstract)) {
					const box = place(r);
					if (onScreen(box) && box.width > 0) rects.push(box);
				}
			}
			if (underline) {
				underlines.push({ rects, colour });
				continue;
			}
			ctx.fillStyle = colour;
			for (const box of rects) ctx.fillRect(box.x, box.y, box.width, box.height);
		}
		probe.remove();
	}

	// ---- text: every run of letters where the page put it.
	const range = doc.createRange();
	ctx.textBaseline = 'alphabetic';
	const lines: { x: number; y: number; width: number; colour: string; thickness: number }[] = [];
	for (const { el, text } of texts) {
		const style = styleOf(el);
		if (!style.visible || style.alpha <= 0) continue;
		const data = text.data;
		const tokens = /\S+/gu;
		let match: RegExpExecArray | null;
		while ((match = tokens.exec(data))) {
			const from = match.index;
			const to = from + match[0].length;
			range.setStart(text, from);
			range.setEnd(text, to);
			const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
			if (!rects.length) continue;
			const first = place(rects[0]!);
			const last = place(rects[rects.length - 1]!);
			if (first.x > width && last.x > width) continue;
			if (first.x + first.width < 0 && last.x + last.width < 0) continue;
			// One piece per line: a Word broken across lines is split where the line breaks.
			const pieces =
				rects.length === 1
					? [{ text: match[0], rect: first }]
					: splitByLine(text, from, to, range, place);
			for (let i = 0; i < pieces.length; i++) {
				const piece = pieces[i]!;
				if (!onScreen(piece.rect)) continue;
				let s = transform(piece.text.split(SOFT_HYPHEN).join(''), style.transform);
				const ascent = useFont(style.font);
				// A Word broken across lines shows a hyphen where the page hyphenated it (or broke
				// at a soft hyphen), not where it broke anywhere for room (a squeezed table's cell):
				// the line's box is then wider than its letters by about a hyphen.
				if (i < pieces.length - 1 && pieces.length === rects.length) {
					const extra = rects[i]!.width - piece.rect.width;
					if (extra > ctx.measureText('-').width * 0.5) s += '-';
				}
				if (!s) continue;
				ctx.fillStyle = style.color;
				ctx.globalAlpha = style.alpha;
				ctx.direction = style.direction;
				setSpacing(ctx, style.spacing);
				const baseline = piece.rect.y + ascent;
				if (style.direction === 'rtl') {
					ctx.textAlign = 'right';
					ctx.fillText(s, piece.rect.x + piece.rect.width, baseline, piece.rect.width + 1);
				} else {
					ctx.textAlign = 'left';
					ctx.fillText(s, piece.rect.x, baseline, piece.rect.width + 1);
				}
				for (const d of style.decorations) {
					const thickness = Math.max(1, d.size / 15);
					const y =
						d.line === 'underline'
							? baseline + Math.max(1, d.size * 0.11)
							: d.line === 'line-through'
								? baseline - d.size * 0.28
								: piece.rect.y;
					lines.push({
						x: piece.rect.x,
						y,
						width: piece.rect.width,
						colour: d.color,
						thickness
					});
				}
			}
		}
	}
	for (const line of lines) {
		ctx.fillStyle = line.colour;
		ctx.fillRect(line.x, line.y - line.thickness / 2, line.width, line.thickness);
	}
	ctx.globalAlpha = 1;
	for (const { rects, colour } of underlines) {
		ctx.fillStyle = colour;
		for (const box of rects) ctx.fillRect(box.x, box.y + box.height * 0.82 + 3, box.width, 2);
	}
	setSpacing(ctx, '0px');

	return {
		canvas,
		width,
		height,
		paper,
		dark: luminance(paper) < 0.4,
		fontsPending: pending.length ? Promise.allSettled(pending) : null
	};
}

/** Hidden in the app's document: a line of text in each font the curl has drawn with. */
let probeBox: HTMLElement | null = null;
const probes = new Map<string, { line: HTMLElement; text: Text; mark: HTMLElement }>();
const baselines = new Map<string, number>();

/**
 * How far below the top of a run of text's box its baseline is, in a font. Measured with the
 * browser's own layout (a hidden line in the app's document, which has the same fonts), since a
 * canvas's font metrics needn't match the ones layout uses; measured again until the font has
 * loaded. The lines stay, so the fonts stay in use: WebKit lets go of a web font's data when no
 * element uses it, and a canvas would then draw in a fallback.
 */
function baselineOf(font: string): number {
	const loaded = (() => {
		try {
			return document.fonts.check(font);
		} catch {
			return true;
		}
	})();
	const known = baselines.get(font);
	if (known !== undefined) return known;
	if (!probeBox?.isConnected) {
		probeBox = document.createElement('div');
		probeBox.setAttribute('aria-hidden', 'true');
		probeBox.dataset.pageCurlFonts = '';
		probeBox.style.cssText =
			'position:fixed;left:-10000px;top:0;visibility:hidden;white-space:nowrap;pointer-events:none;contain:layout';
		document.body.append(probeBox);
		probes.clear();
	}
	let probe = probes.get(font);
	if (!probe) {
		const line = document.createElement('div');
		line.style.font = font;
		const text = document.createTextNode('Hg');
		const mark = document.createElement('span');
		mark.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline';
		line.append(text, mark);
		probeBox.append(line);
		probe = { line, text, mark };
		probes.set(font, probe);
	}
	const range = document.createRange();
	range.selectNodeContents(probe.line);
	range.setEnd(probe.text, probe.text.length);
	const top = range.getClientRects()[0]?.top ?? probe.line.getBoundingClientRect().top;
	const offset = probe.mark.getBoundingClientRect().top - top;
	if (loaded) baselines.set(font, offset);
	return offset;
}

/**
 * The boxes of a range's text alone, as a highlight paints them: a range's own client rects also
 * include every element it wholly contains (a paragraph's full box).
 */
function textRects(doc: Document, abstract: AbstractRange): DOMRect[] {
	const out: DOMRect[] = [];
	const full = doc.createRange();
	try {
		full.setStart(abstract.startContainer, abstract.startOffset);
		full.setEnd(abstract.endContainer, abstract.endOffset);
	} catch {
		return out;
	}
	const root = full.commonAncestorContainer;
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const part = doc.createRange();
	let started = false;
	for (let node = root.nodeType === 3 ? root : walker.nextNode(); node; node = walker.nextNode()) {
		if (!full.intersectsNode(node)) {
			if (started) break;
			continue;
		}
		started = true;
		const from = node === full.startContainer ? full.startOffset : 0;
		const to = node === full.endContainer ? full.endOffset : (node as Text).length;
		if (to <= from) continue;
		part.setStart(node, from);
		part.setEnd(node, to);
		out.push(...part.getClientRects());
	}
	return out;
}

/** A run of text across several lines, split where each line ends (by measuring its letters). */
function splitByLine(
	text: Text,
	from: number,
	to: number,
	range: Range,
	place: (r: DOMRect) => { x: number; y: number; width: number; height: number }
): { text: string; rect: { x: number; y: number; width: number; height: number } }[] {
	const pieces: { text: string; rect: { x: number; y: number; width: number; height: number } }[] =
		[];
	let start = from;
	let box: { x: number; y: number; width: number; height: number } | null = null;
	for (let i = from; i < to; i++) {
		range.setStart(text, i);
		range.setEnd(text, i + 1);
		const r = [...range.getClientRects()].find((c) => c.width > 0 || c.height > 0);
		if (!r) continue;
		const b = place(r);
		const sameLine = box && Math.abs(b.y - box.y) < Math.max(2, box.height / 2);
		if (box && !sameLine) {
			pieces.push({ text: text.data.slice(start, i), rect: box });
			start = i;
			box = b;
			continue;
		}
		if (!box) box = b;
		else {
			const right = Math.max(box.x + box.width, b.x + b.width);
			const left = Math.min(box.x, b.x);
			box = {
				x: left,
				y: Math.min(box.y, b.y),
				width: right - left,
				height: Math.max(box.height, b.height)
			};
		}
	}
	if (box) pieces.push({ text: text.data.slice(start, to), rect: box });
	return pieces;
}

/** A list item's bullet or number, as the page shows it for the common list styles. */
function markerText(li: Element, type: string): string | null {
	if (type === 'disc') return '•';
	if (type === 'circle') return '◦';
	if (type === 'square') return '▪';
	const list = li.parentElement;
	const items = list ? [...list.children].filter((c) => c.localName === 'li') : [li];
	let n = Number(list?.getAttribute('start') ?? 1) || 1;
	for (const item of items) {
		const value = Number(item.getAttribute('value'));
		if (value) n = value;
		if (item === li) break;
		n++;
	}
	const letters = (k: number) => {
		let out = '';
		for (let m = k; m > 0; m = Math.floor((m - 1) / 26))
			out = String.fromCharCode(97 + ((m - 1) % 26)) + out;
		return out;
	};
	const roman = (k: number) => {
		const digits: [number, string][] = [
			[1000, 'm'],
			[900, 'cm'],
			[500, 'd'],
			[400, 'cd'],
			[100, 'c'],
			[90, 'xc'],
			[50, 'l'],
			[40, 'xl'],
			[10, 'x'],
			[9, 'ix'],
			[5, 'v'],
			[4, 'iv'],
			[1, 'i']
		];
		let out = '';
		let m = k;
		for (const [v, d] of digits) {
			while (m >= v) {
				out += d;
				m -= v;
			}
		}
		return out;
	};
	switch (type) {
		case 'decimal':
			return `${n}.`;
		case 'decimal-leading-zero':
			return `${String(n).padStart(2, '0')}.`;
		case 'lower-alpha':
		case 'lower-latin':
			return `${letters(n)}.`;
		case 'upper-alpha':
		case 'upper-latin':
			return `${letters(n).toUpperCase()}.`;
		case 'lower-roman':
			return `${roman(n)}.`;
		case 'upper-roman':
			return `${roman(n).toUpperCase()}.`;
		default:
			return null;
	}
}

function transform(s: string, how: string): string {
	if (how === 'uppercase') return s.toLocaleUpperCase();
	if (how === 'lowercase') return s.toLocaleLowerCase();
	if (how === 'capitalize') return s.replace(/^\p{L}/u, (c) => c.toLocaleUpperCase());
	return s;
}

function setSpacing(ctx: CanvasRenderingContext2D, spacing: string) {
	const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
	if ('letterSpacing' in c && c.letterSpacing !== spacing) c.letterSpacing = spacing;
}

function dash(style: string, width: number): number[] {
	if (style === 'dashed') return [width * 3, width * 2];
	if (style === 'dotted') return [width, width];
	return [];
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
) {
	const radius = Math.max(0, Math.min(r, w / 2, h / 2));
	if (!radius) {
		ctx.rect(x, y, w, h);
		return;
	}
	ctx.moveTo(x + radius, y);
	ctx.arcTo(x + w, y, x + w, y + h, radius);
	ctx.arcTo(x + w, y + h, x, y + h, radius);
	ctx.arcTo(x, y + h, x, y, radius);
	ctx.arcTo(x, y, x + w, y, radius);
	ctx.closePath();
}
