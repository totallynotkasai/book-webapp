import { describe, expect, it } from 'vitest';
import { sanitiseDeclarations, sanitiseStylesheet, type CssContext } from './css';

const ctx: CssContext = {
	resolveUrl: (url) => (/^[a-z]+:|^\/\//i.test(url) ? null : `../res/${url}`)
};

describe('CSS allowlist (§7.1)', () => {
	it('keeps typography and spacing, drops positioning and unknown properties', () => {
		const { css, removed } = sanitiseStylesheet(
			'p { font-style: italic; margin: 0 0 1em; position: fixed; z-index: 9; cursor: pointer }',
			ctx
		);
		expect(css).toBe('p{font-style:italic;margin:0 0 1em}');
		expect(removed).toBe(3);
	});

	it('makes monospace font families important and no other (the reading font wins, §9.4/§9.6)', () => {
		const { css } = sanitiseStylesheet(
			`.status { font-family: 'Courier New', monospace }
			 p { font-family: Georgia, serif !important; color: red !important }
			 code { font: 0.9em Menlo, monospace }
			 @font-face { font-family: "Fira Mono"; src: url(fonts/f.woff2) }`,
			ctx
		);
		expect(css.split('\n')).toEqual([
			`.status{font-family:'Courier New', monospace!important}`,
			'p{font-family:Georgia, serif;color:var(--book-text, red)!important}',
			'code{font:0.9em Menlo, monospace!important}',
			'@font-face{font-family:"Fira Mono";src:url("../res/fonts/f.woff2")}'
		]);
	});

	it('keeps @media and @font-face with internal sources, drops @import and @keyframes', () => {
		const { css } = sanitiseStylesheet(
			`@import url("x.css");
			 @media (min-width: 30em) { h1 { text-align: center } }
			 @font-face { font-family: "Book"; src: url(fonts/b.woff2) format("woff2") }
			 @font-face { font-family: "Web"; src: url(https://fonts.example/w.woff2) }
			 @keyframes spin { to { transform: rotate(1turn) } }`,
			ctx
		);
		expect(css).toBe(
			[
				'@media (min-width: 30em){h1{text-align:center}}',
				'@font-face{font-family:"Book";src:url("../res/fonts/b.woff2") format("woff2")}'
			].join('\n')
		);
	});

	it('drops anything that points outside the EPUB or could run code', () => {
		const { css, removed } = sanitiseStylesheet(
			`div { background-image: url('https://tracker.example/p.gif'); color: red }
			 a { behavior: url(x.htc); width: expression(alert(1)) }`,
			ctx
		);
		expect(css).toBe('div{color:var(--book-text, red)}');
		expect(removed).toBe(3);
	});

	it('maps author colours onto theme roles and keeps status windows on one page', () => {
		const { css } = sanitiseStylesheet(
			`.status { border: 2px solid #3a6; background: rgb(10 20 30 / 0.5); color: white }
			 .note { border-radius: 4px; text-decoration-color: hsl(0 50% 50%) }`,
			ctx
		);
		expect(css).toBe(
			[
				'.status{border:2px solid var(--book-outline, #3a6);background:var(--book-surface, rgb(10 20 30 / 0.5));color:var(--book-text, white);break-inside:avoid;-webkit-column-break-inside:avoid}',
				'.note{border-radius:4px;text-decoration-color:var(--book-text, hsl(0 50% 50%))}'
			].join('\n')
		);
	});

	it('leaves colour words alone inside urls and strings', () => {
		const { css } = sanitiseStylesheet('p { background: url(red-dots.png) navy }', ctx);
		expect(css).toBe(
			'p{background:url("../res/red-dots.png") var(--book-surface, navy);break-inside:avoid;-webkit-column-break-inside:avoid}'
		);
	});

	it('sanitises style attributes the same way', () => {
		expect(sanitiseDeclarations('color:#900; position:absolute; font-weight:bold', ctx).css).toBe(
			'color:var(--book-text, #900);font-weight:bold'
		);
	});

	it('survives garbage', () => {
		expect(sanitiseStylesheet('}}} p { color: blue', ctx).css).toContain('p{');
		expect(sanitiseDeclarations(';;;', ctx).css).toBe('');
	});
});
