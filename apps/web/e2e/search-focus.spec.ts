import type { Page } from '@playwright/test';
import {
	expect,
	openReader,
	settled,
	showChrome,
	storedPreferences,
	test,
	visibleWords
} from './fixtures';

// Phase 1.12 Try-it list (IMPLEMENTATION-PLAN.md §6) and the acceptance for P1-RDR-10 (search in
// the Book) and P1-RDR-11 (focus mode).

test.use({ viewport: { width: 1280, height: 800 } });

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Search in this book' });
const field = (page: Page) => page.getByRole('searchbox', { name: 'Search in this book' });
const status = (page: Page) => page.getByTestId('search-status');
const results = (page: Page) => page.getByTestId('search-results').locator('button.hit');
const bookFrames = (page: Page) => page.frames().filter((f) => f.url().startsWith('blob:'));

/** Searches and waits until every Chapter has been looked in. */
async function find(page: Page, query: string) {
	if (!(await sheet(page).isVisible())) await page.keyboard.press('Slash');
	await expect(sheet(page)).toBeVisible();
	await field(page).fill(query);
	await expect(status(page)).not.toHaveText(/so far|Searching|Type a word/);
}

/** The text painted with the search decoration, in whichever Chapter frame has it. */
async function searchHighlight(page: Page): Promise<string | null> {
	for (const frame of bookFrames(page)) {
		const text = await frame
			.evaluate(() => {
				const h = CSS.highlights.get('rd-search');
				return h ? [...h].map((r) => (r as Range).toString()).join(' ') : null;
			})
			.catch(() => null);
		if (text) return text;
	}
	return null;
}

async function setLayout(page: Page, label: 'Single' | 'Spread' | 'Scroll') {
	await showChrome(page);
	await page.getByRole('button', { name: 'Reading preferences' }).click();
	await page.getByRole('tab', { name: 'Page' }).click();
	await page
		.getByRole('radiogroup', { name: 'Layout' })
		.getByRole('radio', { name: label })
		.click();
	await page.keyboard.press('Escape');
	await settled(page);
}

test('search Alice for “Cheshire”: every result by Chapter; jump to one, then Back', async ({
	page
}) => {
	await openReader(page, 'book-alice');
	await settled(page);
	const origin = await visibleWords(page);

	await find(page, 'cheshire');
	// All seven, in the two Chapters the Cat is in, each with its line of context.
	await expect(status(page)).toHaveText('7 results in 2 chapters');
	await expect(results(page)).toHaveCount(7);
	await expect(sheet(page).getByRole('heading', { level: 3 })).toHaveText([
		/Pig and Pepper\s*4/,
		/Queen’s Croquet-Ground\s*3/
	]);
	await expect(results(page).nth(0)).toHaveText(
		'“It’s a Cheshire cat,” said the Duchess, “and that’s why. …'
	);

	const third = results(page).nth(2);
	const ordinal = Number(await third.getAttribute('data-ordinal'));
	await third.click();
	await expect(sheet(page)).toBeHidden();
	await settled(page);
	// On screen, and marked.
	const shown = await visibleWords(page);
	expect(ordinal).toBeGreaterThanOrEqual(shown.first);
	expect(ordinal).toBeLessThanOrEqual(shown.last);
	await expect.poll(() => searchHighlight(page)).toBe('Cheshire');
	await expect(page.getByTestId('chapter-title')).toContainText('Pig and Pepper');

	// A second result, then Back: to where the reader was before searching, not the first result.
	await page.keyboard.press('Slash');
	await results(page).nth(6).click();
	await settled(page);
	await expect(page.getByTestId('chapter-title')).toContainText('Croquet-Ground');
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await settled(page);
	const back = await visibleWords(page);
	expect(origin.first).toBeGreaterThanOrEqual(back.first);
	expect(origin.first).toBeLessThanOrEqual(back.last);
	await expect.poll(() => searchHighlight(page)).toBeNull();
});

test('a phrase across a line break or inline markup, ignoring case and accents; Enter jumps', async ({
	page
}) => {
	await openReader(page, 'book-alice');
	await settled(page);
	// “How doth the little crocodile<br/> Improve his shining tail”
	await find(page, 'Crocodile IMPROVE');
	await expect(status(page)).toHaveText('1 result in 1 chapter');
	// “Would the fall <i>never</i> come to an end?”
	await find(page, 'fall never come');
	await expect(status(page)).toHaveText('1 result in 1 chapter');
	await expect(results(page).first().locator('mark')).toHaveText('fall never come');
	// Accents in the query don't matter either.
	await find(page, 'Chéshire');
	await expect(status(page)).toHaveText('7 results in 2 chapters');

	await field(page).fill('fall never come');
	await field(page).press('Enter');
	await expect(sheet(page)).toBeHidden();
	await expect.poll(() => searchHighlight(page)).toBe('fall never come');
	await expect(page.getByTestId('chapter-title')).toContainText('Down the Rabbit-Hole');

	// Nothing found says so; a common word offers more than the first results.
	await find(page, 'zyzzyva');
	await expect(status(page)).toHaveText('No results for “zyzzyva”.');
	await find(page, 'the');
	await expect(sheet(page).getByRole('button', { name: /Show more/ })).toBeVisible();
	await expect(results(page)).toHaveCount(200);
});

test('results jump to the right Word in every layout', async ({ page }) => {
	test.slow();
	await openReader(page, 'book-alice');
	await settled(page);
	for (const layout of ['Single', 'Spread', 'Scroll'] as const) {
		await setLayout(page, layout);
		await find(page, 'cheshire');
		const last = results(page).last();
		const ordinal = Number(await last.getAttribute('data-ordinal'));
		await last.click();
		await settled(page);
		const shown = await visibleWords(page);
		expect(ordinal, layout).toBeGreaterThanOrEqual(shown.first);
		expect(ordinal, layout).toBeLessThanOrEqual(shown.last);
		await expect.poll(() => searchHighlight(page)).toBe('Cheshire');
		// Back, so the next layout starts where the reader was.
		await page.getByRole('button', { name: 'Back', exact: true }).click();
		await settled(page);
	}
});

// ---- Focus mode ----

interface FocusState {
	on: boolean;
	focused: { b: string | null; text: string; opacity: string }[];
	dimmed: number;
	dimOpacity: string | null;
	transition: string | null;
	contrast: number | null;
}

/** Focus mode as painted in the Chapter's frame: the bright Block, and the dimmed ones. */
async function focusState(page: Page): Promise<FocusState> {
	for (const frame of bookFrames(page)) {
		const state = await frame
			.evaluate(() => {
				const root = document.documentElement;
				const focused = [...document.querySelectorAll('[data-rd-focused]')];
				const leaves = [...document.querySelectorAll('[data-b]')].filter(
					(el) => !el.querySelector('[data-b]') && !el.hasAttribute('data-rd-focused')
				);
				const dim = leaves[0] ? getComputedStyle(leaves[0]) : null;
				const luminance = (rgb: string) => {
					const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
						const c = Number(v) / 255;
						return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
					});
					return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
				};
				let contrast: number | null = null;
				if (focused[0]) {
					const fg = luminance(getComputedStyle(focused[0]).color);
					const bg = luminance(getComputedStyle(document.body).backgroundColor);
					contrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
				}
				return {
					on: root.hasAttribute('data-rd-focus'),
					focused: focused.map((el) => ({
						b: el.getAttribute('data-b'),
						text: (el.textContent ?? '').trim().slice(0, 40),
						opacity: getComputedStyle(el).opacity
					})),
					dimmed: leaves.filter((el) => getComputedStyle(el).opacity !== '1').length,
					dimOpacity: dim?.opacity ?? null,
					transition: dim?.transitionDuration ?? null,
					contrast
				};
			})
			.catch(() => null);
		if (state && (state.on || state.focused.length)) return state;
	}
	return { on: false, focused: [], dimmed: 0, dimOpacity: null, transition: null, contrast: null };
}

async function focusMode(page: Page, on: boolean) {
	await showChrome(page);
	await page.getByRole('button', { name: 'Reading preferences' }).click();
	await page.getByRole('tab', { name: 'Page' }).click();
	const toggle = page.getByRole('switch', { name: 'Focus mode' });
	if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
	await page.keyboard.press('Escape');
	await settled(page);
}

async function theme(page: Page, mode: 'Light' | 'Dark' | 'Sepia') {
	await showChrome(page);
	await page.getByRole('button', { name: 'Reading preferences' }).click();
	await page.getByRole('tab', { name: 'Theme' }).click();
	await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: mode }).click();
	await page.keyboard.press('Escape');
	await settled(page);
}

test('focus mode: one paragraph bright, moved a paragraph at a time, in light and dark', async ({
	page
}) => {
	test.slow();
	await openReader(page, 'book-alice');
	await settled(page);
	await focusMode(page, true);
	await expect
		.poll(async () => (await storedPreferences(page, 'user-reader')) as object | undefined)
		.toMatchObject({ focusMode: true });

	await expect.poll(async () => (await focusState(page)).focused.length).toBeGreaterThan(0);
	let state = await focusState(page);
	expect(state.on).toBe(true);
	expect(state.focused[0]!.opacity).toBe('1');
	expect(state.dimmed).toBeGreaterThan(0);
	expect(Number(state.dimOpacity)).toBeLessThan(0.5);
	// AA on the focused text (§11.7).
	expect(state.contrast!).toBeGreaterThanOrEqual(4.5);
	const first = state.focused[0]!.b;

	// ↓ moves to the next paragraph; ↑ back.
	await page.keyboard.press('ArrowDown');
	await expect.poll(async () => (await focusState(page)).focused[0]?.b).not.toBe(first);
	const second = (await focusState(page)).focused[0]!.b;
	expect(Number(second)).toBeGreaterThan(Number(first));
	await page.keyboard.press('ArrowUp');
	await expect.poll(async () => (await focusState(page)).focused[0]?.b).toBe(first);

	// → steps on through the page and turns it when the paragraphs run out.
	const before = await visibleWords(page);
	for (let i = 0; i < 25 && (await visibleWords(page)).first === before.first; i++) {
		await page.keyboard.press('ArrowRight');
		await page.waitForTimeout(120);
	}
	await settled(page);
	const turned = await visibleWords(page);
	expect(turned.first).toBeGreaterThan(before.first);
	await expect.poll(async () => (await focusState(page)).focused.length).toBeGreaterThan(0);

	// A tap at the right side moves it on too.
	const atTap = (await focusState(page)).focused[0]!.b;
	await page.mouse.click(1180, 400);
	await expect.poll(async () => (await focusState(page)).focused[0]?.b).not.toBe(atTap);

	// Dark: still AA on the focused text, the rest still dimmed.
	await theme(page, 'Dark');
	await expect.poll(async () => (await focusState(page)).contrast ?? 0).toBeGreaterThanOrEqual(4.5);
	state = await focusState(page);
	expect(state.dimmed).toBeGreaterThan(0);
	await theme(page, 'Sepia');
	await expect.poll(async () => (await focusState(page)).contrast ?? 0).toBeGreaterThanOrEqual(4.5);

	// Off: nothing dimmed.
	await focusMode(page, false);
	await expect.poll(async () => (await focusState(page)).on).toBe(false);
});

test('focus mode in spread and scroll layouts', async ({ page }) => {
	test.slow();
	await openReader(page, 'book-alice');
	await settled(page);
	await focusMode(page, true);
	for (const layout of ['Spread', 'Scroll'] as const) {
		await setLayout(page, layout);
		await expect
			.poll(async () => (await focusState(page)).focused.length, layout)
			.toBeGreaterThan(0);
		const first = (await focusState(page)).focused[0]!.b;
		await page.keyboard.press('ArrowDown');
		await expect.poll(async () => (await focusState(page)).focused[0]?.b, layout).not.toBe(first);
	}
});

test('reduced motion removes the focus transition', async ({ page }) => {
	await openReader(page, 'book-alice');
	await settled(page);
	await focusMode(page, true);
	await expect.poll(async () => (await focusState(page)).transition).toBe('0.2s');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await expect.poll(async () => (await focusState(page)).transition).toBe('0s');
});
