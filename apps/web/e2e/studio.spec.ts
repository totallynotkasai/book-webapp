import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { editedStatusWindow } from '../src/lib/library/test-books';
import {
	expect,
	expectNoViolations,
	settled,
	showChrome,
	storedRecords,
	switchPersona,
	test,
	visibleWords
} from './fixtures';

// Phase 1.7 Try-it list (IMPLEMENTATION-PLAN.md §6), as the Author Persona: upload, report,
// preview, the AI question, publish; a new version keeps the Reader's highlight; three pictures
// attached in Creator mode and published; a Sync Map imported and reviewed; a plan on the
// Creator's profile.

test.use({ viewport: { width: 1280, height: 800 } });

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const STATUS_WINDOW = readFileSync(join(ROOT, 'fixtures/epub/status-window.epub'));
const PICTURE = join(ROOT, 'fixtures/src/status-window/OEBPS/images/sigil.png');
const TITLE = 'Status Window Test Fixture';
const SLUG = 'status-window-test-fixture';

const dialog = (page: Page) => page.getByRole('dialog');

/** As the Author: uploads an EPUB, from the Studio or a Book's page, and waits until it's processed. */
async function upload(page: Page, file: Buffer | Uint8Array, name = 'book.epub') {
	await dialog(page)
		.locator('input[type=file]')
		.setInputFiles({ name, mimeType: 'application/epub+zip', buffer: Buffer.from(file) });
	await dialog(page).getByRole('button', { name: 'Upload' }).click();
	await expect(page).toHaveURL(/\/studio\/books\//);
	await expect(page.getByTestId('revision').first()).toHaveAttribute('data-state', 'ready', {
		timeout: 30_000
	});
}

async function publish(page: Page, aiAnswer = 'No') {
	await page.getByRole('button', { name: 'Publish…' }).click();
	await dialog(page).getByRole('radio', { name: aiAnswer }).click();
	await dialog(page).getByRole('button', { name: 'Publish version' }).click();
	await expect(page.getByText(/^Published/)).toBeVisible();
}

/** The Author's new Book, published; returns its ID. */
async function publishedBook(page: Page): Promise<string> {
	await switchPersona(page, 'Author');
	await page.goto('/studio');
	await page.getByRole('button', { name: 'Upload a book' }).first().click();
	await upload(page, STATUS_WINDOW, 'status-window.epub');
	await publish(page);
	return page.url().split('/').pop()!;
}

/** As the Reader: adds the free Book to the library and opens it. */
async function readAsReader(page: Page, bookId: string) {
	await switchPersona(page, 'Reader');
	await page.goto(`/book/${SLUG}`);
	await page.getByRole('button', { name: 'Add to library' }).click();
	await dialog(page).getByRole('button', { name: 'Add to library' }).click();
	await dialog(page).getByRole('link', { name: 'Read now' }).click();
	await expect(page).toHaveURL(new RegExp(`/read/${bookId}$`));
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
}

async function chapter(page: Page, title: RegExp) {
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await page.getByRole('button', { name: title }).click();
	await settled(page);
}

test('upload a book, read the report, preview it, answer the AI question and publish', async ({
	page
}) => {
	await switchPersona(page, 'Author');
	await page.goto('/studio');
	await page.getByRole('button', { name: 'Upload a book' }).first().click();
	await upload(page, STATUS_WINDOW, 'status-window.epub');
	await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
	const revision = page.getByTestId('revision').first();
	await expect(revision).toContainText('2 chapters, 430 words, 2 pictures');
	await revision.getByText(/things to check/).click();
	await expect(revision.getByRole('link', { name: '2. Edge Cases' }).first()).toBeVisible();

	await revision.getByRole('link', { name: 'Preview' }).click();
	await expect(page.getByTestId('preview-bar')).toContainText('only you can see this version');
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await page.getByTestId('preview-bar').getByRole('link', { name: 'Done' }).click();

	// Publishing waits for the AI answer (P1-STU-02).
	await page.getByRole('button', { name: 'Publish…' }).click();
	await expect(dialog(page).getByRole('button', { name: 'Publish version' })).toBeDisabled();
	await dialog(page).getByRole('radio', { name: 'AI-assisted' }).click();
	await dialog(page).getByRole('button', { name: 'Publish version' }).click();
	await expect(page.getByText('Published. It’s in the store now.')).toBeVisible();

	await page.goto('/store');
	await page.getByLabel('Search books and authors').fill('status window');
	await expect(page.getByRole('link', { name: new RegExp(TITLE) })).toBeVisible();
	await page.goto(`/book/${SLUG}`);
	await expect(page.getByText('AI-assisted').first()).toBeVisible();
});

test('a new version with an edited paragraph keeps the Reader’s highlight (P1-STU-01)', async ({
	page
}) => {
	test.slow();
	const bookId = await publishedBook(page);

	await readAsReader(page, bookId);
	await chapter(page, /Edge Cases/);
	const before = await visibleWords(page);
	for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
	await expect(page.getByRole('toolbar', { name: 'Selection' })).toBeVisible();
	await page.keyboard.press('h');
	await expect
		.poll(async () => (await storedRecords(page, 'user-reader', 'annotations')).length)
		.toBe(1);
	const [highlight] = await storedRecords<{
		anchor: { revisionId: string; startWordId: number; startOrdinal: number };
	}>(page, 'user-reader', 'annotations');
	expect(highlight!.anchor.startOrdinal).toBe(before.first);

	await switchPersona(page, 'Author');
	await page.goto(`/studio/books/${bookId}`);
	await page.getByRole('button', { name: 'Upload a new version' }).click();
	await dialog(page)
		.locator('input[type=file]')
		.setInputFiles({
			name: 'status-window-edited.epub',
			mimeType: 'application/epub+zip',
			buffer: Buffer.from(editedStatusWindow(new Uint8Array(STATUS_WINDOW)))
		});
	await dialog(page).getByRole('button', { name: 'Upload' }).click();
	const latest = page.getByTestId('revision').first();
	await expect(latest).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
	await expect(latest).toContainText('1 chapter changed.');
	await publish(page);

	await switchPersona(page, 'Reader');
	await page.goto(`/read/${bookId}`);
	await expect(
		page.getByText(/This book has a new version\. Your 1 note or bookmark moved/)
	).toBeVisible({
		timeout: 30_000
	});
	const [moved] = await storedRecords<{
		anchorStatus: string;
		anchor: { revisionId: string; startWordId: number };
	}>(page, 'user-reader', 'annotations');
	expect(moved).toMatchObject({
		anchorStatus: 'migrated',
		anchor: { startWordId: highlight!.anchor.startWordId }
	});
	expect(moved!.anchor.revisionId).not.toBe(highlight!.anchor.revisionId);
});

test('attach three pictures in Creator mode and publish the pack; the Reader sees them', async ({
	page
}) => {
	test.slow();
	const bookId = await publishedBook(page);
	await page.getByRole('tab', { name: 'Illustrations' }).click();
	await page.getByRole('button', { name: 'New illustration pack' }).click();
	await dialog(page).getByLabel('Name').fill('Mara’s sketches');
	await dialog(page).getByRole('radio', { name: 'No' }).click();
	await dialog(page).getByRole('button', { name: 'Create' }).click();
	await expect(page.getByTestId('creator-bar')).toContainText('Creator mode · Mara’s sketches');
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});

	for (const [n, alt] of ['A sigil', 'A map', 'A lantern'].entries()) {
		if (n > 0) {
			await page.keyboard.press('ArrowRight');
			await settled(page);
		}
		for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
		const toolbar = page.getByRole('toolbar', { name: 'Selection' });
		await toolbar.getByRole('button', { name: 'Attach picture' }).click();
		await dialog(page).locator('input[type=file]').setInputFiles(PICTURE);
		await expect(dialog(page).locator('img.preview')).toBeVisible();
		if (n === 0) await expectNoViolations(page);
		if (n < 2) await dialog(page).getByLabel('Alt text').fill(alt);
		await dialog(page).getByRole('button', { name: 'Attach' }).click();
		await expect(page.getByText('Picture attached.').last()).toBeVisible();
	}
	await expect(page.getByTestId('creator-bar')).toContainText('3 pictures · 1 need alt text');

	// No alt text, no publishing (P1-LAY-05).
	await page.getByRole('button', { name: 'Publish pack' }).click();
	await expect(page.getByText(/1 picture needs alt text/)).toBeVisible();
	await page.getByTestId('creator-bar').getByRole('button', { name: 'Pictures' }).click();
	const pictures = page.getByTestId('pack-pictures');
	await expect(pictures.getByRole('listitem')).toHaveCount(3);
	await pictures.getByRole('button', { name: 'Edit picture' }).last().click();
	await page.getByRole('dialog', { name: 'Edit picture' }).getByLabel('Alt text').fill('A lantern');
	await page
		.getByRole('dialog', { name: 'Edit picture' })
		.getByRole('button', { name: 'Save' })
		.click();
	await expect(page.getByTestId('creator-bar')).toContainText('3 pictures');
	await page.getByRole('button', { name: 'Publish pack' }).click();
	await expect(page.getByTestId('creator-bar').getByText('Published')).toBeVisible();

	// The Reader gets the free pack and sees its pictures.
	await readAsReader(page, bookId);
	await page.goto(`/book/${SLUG}`);
	await page.getByTestId('book-layers').getByRole('button', { name: /Get/ }).click();
	await dialog(page).getByRole('button', { name: 'Add to library' }).click();
	await expect(dialog(page)).toContainText('is in your library');
	await page.goto(`/read/${bookId}`);
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await expect(page.getByRole('button', { name: /Show the (new )?picture/ })).toBeEnabled();
});

test('import a Sync Map for a chapter and step through its review screen (P1-STU-03)', async ({
	page
}) => {
	test.slow();
	const bookId = await publishedBook(page);
	await page.getByRole('tab', { name: 'Narration' }).click();
	await page.getByRole('button', { name: 'New narration' }).click();
	await dialog(page).getByLabel('Narrator').fill('Wren Ashdown');
	await dialog(page).getByRole('radio', { name: 'No' }).click();
	await dialog(page).getByRole('button', { name: 'Create' }).click();
	await expect(page).toHaveURL(/\/studio\/tracks\//);
	const trackUrl = page.url();

	// The dev panel makes a test kit: silent audio and a Sync Map with guessed stretches.
	await page.goto('/dev');
	await page.getByLabel('Book', { exact: true }).selectOption(bookId);
	const [first, second] = await Promise.all([
		page.waitForEvent('download'),
		page.waitForEvent('download', { predicate: (d) => d.suggestedFilename().endsWith('.json') }),
		page.getByRole('button', { name: 'Download a narration test kit' }).click()
	]);
	const audio = await first.path();
	const syncMap = await second.path();

	await page.goto(trackUrl);
	const row = page.getByTestId('track-chapter').first();
	await expect(row).toHaveAttribute('data-status', 'missing');
	await row.getByRole('button', { name: 'Add narration' }).click();
	await dialog(page)
		.getByLabel(/Audio/)
		.setInputFiles({
			name: 'chapter-1.wav',
			mimeType: 'audio/wav',
			buffer: readFileSync(audio)
		});
	await dialog(page)
		.getByLabel(/Sync Map/)
		.setInputFiles({
			name: 'chapter-1.sync.json',
			mimeType: 'application/json',
			buffer: readFileSync(syncMap)
		});
	await dialog(page).getByRole('button', { name: 'Add narration' }).click();
	await expect(row).toHaveAttribute('data-status', 'needs_review');

	await row.getByRole('link', { name: 'Review' }).click();
	const regions = page.getByTestId('review-region');
	await expect(regions.first()).toBeVisible();
	const count = await regions.count();
	expect(count).toBeGreaterThan(1);
	await expectNoViolations(page);
	await regions.first().getByRole('button', { name: /^Play/ }).click();
	for (let i = 0; i < count; i++) {
		await regions.nth(i).getByRole('checkbox', { name: 'Sounds right' }).click();
		await expect(regions.nth(i)).toHaveAttribute('data-reviewed', 'true');
	}
	await expect(page.getByText('Reviewed', { exact: true })).toBeVisible();
});

test('a new subscription plan shows on the Creator’s profile (P1-STU-04)', async ({ page }) => {
	await switchPersona(page, 'Author');
	await page.goto('/studio/plans');
	await page.getByRole('button', { name: 'New plan' }).first().click();
	await dialog(page).getByLabel('Name').fill('Ledger Readers');
	await dialog(page).getByLabel('What subscribers get').fill('Thank you, and early chapters.');
	await dialog(page)
		.getByLabel(/Price a month/)
		.fill('2.50');
	await dialog(page)
		.getByRole('checkbox', { name: /The Lamplighter/ })
		.click();
	await dialog(page).getByRole('button', { name: 'Create plan' }).click();
	await expect(page.getByTestId('studio-plan').filter({ hasText: 'Ledger Readers' })).toContainText(
		'£2.50 a month'
	);

	await page.goto('/studio/earnings');
	await expect(page.getByText('Simulated: every figure here is made up')).toBeVisible();

	await switchPersona(page, 'Reader');
	await page.goto('/creator/wren-ashdown');
	await expect(page.getByText('Ledger Readers')).toBeVisible();
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 360, height: 740 } });

	test('every Studio screen fits the width', async ({ page }) => {
		const fits = async () =>
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth - document.documentElement.clientWidth
				)
			).toBeLessThanOrEqual(0);
		const bookId = await publishedBook(page);
		for (const tab of ['Versions', 'Details', 'Illustrations', 'Narration']) {
			await page.getByRole('tab', { name: tab }).click();
			await fits();
		}
		for (const path of ['/studio', '/studio/plans', '/studio/earnings']) {
			await page.goto(path);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			await fits();
		}
		await page.goto(`/studio/books/${bookId}`);
		await page.getByRole('tab', { name: 'Narration' }).click();
		await page.getByRole('button', { name: 'New narration' }).click();
		await dialog(page).getByRole('button', { name: 'Create' }).click();
		await expect(page.getByTestId('track-chapter').first()).toBeVisible();
		await fits();
	});
});
