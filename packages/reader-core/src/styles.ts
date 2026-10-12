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
::highlight(rd-narration){background-color:color-mix(in srgb,var(--md-sys-color-primary) 26%,transparent);color:inherit}
::highlight(rd-search){background-color:var(--md-sys-color-tertiary-container);color:var(--md-sys-color-on-tertiary-container)}`;
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
 */
export const BASE_CSS = `img,svg,video{max-width:100%;height:auto}
pre{white-space:pre-wrap}
table{border-collapse:collapse;max-width:100%}
th,td{hyphens:auto;-webkit-hyphens:auto;overflow-wrap:anywhere}
figure[data-injected]{margin:1em 0;text-align:center;break-inside:avoid;-webkit-column-break-inside:avoid}
figure[data-injected] img{max-height:60vh;width:auto;cursor:zoom-in;border-radius:6px}
figure[data-injected].full-page{break-before:column;break-after:column;display:flex;flex-direction:column;justify-content:center;height:90vh;margin:0}
figure[data-injected].full-page img{max-height:80vh}
figure[data-injected] figcaption{font-size:.85em;opacity:.8;margin-top:.4em}`;
