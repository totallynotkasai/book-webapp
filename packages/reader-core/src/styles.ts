/**
 * The styles the reader injects into every Chapter frame: the reader's typography (§9.4), the theme
 * (the frames can't see the app's CSS variables, so values are concrete), styled-block colours
 * (§9.6: `--book-*` from text-pipeline map onto theme tokens), highlights, and injected figures.
 */
import type { ReaderThemeTokens, TypographySettings } from './types';

/** Side padding and line length for the margins setting (§9.4). */
export const MARGINS = {
	narrow: { gap: '4%', inline: 760 },
	normal: { gap: '7%', inline: 680 },
	wide: { gap: '12%', inline: 600 }
} as const;

/** The five highlight colours plus narration and search, as Custom Highlight names. */
export const HIGHLIGHT_NAMES = [1, 2, 3, 4, 5].map((n) => `rd-highlight-${n}`);

export function themeCss(tokens: ReaderThemeTokens): string {
	const vars = Object.entries(tokens)
		.map(([name, value]) => `${name}:${value}`)
		.join(';');
	return `:root{${vars};--book-text:var(--reader-text);--book-surface:var(--reader-block-background);--book-outline:var(--reader-block-border)}
html,body{background:var(--reader-background)!important;color:var(--reader-text)!important}
a:link,a:visited{color:var(--reader-link)!important}
::selection{background:color-mix(in srgb,var(--md-sys-color-primary) 30%,transparent)}
${[1, 2, 3, 4, 5]
	.map(
		(n) =>
			`::highlight(rd-highlight-${n}){background-color:var(--md-sys-color-highlight-${n});color:inherit}
::highlight(rd-underline-${n}){text-decoration:underline 2px var(--md-sys-color-highlight-${n});text-underline-offset:3px}`
	)
	.join('\n')}
::highlight(rd-popular){text-decoration:underline dotted 2px color-mix(in srgb,var(--reader-text) 55%,transparent);text-underline-offset:4px}
::highlight(rd-narration){background-color:color-mix(in srgb,var(--md-sys-color-primary) 26%,transparent);color:inherit}
::highlight(rd-search){background-color:var(--md-sys-color-tertiary-container);color:var(--md-sys-color-on-tertiary-container)}`;
}

/** Makes every declaration in simple rules important (no nested blocks, no `;` in values). */
function important(css: string): string {
	return css.replace(/\{([^}]*)\}/g, (_, body: string) => {
		const declarations = body
			.split(';')
			.map((d) => d.trim())
			.filter(Boolean)
			.map((d) => `${d}!important`);
		return `{${declarations.join(';')}}`;
	});
}

/** Typography, as overrides placed after the book's own CSS. */
export function typographyCss(t: TypographySettings): string {
	// No specificity (:where), so the only book rules that win are important ones, which ingest
	// keeps for monospace alone (status windows keep their typewriter look, §9.6); everything else
	// inherits the reading font.
	const font = t.fontFamily
		? `:where(body){font-family:${t.fontFamily}!important}:where(body *:not(code,pre,kbd,samp,svg,svg *)){font-family:inherit!important}`
		: '';
	const size = `html{font-size:${Math.round(t.fontScale * 112.5)}%!important;-webkit-text-size-adjust:none;text-size-adjust:none}`;
	const lines = `body{line-height:${t.lineHeight}!important}p,li,dd,dt,blockquote{line-height:inherit!important}`;
	const paragraphs = `p{margin-top:0!important;margin-bottom:${t.paragraphSpacing}em!important}`;
	const justify = t.justify ? 'p,li,dd{text-align:justify!important}' : '';
	const hyphens = `body{hyphens:${t.hyphenate ? 'auto' : 'manual'};-webkit-hyphens:${t.hyphenate ? 'auto' : 'manual'}}`;
	return [font, size, lines, paragraphs, justify, hyphens].filter(Boolean).join('\n');
}

/**
 * Defaults placed before the book's own CSS, so books can still override them. Table cells may
 * hyphenate, then break anywhere, once a table is squeezed (a stat table on a phone at 200%):
 * wider columns stay as laid out, and nothing runs off the page.
 *
 * Focus mode (P1-RDR-11) dims every innermost Block but the focused one with opacity, which
 * never changes the layout; containers stay as they are, so nothing is dimmed twice. The fade
 * goes under reduced motion (Invariant 12).
 *
 * A squeezed table (P1-RDR-12, tables.ts) has a row above it with the "Open table" button,
 * kept with the table across a page break; a book's own rules can't restyle it. The probe is
 * the hidden copy measured to find a table's narrowest layout with its words whole.
 */
export const BASE_CSS = `img,svg,video{max-width:100%;height:auto}
pre{white-space:pre-wrap}
table{border-collapse:collapse;max-width:100%}
th,td{hyphens:auto;-webkit-hyphens:auto;overflow-wrap:anywhere}
table[data-rd-probe]{position:absolute!important;visibility:hidden!important;width:min-content!important;min-width:0!important;max-width:none!important}
[data-rd-probe] :is(th,td){overflow-wrap:normal!important;word-break:normal!important;hyphens:manual!important;-webkit-hyphens:manual!important}
${important(`[data-rd-table]{all:initial;display:flex;justify-content:flex-end;margin:.25em 0;break-after:avoid;-webkit-column-break-after:avoid;break-inside:avoid;user-select:none;-webkit-user-select:none}
[data-rd-table] button{all:initial;display:inline-flex;align-items:center;min-height:48px;cursor:pointer;-webkit-tap-highlight-color:transparent;font:500 max(13px,.7rem)/1.2 'Arial Rounded MT','Arial Rounded MT Std',Nunito,system-ui,sans-serif;color:var(--md-sys-color-on-secondary-container)}
[data-rd-table] button>span{all:initial;display:inline-flex;align-items:center;gap:.35em;padding:.4em .9em .4em .65em;border-radius:999px;background:var(--md-sys-color-secondary-container);font:inherit;color:inherit}
[data-rd-table] svg{all:initial;width:1.3em;height:1.3em;fill:currentColor}
[data-rd-table] button:focus-visible>span{outline:2px solid var(--md-sys-color-primary);outline-offset:2px}
[data-rd-marker]{all:initial;position:relative;display:inline-flex;align-items:center;gap:.2em;margin-inline-start:.4em;padding:.15em .5em;border-radius:999px;vertical-align:.05em;background:var(--md-sys-color-secondary-container);color:var(--md-sys-color-on-secondary-container);font:600 max(12px,.7rem)/1 'Arial Rounded MT','Arial Rounded MT Std',Nunito,system-ui,sans-serif;text-indent:0;cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
[data-rd-marker]::before{content:'';position:absolute;left:50%;top:50%;width:max(100%,48px);height:48px;transform:translate(-50%,-50%)}
[data-rd-marker]::after{content:attr(data-rd-count)}
[data-rd-marker] svg{all:initial;width:1.15em;height:1.15em;fill:currentColor}
[data-rd-marker]:focus-visible{outline:2px solid var(--md-sys-color-primary);outline-offset:2px}`)}
figure[data-injected]{margin:1em 0;text-align:center;break-inside:avoid;-webkit-column-break-inside:avoid}
figure[data-injected] img{max-height:60vh;width:auto;cursor:zoom-in;border-radius:6px}
figure[data-injected].full-page{break-before:column;break-after:column;display:flex;flex-direction:column;justify-content:center;height:90vh;margin:0}
figure[data-injected].full-page img{max-height:80vh}
figure[data-injected] figcaption{font-size:.85em;opacity:.8;margin-top:.4em}
[data-b]:not(:has([data-b])){transition:opacity 200ms ease}
html[data-rd-focus] [data-b]:not(:has([data-b])):not([data-rd-focused]),html[data-rd-focus] figure[data-injected]{opacity:.28}
@media (prefers-reduced-motion:reduce){[data-b]{transition:none!important}}`;
