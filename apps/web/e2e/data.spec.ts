import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, openReader, settled, showChrome, storedRecords, test } from './fixtures';

// P1-APP-04 acceptance (DESIGN.md §13): You → Data says where data lives and whether persistent
// storage was granted; the JSON export has every Stores record; notes export as Markdown; delete
// clears the device.

test.use({ viewport: { width: 1280, height: 800 } });

/** A highlight and a bookmark in Alice's Chapter I, by keyboard. */
async function makeNotes(page: Page) {
	await openReader(page, 'book-alice');
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await page.getByRole('button', { name: /Down the Rabbit-Hole/ }).click();
	await settled(page);
	for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
	await expect(page.getByRole('toolbar', { name: 'Selection' })).toBeVisible();
	await page.keyboard.press('h');
	await page.keyboard.press('b');
	await expect
		.poll(async () => (await storedRecords(page, 'user-reader', 'placedBookmarks')).length)
		.toBe(1);
	await expect
		.poll(async () => (await storedRecords(page, 'user-reader', 'annotations')).length)
		.toBe(1);
	// Reading Progress is saved 2 s after the last move (§9.5); wait for it before leaving.
	await expect
		.poll(async () => (await storedRecords(page, 'user-reader', 'progress')).length, {
			timeout: 10_000
		})
		.toBe(1);
}

test('You → Data says where data lives and whether it is protected', async ({ page }) => {
	await page.goto('/you');
	await page.getByRole('link', { name: /Your data/ }).click();
	await expect(page.getByRole('heading', { name: 'Your data', level: 1 })).toBeVisible();
	await expect(page.getByText('Everything you read and note stays on this device')).toBeVisible();
	await expect(page.getByTestId('storage-status')).toContainText(
		/Kept on this device|Not protected yet|doesn’t say/
	);
});

test('exports every record as JSON and every note as Markdown', async ({ page }) => {
	await makeNotes(page);
	await page.goto('/you/data');

	const json = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export all data (JSON)' }).click();
	const data = JSON.parse(readFileSync(await (await json).path(), 'utf8'));
	expect(data).toMatchObject({ format: 'book-reader-data', version: 1 });
	const stored = await storedRecords<{ id: string }>(page, 'user-reader', 'annotations');
	expect(data.annotations.map((a: { id: string }) => a.id)).toEqual(stored.map((a) => a.id));
	expect(data.placedBookmarks).toHaveLength(1);
	expect(data.progress.map((p: { bookId: string }) => p.bookId)).toContain('book-alice');

	const md = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export all notes (Markdown)' }).click();
	const markdown = readFileSync(await (await md).path(), 'utf8');
	expect(markdown).toMatch(/^# Alice's Adventures in Wonderland\n/);
	expect(markdown).toMatch(/\n## .*Down the Rabbit-Hole\n\n> /);
	expect(markdown).toContain('## Bookmarks');
});

test('deleting device data asks first, then clears everything', async ({ page }) => {
	await makeNotes(page);
	await page.goto('/you/data');
	await page.getByRole('button', { name: 'Delete my data on this device' }).click();
	const dialog = page.getByRole('dialog', { name: 'Delete your data on this device?' });
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	expect(await storedRecords(page, 'user-reader', 'annotations')).toHaveLength(1);

	await page.getByRole('button', { name: 'Delete my data on this device' }).click();
	await dialog.getByRole('button', { name: 'Delete' }).click();
	await expect(page).toHaveURL(/\/library$/);
	expect(await storedRecords(page, 'user-reader', 'annotations')).toHaveLength(0);
	expect(await storedRecords(page, 'user-reader', 'placedBookmarks')).toHaveLength(0);
	// Catalogue Books are Entitlements on the backend, not device data: Alice is still there.
	await expect(
		page.getByRole('link', { name: /Alice's Adventures in Wonderland/ }).first()
	).toBeVisible();
});
