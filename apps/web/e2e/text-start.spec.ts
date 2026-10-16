import { frontMatterEpub } from './books';
import {
	expect,
	openReader,
	settled,
	showChrome,
	test,
	textOnScreen,
	visibleWords
} from './fixtures';

// P1-RDR-09 (Phase 1.10 Try-it): a Book opened for the first time starts at its text, not at
// its front matter (a licence, a contents page). With Reading Progress it resumes instead.

test.use({ viewport: { width: 1280, height: 800 } });

const ready = (page: import('@playwright/test').Page) =>
	expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });

test('Alice from the Library opens at Chapter I, and next time where the reader got to', async ({
	page
}) => {
	await page.goto('/library');
	await page
		.getByRole('link', { name: /Alice's Adventures in Wonderland/ })
		.first()
		.click();
	await ready(page);
	await settled(page);
	// Project Gutenberg's licence and contents come first in the EPUB; it names no landmark.
	await expect(page.getByTestId('chapter-title')).toContainText('Down the Rabbit-Hole');
	await expect(page.getByTestId('page-label')).toHaveText(/Page 1 of \d+/);
	expect(await textOnScreen(page, 'Project Gutenberg')).toBe(false);

	await page.keyboard.press('ArrowRight');
	await settled(page);
	await page.keyboard.press('ArrowRight');
	await settled(page);
	const before = await visibleWords(page);
	await showChrome(page);
	await page.getByRole('link', { name: 'Back to library' }).click();
	await expect(page.getByRole('heading', { name: 'Continue reading' })).toBeVisible();
	await openReader(page, 'book-alice');
	await settled(page);
	const after = await visibleWords(page);
	expect(after.first).toBeLessThanOrEqual(before.first);
	expect(after.last).toBeGreaterThanOrEqual(before.first);
});

test('a store Book opens where its EPUB’s bodymatter landmark says the text starts', async ({
	page
}) => {
	await page.goto('/book/treasure-island');
	await page.getByRole('button', { name: 'Add to library' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Add to library' }).click();
	await expect(page.getByTestId('checkout')).toContainText('is in your library');
	await openReader(page, 'book-treasure-island');
	await settled(page);
	// Not its title page, imprint, epigraph or dedication.
	await expect(page.getByTestId('chapter-title')).toHaveText('Part I: The Old Buccaneer');
	expect(await textOnScreen(page, 'The Old Buccaneer')).toBe(true);
	expect(await textOnScreen(page, 'Standard Ebooks')).toBe(false);
});

test('an imported EPUB without landmarks opens at its first chapter', async ({ page }) => {
	await page.goto('/library');
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Import EPUB' }).first().click();
	await (
		await chooser
	).setFiles({
		name: 'the-quay.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(frontMatterEpub())
	});
	await page
		.getByRole('dialog', { name: 'Imported' })
		.getByRole('link', { name: 'Read now' })
		.click();
	await ready(page);
	await settled(page);
	await expect(page.getByTestId('chapter-title')).toHaveText('Chapter 1. Low Tide');
	const start = await visibleWords(page);
	expect(start.word).toBe('Chapter');
	expect(await textOnScreen(page, 'almost no restrictions')).toBe(false);

	// The front matter is still there, a page back.
	await page.keyboard.press('ArrowLeft');
	await settled(page);
	expect((await visibleWords(page)).first).toBeLessThan(start.first);
	await expect(page.getByTestId('chapter-title')).toHaveText('Contents');
});
