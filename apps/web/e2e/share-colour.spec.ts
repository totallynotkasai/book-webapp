import type { Frame, Page } from '@playwright/test';
import {
	expect,
	openPreferences,
	openReader,
	selectPhrase,
	storedPreferences,
	test
} from './fixtures';

// Phase 1.17 (IMPLEMENTATION-PLAN.md §6): its Try-it items and the acceptance of P1-RDR-16 (share
// quote) and P1-UI-04 (custom colours). Android's share sheet is checked on a device
// (docs/device-checklist.md); here a phone browser's Web Share API stands in for it.

async function bookFrame(page: Page): Promise<Frame> {
	await expect.poll(() => page.frames().some((f) => f.url().startsWith('blob:'))).toBe(true);
	return page.frames().find((f) => f.url().startsWith('blob:'))!;
}

/** The reading page's colours, as the Chapter's frame paints them. */
async function pageColours(page: Page) {
	return (await bookFrame(page)).evaluate(() => {
		const style = getComputedStyle(document.body);
		return { background: style.backgroundColor, text: style.color };
	});
}

const rgb = (hex: string) =>
	`rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

/** WCAG contrast between two `#rrggbb` colours. */
function contrast(a: string, b: string) {
	const lum = (hex: string) => {
		const [r, g, bl] = [1, 3, 5].map((i) => {
			const c = parseInt(hex.slice(i, i + 2), 16) / 255;
			return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
	};
	const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
	return (hi! + 0.05) / (lo! + 0.05);
}

const storedTheme = async (page: Page) =>
	((await storedPreferences(page, 'user-reader')) as { theme?: Record<string, unknown> })?.theme;

const field = (page: Page, name: 'Page colour' | 'Text colour') =>
	page.getByRole('textbox', { name, exact: true });

async function setColour(page: Page, name: 'Page colour' | 'Text colour', hex: string) {
	await field(page, name).fill(hex);
	await field(page, name).press('Enter');
}

test.describe('custom colours (P1-UI-04)', () => {
	test('a dark green page with cream text; a pair below AA needs a choice', async ({ page }) => {
		await openReader(page, 'book-alice');
		const before = await pageColours(page);
		await openPreferences(page, 'Theme');
		await page
			.getByRole('radiogroup', { name: 'Mode' })
			.getByRole('radio', { name: 'Custom' })
			.click();
		const editor = page.getByTestId('custom-colours');
		await expect(editor).toBeVisible();
		// Custom starts from the page as it was, so nothing changes yet.
		expect(await pageColours(page)).toEqual(before);

		// Dark green under the old dark text fails: the page keeps its colours.
		await setColour(page, 'Page colour', '#1f3d2b');
		await expect(page.getByTestId('contrast-grade')).toHaveText('Below AA');
		await expect(page.getByRole('group', { name: 'Contrast warning' })).toBeVisible();
		expect((await pageColours(page)).background).toBe(before.background);

		await setColour(page, 'Text colour', '#f3ead3');
		await expect(page.getByTestId('contrast-grade')).toHaveText('Meets AAA, the highest level');
		await expect(editor).toContainText('Contrast 9.');
		await expect
			.poll(() => pageColours(page))
			.toEqual({ background: rgb('#1f3d2b'), text: rgb('#f3ead3') });
		await expect
			.poll(() => storedTheme(page))
			.toMatchObject({ mode: 'custom', custom: { page: '#1f3d2b', text: '#f3ead3' } });

		// A pair that fails AA isn't saved without the warning's choice.
		await setColour(page, 'Text colour', '#3d6b50');
		await expect(page.getByTestId('contrast-grade')).toHaveText('Below AA');
		await expect(editor).toContainText('Your page keeps its colours until you choose.');
		await expect(page.getByTestId('custom-colours-sample')).toHaveCSS('color', rgb('#3d6b50'));
		expect((await pageColours(page)).text).toBe(rgb('#f3ead3'));
		expect((await storedTheme(page))?.custom).toEqual({ page: '#1f3d2b', text: '#f3ead3' });

		// The nearest readable colour: the text changed last, so the text moves, just far enough.
		await page.getByRole('button', { name: 'Use nearest readable colour' }).click();
		await expect(page.getByTestId('contrast-grade')).toHaveText(
			'Meets AA, readable for most people'
		);
		await expect
			.poll(async () => ((await storedTheme(page))?.custom as { text: string }).text)
			.not.toBe('#f3ead3');
		const fixed = ((await storedTheme(page))?.custom as { page: string; text: string }).text;
		expect(contrast(fixed, '#1f3d2b')).toBeGreaterThanOrEqual(4.5);
		expect(contrast(fixed, '#1f3d2b')).toBeLessThan(5.5);
		await expect(field(page, 'Text colour')).toHaveValue(fixed);
		await expect.poll(() => pageColours(page)).toMatchObject({ text: rgb(fixed) });

		// Kept on purpose, with the warning still saying so.
		await setColour(page, 'Text colour', '#3d6b50');
		await page.getByRole('button', { name: 'Keep these colours' }).click();
		await expect
			.poll(() => storedTheme(page))
			.toMatchObject({ custom: { page: '#1f3d2b', text: '#3d6b50' } });
		await expect(editor).toContainText('You kept these colours.');
		await expect(page.getByRole('button', { name: 'Keep these colours' })).toBeHidden();
		await expect.poll(() => pageColours(page)).toMatchObject({ text: rgb('#3d6b50') });

		// Settings shows the same choice, and a suggestion applies at once.
		await page.goto('/you/settings');
		await expect(page.getByRole('radio', { name: 'Custom', exact: true })).toBeChecked();
		await page.getByRole('button', { name: 'Black on yellow' }).click();
		await expect(page.getByTestId('reading-preview')).toHaveCSS('background-color', rgb('#ffe94d'));
		await expect
			.poll(() => storedTheme(page))
			.toMatchObject({ custom: { page: '#ffe94d', text: '#000000' } });
	});

	test('a pair for one Book only leaves the reading defaults as they were', async ({ page }) => {
		await openReader(page, 'book-alice');
		await openPreferences(page, 'Theme');
		await page.getByRole('switch', { name: 'This book only' }).click();
		await page
			.getByRole('radiogroup', { name: 'Mode' })
			.getByRole('radio', { name: 'Custom' })
			.click();
		await page.getByRole('button', { name: 'Amber on black' }).click();
		await expect
			.poll(() => pageColours(page))
			.toEqual({
				background: rgb('#000000'),
				text: rgb('#ffb84d')
			});
		await page.keyboard.press('Escape');
		await page.goto('/you/settings');
		await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();
		await expect(page.getByTestId('reading-preview')).not.toHaveCSS(
			'background-color',
			rgb('#000000')
		);
		expect((await storedTheme(page))?.mode).not.toBe('custom');
		// Back in the Book, its own colours are still there.
		await openReader(page, 'book-alice');
		expect(await pageColours(page)).toEqual({ background: rgb('#000000'), text: rgb('#ffb84d') });
	});
});

test.describe('share quote (P1-RDR-16)', () => {
	test('a sentence of Alice as a picture: alt text, the exact Words, a download', async ({
		page
	}) => {
		await openReader(page, 'book-alice');
		await selectPhrase(page, 'Alice was beginning to get very tired');
		await page.getByRole('button', { name: 'Share quote' }).click();
		const dialog = page.getByRole('dialog', { name: 'Share quote' });
		const card = dialog.getByTestId('quote-card');
		await expect(card).toHaveAttribute(
			'alt',
			"Quote from Alice's Adventures in Wonderland by Lewis Carroll: Alice was beginning to get very tired"
		);
		await expect(card).toHaveJSProperty('naturalWidth', 1080);
		await expect(card).toHaveJSProperty('naturalHeight', 1350);
		await expect(dialog).not.toContainText('shortened');

		const download = page.waitForEvent('download');
		await dialog.getByRole('button', { name: 'Download' }).click();
		expect((await download).suggestedFilename()).toBe('alices-adventures-in-wonderland-quote.png');
		await expect(dialog).toBeHidden();
		await expect(page.getByText('Picture saved')).toBeVisible();
	});

	test('as text, with the title and author, copied', async ({ page, context, browserName }) => {
		if (browserName === 'chromium') {
			await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		}
		await openReader(page, 'book-alice');
		await selectPhrase(page, 'once or twice she had peeped into the book');
		await page.getByRole('button', { name: 'Share quote' }).click();
		const dialog = page.getByRole('dialog', { name: 'Share quote' });
		await dialog.getByRole('radio', { name: 'Text' }).click();
		const expected =
			"“once or twice she had peeped into the book”\n\n— Lewis Carroll, Alice's Adventures in Wonderland";
		await expect(dialog.getByTestId('quote-text')).toHaveText(expected);
		await dialog.getByRole('button', { name: 'Copy text' }).click();
		await expect(page.getByText('Quote copied')).toBeVisible();
		if (browserName === 'chromium') {
			// The system clipboard may turn line breaks into CRLF (Windows).
			const copied = await page.evaluate(() => navigator.clipboard.readText());
			expect(copied.replace(/\r\n/g, '\n')).toBe(expected);
		}
	});

	test('a long passage is shortened to 60 Words with an ellipsis', async ({ page }) => {
		await openReader(page, 'book-alice');
		for (let i = 0; i < 75; i++) await page.keyboard.press('Shift+ArrowRight');
		await expect(page.getByRole('toolbar', { name: 'Selection' })).toBeVisible();
		await page.getByRole('button', { name: 'Share quote' }).click();
		const dialog = page.getByRole('dialog', { name: 'Share quote' });
		await expect(dialog).toContainText('Long passages are shortened to about 60 words.');
		await dialog.getByRole('radio', { name: 'Text' }).click();
		const text = (await dialog.getByTestId('quote-text').textContent())!.split('\n\n— ')[0]!;
		expect(text).toMatch(/…”?$/);
		expect(text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)).toHaveLength(60);
		await expect(dialog.getByTestId('quote-card')).toHaveCount(0);
		await dialog.getByRole('radio', { name: 'Picture' }).click();
		await expect(dialog.getByTestId('quote-card')).toHaveAttribute('alt', /…$/);
	});

	test.describe('in a phone’s browser', () => {
		test.beforeEach(async ({ page }) => {
			// The Web Share API as phones' browsers have it, with files; it records what it was given.
			await page.addInitScript(() => {
				const record = globalThis as unknown as { __shared?: unknown };
				Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
				Object.defineProperty(navigator, 'share', {
					configurable: true,
					value: async (data: ShareData) => {
						record.__shared = {
							title: data.title,
							text: data.text,
							files: (data.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size }))
						};
					}
				});
			});
		});

		test('a highlight shared as a picture goes to the share sheet', async ({ page }) => {
			await openReader(page, 'book-alice');
			await selectPhrase(page, 'Alice was beginning to get very tired');
			await page.getByRole('button', { name: 'Highlight yellow' }).click();
			await expect(page.getByRole('toolbar')).toBeHidden();
			// Tapping the highlight opens its toolbar, which shares the highlighted Words.
			const frame = await bookFrame(page);
			const at = await frame.evaluate(() => {
				const host = window.frameElement!.getBoundingClientRect();
				const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
				for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
					const i = n.data.indexOf('beginning');
					if (i < 0) continue;
					const range = document.createRange();
					range.setStart(n, i + 2);
					range.setEnd(n, i + 3);
					const r = range.getBoundingClientRect();
					return { x: host.left + r.left, y: host.top + r.top + r.height / 2 };
				}
				throw new Error('not on screen');
			});
			await page.mouse.click(at.x, at.y);
			await expect(page.getByRole('toolbar', { name: 'Highlight' })).toBeVisible();
			await page.getByRole('button', { name: 'Share quote' }).click();
			const dialog = page.getByRole('dialog', { name: 'Share quote' });
			await expect(dialog.getByTestId('quote-card')).toBeVisible();
			await dialog.getByRole('button', { name: 'Share', exact: true }).click();
			await expect(dialog).toBeHidden();
			const shared = await page.evaluate(
				() => (globalThis as unknown as { __shared: unknown }).__shared
			);
			expect(shared).toMatchObject({
				title: "Alice's Adventures in Wonderland",
				text: "“Alice was beginning to get very tired”\n\n— Lewis Carroll, Alice's Adventures in Wonderland",
				files: [{ name: 'alices-adventures-in-wonderland-quote.png', type: 'image/png' }]
			});
		});
	});
});
