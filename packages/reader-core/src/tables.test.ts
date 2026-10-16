// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isSqueezed, TABLE_ROW, tableOfRow, tableRow, tableView } from './tables';

// The table viewer's copy (P1-RDR-12): Book content is untrusted (Invariant 10), so the copy in
// the app's document is rebuilt from an allowlist. Whether a table is squeezed needs real layout:
// that's in e2e/phone-comfort.spec.ts.

function chapter(body: string): Document {
	const doc = document.implementation.createHTMLDocument('Chapter');
	doc.body.innerHTML = body;
	return doc;
}

describe('the table viewer’s copy', () => {
	const doc = chapter(`
		<table class="stats" data-b="7" id="t" onclick="steal()" style="width:100%">
			<caption>Mara’s   stats</caption>
			<thead><tr><th scope="col" data-b="8">Stat</th><th onmouseover="x()">Total</th></tr></thead>
			<tbody>
				<tr><td>Strength <b>(base)</b><script>steal()</script></td><td class="num">4</td></tr>
				<tr><td colspan="2" rowspan="1"><a href="https://tracker.example.invalid/">Unspent</a> points
					<img src="https://tracker.example.invalid/pixel.png" alt="[icon]"/>
					<iframe src="https://example.invalid/"></iframe><svg><text>svg</text></svg></td></tr>
				<tr><td><span data-injected="figure">injected</span>Wits<br/>(clever)</td><td lang="en-GB" dir="ltr">11</td></tr>
			</tbody>
		</table>`);
	const view = tableView(doc.querySelector('table')!, document);
	const copy = view.table;

	it('keeps the text, the structure and what gives a table its meaning', () => {
		expect(copy.ownerDocument).toBe(document);
		expect(copy.querySelectorAll('tr')).toHaveLength(4);
		expect(copy.querySelector('th')!.getAttribute('scope')).toBe('col');
		expect(copy.querySelector('td[colspan="2"]')).not.toBeNull();
		expect(copy.querySelector('b')!.textContent).toBe('(base)');
		expect(copy.querySelector('br')).not.toBeNull();
		expect(copy.querySelector('td[lang="en-GB"][dir="ltr"]')).not.toBeNull();
		expect(view.caption).toBe('Mara’s stats');
	});

	it('leaves out scripts, frames, handlers, links, ids, classes and remote pictures', () => {
		expect(copy.querySelectorAll('script, iframe, svg, a, img')).toHaveLength(0);
		for (const el of [copy, ...copy.querySelectorAll('*')]) {
			for (const { name } of el.attributes) {
				expect(['style', 'scope', 'colspan', 'rowspan', 'lang', 'dir']).toContain(name);
			}
		}
		// A link is its text; a picture from elsewhere, its alt text.
		expect(copy.textContent).toContain('Unspent points');
		expect(copy.textContent).toContain('[icon]');
		expect(copy.textContent).not.toContain('steal');
		expect(copy.textContent).not.toContain('injected');
		expect(copy.textContent).not.toContain('svg');
	});

	it('carries no URL in the look it copies', () => {
		const styles = [copy, ...copy.querySelectorAll('*')].map(
			(el) => el.getAttribute('style') ?? ''
		);
		expect(styles.join(' ')).not.toMatch(/url\(/);
	});
});

describe('the "Open table" row', () => {
	it('is marked as injected (the word map skips it) and opens the table after it', () => {
		const doc = chapter('<p>Before</p><table><tr><td>A</td></tr></table>');
		const table = doc.querySelector('table')!;
		const row = tableRow(doc, { label: 'Open table', icon: 'M0 0h10v10z' });
		table.before(row);
		expect(row.getAttribute('data-injected')).toBe('table');
		expect(row.hasAttribute(TABLE_ROW)).toBe(true);
		expect(row.querySelector('button')!.textContent).toBe('Open table');
		expect(row.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
		expect(tableOfRow(row)).toBe(table);
		expect(tableOfRow(doc.querySelector('p')!)).toBeNull();
	});

	it('is never added for a table that isn’t laid out', () => {
		const doc = chapter('<table><tr><td>Unlaid</td></tr></table>');
		expect(isSqueezed(doc.querySelector('table')!)).toBe(false);
		expect(doc.querySelectorAll('[data-rd-probe]')).toHaveLength(0);
	});
});
