import type { Page } from '@playwright/test';
import {
	expect,
	openPreferences,
	openReader,
	settled,
	showChrome,
	storedPreferences,
	test,
	visibleWords
} from './fixtures';

// Phase 1.2 Try-it list (IMPLEMENTATION-PLAN.md §6) and acceptance for P1-RDR-01 to P1-RDR-05:
// read Alice in every layout; change typography and theme mid-chapter and keep the same Word on
// screen; TOC, scrubber and Back; keyboard; resume at the same Word.

test.use({ viewport: { width: 1280, height: 800 } });

/** Opens Alice and turns into Chapter I, so changes happen mid-chapter. */
async function intoChapterOne(page: Page) {
	await openReader(page, 'book-alice');
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents' }).click();
	await page.getByRole('button', { name: /Down the Rabbit-Hole/ }).click();
	await expect(page.getByTestId('chapter-title')).toContainText('Down the Rabbit-Hole');
	await settled(page);
	await page.keyboard.press('ArrowRight');
	await settled(page);
	await page.keyboard.press('ArrowRight');
	await settled(page);
}

/** After a re-layout, the Word that was first on screen must still be on screen (§9.1). */
async function expectStillOnScreen(page: Page, before: { first: number }) {
	await settled(page);
	const after = await visibleWords(page);
	expect(after.first, `first Word ${before.first} left the screen`).toBeLessThanOrEqual(
		before.first
	);
	expect(after.last).toBeGreaterThanOrEqual(before.first);
}

test('opens Alice from the Library and turns pages forward and back', async ({ page }) => {
	await page.goto('/library');
	await page
		.getByRole('link', { name: /Alice's Adventures in Wonderland/ })
		.first()
		.click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await settled(page);
	const start = await visibleWords(page);
	await expect(page.getByTestId('page-label')).toHaveText(/Page 1 of \d+/);
	await page.keyboard.press('ArrowRight');
	await settled(page);
	const next = await visibleWords(page);
	expect(next.first).toBeGreaterThan(start.last);
	await page.keyboard.press('ArrowLeft');
	await settled(page);
	expect((await visibleWords(page)).first).toBe(start.first);
	// The chrome fades after the first page turn and comes back with Esc.
	await expect(page.getByTestId('reader')).toHaveClass(/chrome-hidden/);
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('reader')).not.toHaveClass(/chrome-hidden/);
});

test('single, spread and scroll layouts keep the same Word on screen', async ({ page }) => {
	await intoChapterOne(page);
	for (const layout of ['Single', 'Spread', 'Scroll', 'Auto'] as const) {
		const before = await visibleWords(page);
		await openPreferences(page, 'Page');
		await page
			.getByRole('radiogroup', { name: 'Layout' })
			.getByRole('radio', { name: layout })
			.click();
		await page.keyboard.press('Escape');
		await expectStillOnScreen(page, before);
	}
});

test('font, size, spacing, margins and theme apply live and keep the same Word', async ({
	page
}) => {
	await intoChapterOne(page);

	let before = await visibleWords(page);
	await openPreferences(page, 'Text');
	const size = page.getByRole('slider', { name: 'Text size' });
	await size.focus();
	for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
	await expect(size).toHaveAttribute('aria-valuetext', '130%');
	await expectStillOnScreen(page, before);

	before = await visibleWords(page);
	await page.getByRole('radio', { name: /Atkinson Hyperlegible/ }).check();
	await expectStillOnScreen(page, before);

	before = await visibleWords(page);
	const spacing = page.getByRole('slider', { name: 'Line spacing' });
	await spacing.focus();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expectStillOnScreen(page, before);

	before = await visibleWords(page);
	await page.getByRole('tab', { name: 'Page' }).click();
	await page
		.getByRole('radiogroup', { name: 'Margins' })
		.getByRole('radio', { name: 'Wide' })
		.click();
	await expectStillOnScreen(page, before);

	before = await visibleWords(page);
	await page.getByRole('tab', { name: 'Theme' }).click();
	await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Dark' }).click();
	await expectStillOnScreen(page, before);
	const background = await page
		.getByTestId('reader')
		.evaluate((el) => getComputedStyle(el).backgroundColor);
	await page
		.getByRole('radiogroup', { name: 'Mode' })
		.getByRole('radio', { name: 'Sepia' })
		.click();
	await expect
		.poll(() => page.getByTestId('reader').evaluate((el) => getComputedStyle(el).backgroundColor))
		.not.toBe(background);
});

test('"This book only" keeps changes to one Book and "Reset" brings back the defaults', async ({
	page
}) => {
	await openReader(page, 'book-alice');
	await openPreferences(page, 'Text');
	await page.getByRole('switch', { name: /This book only/ }).click();
	const size = page.getByRole('slider', { name: 'Text size' });
	await size.focus();
	await page.keyboard.press('End');
	await expect(size).toHaveAttribute('aria-valuetext', '250%');
	// The global preferences are untouched; the Book keeps its own size when reopened.
	const global = (await storedPreferences(page, 'user-reader')) as
		{ fontScale?: number } | undefined;
	expect(global?.fontScale ?? 1).toBe(1);
	await page.goto('/library');
	await openReader(page, 'book-alice');
	await openPreferences(page, 'Text');
	await expect(page.getByRole('slider', { name: 'Text size' })).toHaveAttribute(
		'aria-valuetext',
		'250%'
	);
	await page.getByRole('button', { name: 'Reset to my defaults' }).click();
	await expect(page.getByRole('slider', { name: 'Text size' })).toHaveAttribute(
		'aria-valuetext',
		'100%'
	);
});

test('the TOC and the scrubber jump, and Back returns to where you were', async ({ page }) => {
	await intoChapterOne(page);
	const before = await visibleWords(page);

	await showChrome(page);
	await page.getByRole('button', { name: 'Contents' }).click();
	await page.getByRole('button', { name: /A Caucus-Race/ }).click();
	await expect(page.getByTestId('chapter-title')).toContainText('A Caucus-Race');
	await page.getByRole('button', { name: 'Back' }).click();
	await settled(page);
	expect((await visibleWords(page)).first).toBe(before.first);

	await showChrome(page);
	const thumb = page.getByRole('slider', { name: 'Position in book' });
	await thumb.focus();
	await page.keyboard.press('End');
	await settled(page);
	expect((await visibleWords(page)).first).toBeGreaterThan(before.first + 20_000);
	await page.getByRole('button', { name: 'Back' }).click();
	await settled(page);
	expect((await visibleWords(page)).first).toBe(before.first);
});

test('Home and End go to the chapter’s start and end; ? lists the shortcuts', async ({ page }) => {
	await intoChapterOne(page);
	await page.keyboard.press('End');
	await settled(page);
	const end = await visibleWords(page);
	await page.keyboard.press('Home');
	await settled(page);
	const start = await visibleWords(page);
	expect(start.first).toBeLessThan(end.first);
	await page.keyboard.press('?');
	await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('page and chapter changes are announced', async ({ page }) => {
	await openReader(page, 'book-alice');
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents' }).click();
	await page.getByRole('button', { name: /The Pool of Tears/ }).click();
	await expect(page.getByTestId('announcer')).toHaveText(/The Pool of Tears.*Page 1 of \d+/);
	await page.keyboard.press('ArrowRight');
	await expect(page.getByTestId('announcer')).toHaveText(/^Page 2 of \d+\.$/);
});

test('closing and reopening resumes at the same Word', async ({ page }) => {
	await intoChapterOne(page);
	const before = await visibleWords(page);
	// Leaving the reader saves at once (the 2 s debounce is for page turns).
	await showChrome(page);
	await page.getByRole('link', { name: 'Back to library' }).click();
	await expect(page.getByRole('heading', { name: 'Continue reading' })).toBeVisible();
	await page.reload();
	await openReader(page, 'book-alice');
	await settled(page);
	const after = await visibleWords(page);
	expect(after.first).toBeLessThanOrEqual(before.first);
	expect(after.last).toBeGreaterThanOrEqual(before.first);
});

test('a catalogue Book without an Entitlement offers to get it', async ({ page }) => {
	await page.goto('/read/book-treasure-island');
	const dialog = page.getByRole('dialog', { name: 'Get this book' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('link', { name: 'See it in the store' })).toHaveAttribute(
		'href',
		/\/book\/treasure-island/
	);
});

test('Settings → Reading defaults set what every Book opens with', async ({ page }) => {
	await page.goto('/you/settings');
	const size = page.getByRole('slider', { name: 'Text size' });
	await size.focus();
	for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
	await expect(size).toHaveAttribute('aria-valuetext', '120%');
	await page
		.getByRole('radiogroup', { name: 'Margins' })
		.getByRole('radio', { name: 'Wide' })
		.click();
	await expect.poll(() => storedPreferences(page, 'user-reader')).toMatchObject({ fontScale: 1.2 });
	await openReader(page, 'book-alice');
	await openPreferences(page, 'Text');
	await expect(page.getByRole('slider', { name: 'Text size' })).toHaveAttribute(
		'aria-valuetext',
		'120%'
	);
	await page.getByRole('tab', { name: 'Page' }).click();
	await expect(
		page.getByRole('radiogroup', { name: 'Margins' }).getByRole('radio', { name: 'Wide' })
	).toHaveAttribute('aria-checked', 'true');
});
