import type { Frame, Page } from '@playwright/test';
import { expect, openDevPanel, openPreferences, settled, showChrome, test } from './fixtures';

// P1-RDR-08 acceptance and the Phase 1.2 Try-it item: the status-window fixture at 200% text in
// light, dark and sepia, with every styled block's text meeting WCAG AA on its own background.

async function bookFrame(page: Page): Promise<Frame> {
	await expect.poll(() => page.frames().some((f) => f.url().startsWith('blob:'))).toBe(true);
	return page.frames().find((f) => f.url().startsWith('blob:'))!;
}

/** The lowest contrast between text and its effective background across the styled blocks. */
async function worstBlockContrast(frame: Frame): Promise<{ ratio: number; where: string }> {
	return frame.evaluate(() => {
		const parse = (c: string) => {
			const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(c);
			return m ? [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]!] : [0, 0, 0, 0];
		};
		const lum = ([r, g, b]: number[]) => {
			const f = (v: number) => {
				const c = v / 255;
				return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
			};
			return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
		};
		const background = (el: Element | null): number[] => {
			for (let e = el; e; e = e.parentElement) {
				const c = parse(getComputedStyle(e).backgroundColor);
				if (c[3]! > 0.5) return c;
			}
			return parse(getComputedStyle(document.documentElement).backgroundColor);
		};
		let worst = { ratio: 21, where: '' };
		const styled = [
			...document.querySelectorAll(
				'[style*="--book-"], .status-window, .system-message, table, pre'
			)
		];
		for (const block of styled) {
			for (const el of [block, ...block.querySelectorAll('*')]) {
				if (!el.textContent?.trim()) continue;
				const fg = lum(parse(getComputedStyle(el).color));
				const bg = lum(background(el));
				const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
				if (ratio < worst.ratio) worst = { ratio, where: el.outerHTML.slice(0, 80) };
			}
		}
		return worst;
	});
}

test.describe('on a small phone at 200%', () => {
	test.use({ viewport: { width: 360, height: 640 } });

	test('status windows keep their monospace and their tables fit inside the box', async ({
		page
	}) => {
		await openDevPanel(page);
		await page.getByRole('button', { name: 'Import the status-window fixture' }).click();
		await page.getByRole('link', { name: 'Read now' }).click();
		await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});
		await openPreferences(page, 'Text');
		const size = page.getByRole('slider', { name: 'Text size' });
		await size.focus();
		for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
		await expect(size).toHaveAttribute('aria-valuetext', '200%');
		await page.keyboard.press('Escape');
		await settled(page);
		const frame = await bookFrame(page);
		const layout = await frame.evaluate(() => {
			const box = document.querySelector('.status-window')!;
			const table = box.querySelector('table')!;
			// The box can break across pages (columns) at 200%: compare each cell with the part of
			// the box in its own column.
			const parts = [...box.getClientRects()];
			let overflow = -Infinity;
			for (const cell of table.querySelectorAll('th, td')) {
				// A cell split across pages is measured by its pieces' text instead.
				overflow = Math.max(overflow, cell.scrollWidth - cell.clientWidth);
				const rects = cell.getClientRects();
				if (rects.length !== 1) continue;
				const r = rects[0]!;
				const part = parts.find((p) => r.left >= p.left - 1 && r.left < p.right);
				if (part) overflow = Math.max(overflow, r.right - part.right);
			}
			return {
				font: getComputedStyle(box.querySelector('p')!).fontFamily,
				overflow,
				body: getComputedStyle(document.querySelector('p:not(.status-window *)')!).fontFamily
			};
		});
		expect(layout.font).toMatch(/monospace/);
		expect(layout.body).not.toMatch(/monospace/);
		expect(Number.isFinite(layout.overflow), 'no table cells were measured').toBe(true);
		expect(layout.overflow).toBeLessThanOrEqual(0);
	});
});

test('the status-window fixture stays readable in light, dark and sepia at 200%', async ({
	page
}) => {
	test.slow();
	await openDevPanel(page);
	await page.getByRole('button', { name: 'Import the status-window fixture' }).click();
	await page.getByRole('link', { name: 'Read now' }).click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await openPreferences(page, 'Text');
	const size = page.getByRole('slider', { name: 'Text size' });
	await size.focus();
	for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
	await expect(size).toHaveAttribute('aria-valuetext', '200%');
	await page.keyboard.press('Escape');

	for (const mode of ['Light', 'Dark', 'Sepia'] as const) {
		await openPreferences(page, 'Theme');
		await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: mode }).click();
		await page.keyboard.press('Escape');
		for (const chapter of ['1. Status', '2. Edge Cases']) {
			await showChrome(page);
			await page.getByRole('button', { name: 'Contents' }).click();
			await page.getByRole('button', { name: chapter }).click();
			await settled(page);
			const worst = await worstBlockContrast(await bookFrame(page));
			expect(worst.ratio, `${mode}, ${chapter}: ${worst.where}`).toBeGreaterThanOrEqual(4.5);
		}
	}
});
