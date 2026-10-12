// The css-tree subpath typings are ambient; packages that type-check this source need them too.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./css-tree.d.ts" />
/**
 * The CSS allowlist (DESIGN.md §7.1 step 2, §9.6). Book CSS is untrusted (Invariant 10): only
 * typography, colour, borders, spacing, tables and lists survive, `url()` may only point inside
 * the EPUB, and author colours are wrapped in theme variables so styled blocks (LitRPG status
 * windows and the like) stay readable in every theme:
 *
 *   color: #222            →  color: var(--book-text, #222)
 *   background: #eef       →  background: var(--book-surface, #eef)
 *   border: 1px solid #99a →  border: 1px solid var(--book-outline, #99a)
 *
 * The reader defines those variables from the theme; anywhere else the author's colour applies.
 * Boxes with a background or border also get `break-inside: avoid`, so a status window isn't
 * split across pages (ADR-001 consequences).
 */
import type { Atrule, CssNode, Declaration, Rule, StyleSheet } from 'css-tree';
import generate from 'css-tree/generator';
import parse from 'css-tree/parser';

export interface CssContext {
	/** Resolves a url() reference to the href to write, or null to drop the declaration. */
	resolveUrl(url: string): string | null;
}

export interface CssResult {
	css: string;
	/** Declarations and rules removed. */
	removed: number;
}

const PREFIX = /^-(webkit|moz|ms|o|epub)-/;

/** Properties books may set (after any vendor prefix is removed). */
const ALLOWED = new Set([
	'font',
	'font-family',
	'font-size',
	'font-style',
	'font-weight',
	'font-variant',
	'font-variant-caps',
	'font-variant-numeric',
	'font-variant-ligatures',
	'font-variant-east-asian',
	'font-stretch',
	'font-feature-settings',
	'font-kerning',
	'line-height',
	'letter-spacing',
	'word-spacing',
	'text-align',
	'text-align-last',
	'text-indent',
	'text-transform',
	'text-decoration',
	'text-decoration-line',
	'text-decoration-style',
	'text-decoration-color',
	'text-decoration-thickness',
	'text-underline-offset',
	'text-shadow',
	'text-emphasis',
	'text-emphasis-style',
	'text-emphasis-color',
	'text-emphasis-position',
	'text-combine-upright',
	'text-orientation',
	'white-space',
	'word-break',
	'overflow-wrap',
	'word-wrap',
	'hyphens',
	'hanging-punctuation',
	'direction',
	'unicode-bidi',
	'writing-mode',
	'vertical-align',
	'color',
	'background',
	'background-color',
	'background-image',
	'background-repeat',
	'background-position',
	'background-size',
	'background-clip',
	'background-origin',
	'border',
	'border-top',
	'border-right',
	'border-bottom',
	'border-left',
	'border-width',
	'border-style',
	'border-color',
	'border-top-width',
	'border-right-width',
	'border-bottom-width',
	'border-left-width',
	'border-top-style',
	'border-right-style',
	'border-bottom-style',
	'border-left-style',
	'border-top-color',
	'border-right-color',
	'border-bottom-color',
	'border-left-color',
	'border-radius',
	'border-top-left-radius',
	'border-top-right-radius',
	'border-bottom-left-radius',
	'border-bottom-right-radius',
	'border-collapse',
	'border-spacing',
	'margin',
	'margin-top',
	'margin-right',
	'margin-bottom',
	'margin-left',
	'margin-block',
	'margin-block-start',
	'margin-block-end',
	'margin-inline',
	'margin-inline-start',
	'margin-inline-end',
	'padding',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'padding-block',
	'padding-block-start',
	'padding-block-end',
	'padding-inline',
	'padding-inline-start',
	'padding-inline-end',
	'width',
	'height',
	'min-width',
	'min-height',
	'max-width',
	'max-height',
	'inline-size',
	'block-size',
	'max-inline-size',
	'max-block-size',
	'box-sizing',
	'display',
	'float',
	'clear',
	'list-style',
	'list-style-type',
	'list-style-position',
	'list-style-image',
	'counter-reset',
	'counter-increment',
	'quotes',
	'content',
	'table-layout',
	'caption-side',
	'empty-cells',
	'page-break-before',
	'page-break-after',
	'page-break-inside',
	'break-before',
	'break-after',
	'break-inside',
	'orphans',
	'widows',
	'opacity',
	'visibility',
	'object-fit',
	'object-position',
	'tab-size',
	'font-synthesis',
	'ruby-position',
	'ruby-align'
]);

/** Only these may appear in @font-face. */
const FONT_FACE = new Set([
	'font-family',
	'src',
	'font-style',
	'font-weight',
	'font-stretch',
	'unicode-range',
	'font-display',
	'font-feature-settings'
]);

/** Which theme role a colour property maps to. */
const COLOUR_ROLE: Record<string, 'text' | 'surface' | 'outline'> = {
	color: 'text',
	'text-decoration-color': 'text',
	'text-emphasis-color': 'text',
	background: 'surface',
	'background-color': 'surface',
	border: 'outline',
	'border-top': 'outline',
	'border-right': 'outline',
	'border-bottom': 'outline',
	'border-left': 'outline',
	'border-color': 'outline',
	'border-top-color': 'outline',
	'border-right-color': 'outline',
	'border-bottom-color': 'outline',
	'border-left-color': 'outline'
};

const DANGEROUS = /expression\s*\(|javascript:|vbscript:|behaviou?r\s*:|-moz-binding|@import/i;

/** CSS named colours (CSS Color 4), for finding colours in shorthands. */
const NAMED_COLOURS = new Set(
	(
		'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
		'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
		'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
		'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
		'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
		'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
		'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
		'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
		'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
		'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
		'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
		'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
		'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
		'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
		'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
		'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
		'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
	).split(' ')
);
const COLOUR_FUNCTIONS = new Set([
	'rgb',
	'rgba',
	'hsl',
	'hsla',
	'hwb',
	'lab',
	'lch',
	'oklab',
	'oklch',
	'color'
]);

/** A value split into url() calls, quoted strings and everything else, in order. */
type Segment = { kind: 'url'; inner: string } | { kind: 'string' | 'text'; text: string };

function segments(value: string): Segment[] {
	const out: Segment[] = [];
	let text = '';
	const flushText = () => {
		if (text) out.push({ kind: 'text', text });
		text = '';
	};
	let i = 0;
	while (i < value.length) {
		const ch = value[i]!;
		if (ch === '"' || ch === "'") {
			let j = i + 1;
			while (j < value.length && value[j] !== ch) j += value[j] === '\\' ? 2 : 1;
			flushText();
			out.push({ kind: 'string', text: value.slice(i, j + 1) });
			i = j + 1;
			continue;
		}
		if (/^url\(/i.test(value.slice(i, i + 4))) {
			let j = i + 4;
			let quote: string | null = null;
			while (j < value.length) {
				const c = value[j]!;
				if (quote) {
					if (c === '\\') j++;
					else if (c === quote) quote = null;
				} else if (c === '"' || c === "'") quote = c;
				else if (c === ')') break;
				j++;
			}
			flushText();
			out.push({ kind: 'url', inner: value.slice(i + 4, j).trim() });
			i = j + 1;
			continue;
		}
		text += ch;
		i++;
	}
	flushText();
	return out;
}

function unquote(inner: string): string {
	const m = /^(["'])(.*)\1$/s.exec(inner);
	return (m ? m[2]! : inner).replace(/\\(.)/g, '$1');
}

/** Wraps each colour in plain text with `var(--book-<role>, colour)`. */
function wrapColours(text: string, role: string): string {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const rest = text.slice(i);
		const hash = /^#[0-9a-f]{3,8}\b/i.exec(rest);
		const fn = /^([a-z]+)\(/i.exec(rest);
		const word = /^[a-z][a-z-]*/i.exec(rest);
		const prev = i === 0 ? '' : text[i - 1]!;
		const atBoundary = !/[\w-]/.test(prev);
		if (hash && atBoundary) {
			out += `var(--book-${role}, ${hash[0]})`;
			i += hash[0].length;
		} else if (fn && atBoundary && COLOUR_FUNCTIONS.has(fn[1]!.toLowerCase())) {
			let depth = 0;
			let j = i;
			for (; j < text.length; j++) {
				if (text[j] === '(') depth++;
				else if (text[j] === ')' && --depth === 0) break;
			}
			out += `var(--book-${role}, ${text.slice(i, j + 1)})`;
			i = j + 1;
		} else if (word && atBoundary && NAMED_COLOURS.has(word[0].toLowerCase())) {
			out += `var(--book-${role}, ${word[0]})`;
			i += word[0].length;
		} else if (word) {
			out += word[0];
			i += word[0].length;
		} else {
			out += text[i];
			i++;
		}
	}
	return out;
}

/** True when a background or border value draws something visible. */
function drawsBox(property: string, value: string): boolean {
	if (property.startsWith('background'))
		return !/^\s*(none|transparent|inherit|initial)\s*$/i.test(value);
	if (property.startsWith('border')) {
		return (
			!property.endsWith('radius') &&
			!property.endsWith('collapse') &&
			!property.endsWith('spacing') &&
			!/^\s*(none|0|hidden|inherit|initial)\s*$/i.test(value)
		);
	}
	return false;
}

interface DeclarationOutcome {
	value: string | null;
	drawsBox: boolean;
}

function sanitiseValue(
	property: string,
	value: string,
	ctx: CssContext,
	allowed: Set<string>
): DeclarationOutcome {
	const base = property.toLowerCase().replace(PREFIX, '');
	if (!allowed.has(base) || DANGEROUS.test(value)) return { value: null, drawsBox: false };
	const role = COLOUR_ROLE[base];
	let out = '';
	for (const segment of segments(value)) {
		if (segment.kind === 'url') {
			const href = ctx.resolveUrl(unquote(segment.inner));
			if (href === null) return { value: null, drawsBox: false };
			out += `url("${href.replace(/["\\]/g, '\\$&')}")`;
		} else if (segment.kind === 'string') {
			out += segment.text;
		} else {
			out += role ? wrapColours(segment.text, role) : segment.text;
		}
	}
	return { value: out.trim(), drawsBox: drawsBox(base, value) };
}

function listToArray<T>(list: { toArray(): T[] } | null | undefined): T[] {
	return list ? list.toArray() : [];
}

const MONOSPACE =
	/\bmonospace\b|courier|consolas|menlo|monaco|lucida console|lucida sans typewriter|\bsf mono\b|source code|fira (?:code|mono)|jetbrains mono|dejavu sans mono|liberation mono|roboto mono|\bmono\b/i;

/**
 * The reader's font replaces the book's (§9.4) everywhere except monospace, which status windows
 * and code keep (§9.6). Its override has no specificity, so a book declaration wins over it only
 * when it's important: font families are made important when, and only when, they're monospace.
 */
function important(property: string, value: string, declared: boolean): boolean {
	if (property === 'font-family' || property === 'font') return MONOSPACE.test(value);
	return declared;
}

/** Filters a declaration block in place; returns how many were removed. */
function sanitiseBlock(
	declarations: Declaration[],
	ctx: CssContext,
	allowed: Set<string>
): { kept: string[]; removed: number } {
	const kept: string[] = [];
	let removed = 0;
	let box = false;
	for (const decl of declarations) {
		const raw = decl.value.type === 'Raw' ? decl.value.value : generate(decl.value);
		const outcome = sanitiseValue(decl.property, raw, ctx, allowed);
		if (outcome.value === null) {
			removed++;
			continue;
		}
		box ||= outcome.drawsBox;
		const property = decl.property.toLowerCase();
		// In @font-face, font-family names the face; importance there would void it.
		const flag =
			allowed === ALLOWED
				? important(property, outcome.value, decl.important === true)
				: decl.important === true;
		kept.push(`${property}:${outcome.value}${flag ? '!important' : ''}`);
	}
	if (box && allowed === ALLOWED && !kept.some((d) => d.startsWith('break-inside:'))) {
		kept.push('break-inside:avoid', '-webkit-column-break-inside:avoid');
	}
	return { kept, removed };
}

const PARSE_OPTIONS = {
	parseValue: false,
	parseCustomProperty: false,
	parseAtrulePrelude: false,
	parseRulePrelude: false
} as const;

function sanitiseRules(children: CssNode[], ctx: CssContext, out: string[]): number {
	let removed = 0;
	for (const node of children) {
		if (node.type === 'Rule') {
			const rule = node as Rule;
			const prelude = generate(rule.prelude);
			if (DANGEROUS.test(prelude)) {
				removed++;
				continue;
			}
			const declarations = listToArray(rule.block.children).filter(
				(d): d is Declaration => d.type === 'Declaration'
			);
			const { kept, removed: r } = sanitiseBlock(declarations, ctx, ALLOWED);
			removed += r;
			if (kept.length) out.push(`${prelude}{${kept.join(';')}}`);
		} else if (node.type === 'Atrule') {
			const atrule = node as Atrule;
			const name = atrule.name.toLowerCase();
			const prelude = atrule.prelude ? generate(atrule.prelude) : '';
			if ((name === 'media' || name === 'supports') && atrule.block) {
				const inner: string[] = [];
				removed += sanitiseRules(listToArray(atrule.block.children), ctx, inner);
				if (inner.length) out.push(`@${name} ${prelude}{${inner.join('')}}`);
			} else if (name === 'font-face' && atrule.block) {
				const declarations = listToArray(atrule.block.children).filter(
					(d): d is Declaration => d.type === 'Declaration'
				);
				const { kept, removed: r } = sanitiseBlock(declarations, ctx, FONT_FACE);
				removed += r;
				if (kept.some((d) => d.startsWith('src:'))) out.push(`@font-face{${kept.join(';')}}`);
				else removed++;
			} else if (name !== 'charset' && name !== 'namespace') {
				removed++;
			}
		} else {
			removed++;
		}
	}
	return removed;
}

/** Sanitises a stylesheet (a .css file or a <style> element). */
export function sanitiseStylesheet(text: string, ctx: CssContext): CssResult {
	let ast: CssNode;
	try {
		ast = parse(text, { ...PARSE_OPTIONS, context: 'stylesheet' });
	} catch {
		return { css: '', removed: 1 };
	}
	const out: string[] = [];
	const removed = sanitiseRules(listToArray((ast as StyleSheet).children), ctx, out);
	return { css: out.join('\n'), removed };
}

/** Sanitises a `style` attribute. */
export function sanitiseDeclarations(text: string, ctx: CssContext): CssResult {
	let ast: CssNode;
	try {
		ast = parse(text, { ...PARSE_OPTIONS, context: 'declarationList' });
	} catch {
		return { css: '', removed: 1 };
	}
	const declarations = listToArray(
		(ast as { children?: { toArray(): CssNode[] } }).children
	).filter((d): d is Declaration => d.type === 'Declaration');
	const { kept, removed } = sanitiseBlock(declarations, ctx, ALLOWED);
	return { css: kept.join(';'), removed };
}
