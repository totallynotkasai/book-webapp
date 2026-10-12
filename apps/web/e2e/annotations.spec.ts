import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
	expect,
	openPreferences,
	openReader,
	settled,
	showChrome,
	storedRecords,
	test,
	visibleWords
} from './fixtures';

// Phase 1.3 Try-it list (IMPLEMENTATION-PLAN.md §6) and acceptance for P1-RDR-06 and P1-RDR-07:
// highlight in each colour, add, edit and delete notes, copy, remove; mouse, right-click and
// keyboard; filter, jump and export; Placed Bookmarks that survive a font change.

test.use({ viewport: { width: 1280, height: 800 } });

interface StoredAnnotation {
	id: string;
	colour: number;
	note?: string;
	anchor: { startOrdinal: number; endOrdinal: number; quote: { exact: string } };
}

/** Opens Alice at Chapter I, where the text is plain paragraphs. */
async function chapterOne(page: Page) {
	await openReader(page, 'book-alice');
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await page.getByRole('button', { name: /Down the Rabbit-Hole/ }).click();
	await settled(page);
	await page.keyboard.press('ArrowRight');
	await settled(page);
}

function bookFrame(page: Page) {
	return page.frames().find((f) => f.url().startsWith('blob:'))!;
}

/**
 * Drags from the middle of one word to the middle of a later one, in the first paragraph on
 * screen with enough words, so the selection has to snap to whole Words.
 */
async function dragAcrossWords(page: Page, fromWord: number, toWord: number) {
	const points = await bookFrame(page).evaluate(
		([from, to]) => {
			const frame = window.frameElement!.getBoundingClientRect();
			for (const p of document.querySelectorAll('p')) {
				const node = [...p.childNodes].find(
					(n) => n.nodeType === 3 && (n.textContent ?? '').split(/\s+/).length > to! + 2
				) as Text | undefined;
				if (!node) continue;
				const words = [...node.data.matchAll(/\S+/g)];
				const at = (w: RegExpMatchArray) => {
					const range = document.createRange();
					const middle = w.index! + Math.max(1, Math.floor(w[0].length / 2));
					range.setStart(node, middle);
					range.setEnd(node, middle + 1);
					const r = range.getBoundingClientRect();
					return { x: frame.left + r.left + r.width / 2, y: frame.top + r.top + r.height / 2 };
				};
				const a = at(words[from!]!);
				const b = at(words[to!]!);
				if (a.x < 0 || b.x > innerWidth * 4 || a.x > window.top!.innerWidth) continue;
				return {
					a,
					b,
					first: words[from!]![0],
					last: words[to!]![0]
				};
			}
			throw new Error('No paragraph on screen with enough words');
		},
		[fromWord, toWord]
	);
	await page.mouse.move(points.a.x, points.a.y);
	await page.mouse.down();
	await page.mouse.move(points.b.x, points.b.y, { steps: 6 });
	await page.mouse.up();
	return points;
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Selection' });

test('a mouse selection snaps to whole Words and highlights in each colour', async ({ page }) => {
	await chapterOne(page);
	const colours = ['yellow', 'green', 'blue', 'pink', 'purple'];
	for (const [i, colour] of colours.entries()) {
		const { first, last } = await dragAcrossWords(page, i * 4 + 1, i * 4 + 3);
		await expect(toolbar(page)).toBeVisible();
		await toolbar(page)
			.getByRole('button', { name: `Highlight ${colour}` })
			.click();
		await expect(toolbar(page)).toBeHidden();
		await expect
			.poll(async () => (await storedRecords(page, 'user-reader', 'annotations')).length)
			.toBe(i + 1);
		const stored = await storedRecords<StoredAnnotation>(page, 'user-reader', 'annotations');
		const exact = stored.find((a) => a.colour === i + 1)!.anchor.quote.exact;
		// Started and ended mid-word, but the Anchor holds whole Words (Invariant 5).
		const clean = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
		expect(exact.startsWith(clean(first))).toBe(true);
		expect(exact.endsWith(clean(last)) || exact.includes(clean(last))).toBe(true);
	}
	// Each colour is painted through the CSS Custom Highlight API.
	const painted = await bookFrame(page).evaluate(() =>
		[1, 2, 3, 4, 5].map((n) => CSS.highlights.get(`rd-highlight-${n}`)?.size ?? 0)
	);
	expect(painted).toEqual([1, 1, 1, 1, 1]);
});

test('notes: add from the toolbar, list by chapter, edit, filter, jump and delete with undo', async ({
	page
}) => {
	await chapterOne(page);
	await dragAcrossWords(page, 1, 4);
	await toolbar(page).getByRole('button', { name: 'Add note' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add note' });
	await dialog.getByRole('textbox', { name: 'Note' }).fill('Falling for a very long time');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect
		.poll(
			async () =>
				(await storedRecords<StoredAnnotation>(page, 'user-reader', 'annotations'))[0]?.note
		)
		.toBe('Falling for a very long time');

	await dragAcrossWords(page, 8, 9);
	await toolbar(page).getByRole('button', { name: 'Highlight blue' }).click();

	await page.keyboard.press('n');
	const sheet = page.getByRole('dialog', { name: 'Contents and notes' });
	await expect(sheet.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
	await expect(sheet.getByRole('heading', { name: /Down the Rabbit-Hole/ })).toBeVisible();
	await expect(sheet.getByText('Falling for a very long time')).toBeVisible();

	// Filter by colour.
	await sheet.getByRole('button', { name: 'Blue', exact: true }).click();
	await expect(sheet.getByText('Falling for a very long time')).toBeHidden();
	await sheet.getByRole('button', { name: 'All', exact: true }).click();

	// Edit the note.
	await sheet.getByRole('button', { name: 'Edit note' }).first().click();
	const edit = page.getByRole('dialog', { name: 'Edit note' });
	await edit.getByRole('textbox', { name: 'Note' }).fill('Down, down, down');
	await edit.getByRole('button', { name: 'Save' }).click();
	await expect(sheet.getByText('Down, down, down')).toBeVisible();

	// Delete, then undo.
	await sheet.getByRole('button', { name: 'Delete highlight' }).first().click();
	await expect(sheet.getByText('Down, down, down')).toBeHidden();
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(sheet.getByText('Down, down, down')).toBeVisible();

	// Jump: from another chapter, the note brings the reader back to its text.
	await sheet.getByRole('tab', { name: 'Contents' }).click();
	await sheet.getByRole('button', { name: /The Pool of Tears/ }).click();
	await settled(page);
	await page.keyboard.press('n');
	await sheet.getByRole('button', { name: /Down, down, down/ }).click();
	await settled(page);
	const notes = await storedRecords<StoredAnnotation>(page, 'user-reader', 'annotations');
	const target = notes.find((a) => a.note === 'Down, down, down')!;
	const on = await visibleWords(page);
	expect(on.first).toBeLessThanOrEqual(target.anchor.startOrdinal);
	expect(on.last).toBeGreaterThanOrEqual(target.anchor.startOrdinal);
});

test('tapping a highlight opens it; right-click opens the same actions; remove deletes it', async ({
	page
}) => {
	await chapterOne(page);
	const { b } = await dragAcrossWords(page, 2, 5);
	await toolbar(page).getByRole('button', { name: 'Highlight green' }).click();
	await expect(toolbar(page)).toBeHidden();

	// A click on the highlight brings up its toolbar, with its colour marked.
	await page.mouse.click(b.x, b.y);
	const highlight = page.getByRole('toolbar', { name: 'Highlight' });
	await expect(highlight).toBeVisible();
	await expect(highlight.getByRole('button', { name: 'Green' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await highlight.getByRole('button', { name: 'Pink' }).click();
	await expect
		.poll(
			async () =>
				(await storedRecords<StoredAnnotation>(page, 'user-reader', 'annotations'))[0]?.colour
		)
		.toBe(4);

	// Right-click on it: our actions instead of the browser's menu.
	await page.mouse.click(b.x, b.y, { button: 'right' });
	await expect(highlight).toBeVisible();
	await highlight.getByRole('button', { name: 'Remove highlight' }).click();
	await expect
		.poll(async () => (await storedRecords(page, 'user-reader', 'annotations')).length)
		.toBe(0);
	await expect(page.getByText('Highlight deleted')).toBeVisible();
});

test('keyboard: Shift+arrows select Words, Tab reaches the toolbar, arrows and Enter use it', async ({
	page
}) => {
	await chapterOne(page);
	const start = await visibleWords(page);
	for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
	await expect(toolbar(page)).toBeVisible();
	await expect(page.getByTestId('announcer')).toContainText('Selected:');
	await page.keyboard.press('Tab');
	await expect(toolbar(page).getByRole('button', { name: 'Highlight yellow' })).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(toolbar(page).getByRole('button', { name: 'Highlight green' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect
		.poll(
			async () => (await storedRecords<StoredAnnotation>(page, 'user-reader', 'annotations'))[0]
		)
		.toMatchObject({
			colour: 2,
			anchor: { startOrdinal: start.first, endOrdinal: start.first + 2 }
		});

	// H highlights a keyboard selection in the last colour used.
	await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('Shift+ArrowRight');
	await expect(toolbar(page)).toBeVisible();
	await page.keyboard.press('h');
	await expect
		.poll(async () => (await storedRecords(page, 'user-reader', 'annotations')).length)
		.toBe(2);
});

test('copy puts whole Words on the clipboard', async ({ page, context, browserName }) => {
	test.skip(browserName !== 'chromium', 'Clipboard permissions are a Chromium feature');
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await chapterOne(page);
	const { first, last } = await dragAcrossWords(page, 1, 3);
	await toolbar(page).getByRole('button', { name: 'Copy' }).click();
	await expect(page.getByText('Copied')).toBeVisible();
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	expect(copied.split(' ')).toHaveLength(3);
	expect(copied).toContain(first.replace(/[^\p{L}]/gu, ''));
	expect(copied).toContain(last.replace(/[^\p{L}]/gu, '').slice(0, 2));
});

test('notes export as Markdown with chapter headings', async ({ page }) => {
	await chapterOne(page);
	await dragAcrossWords(page, 1, 3);
	await toolbar(page).getByRole('button', { name: 'Highlight yellow' }).click();
	await page.keyboard.press('n');
	const sheet = page.getByRole('dialog', { name: 'Contents and notes' });
	await sheet.getByRole('button', { name: 'Export notes' }).click();
	const download = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: 'Markdown (.md)' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/^Alices Adventures in Wonderland - notes\.md$/);
	const markdown = readFileSync(await file.path(), 'utf8');
	expect(markdown).toMatch(/^# Alice's Adventures in Wonderland\n/);
	expect(markdown).toMatch(/\n## .*Down the Rabbit-Hole\n\n> \S+/);
	expect(markdown).toContain('*Yellow highlight*');
});

test('Placed Bookmarks: B and the button, a ribbon, a label, and they survive a font change', async ({
	page
}) => {
	await chapterOne(page);
	const places: number[] = [];
	for (let i = 0; i < 3; i++) {
		places.push((await visibleWords(page)).first);
		await page.keyboard.press('b');
		await expect(page.getByTestId('bookmark-ribbon')).toBeVisible();
		await page.keyboard.press('ArrowRight');
		await settled(page);
		await expect(page.getByTestId('bookmark-ribbon')).toBeHidden();
	}
	await showChrome(page);
	await page.getByRole('button', { name: 'Bookmark this page' }).click();
	await expect(page.getByRole('button', { name: 'Bookmark this page' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: 'Add label' }).click();
	const dialog = page.getByRole('dialog', { name: 'Bookmark label' });
	await dialog.getByRole('textbox', { name: 'Label' }).fill('Fourth');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect
		.poll(async () => (await storedRecords(page, 'user-reader', 'placedBookmarks')).length)
		.toBe(4);

	// Bigger text: each bookmark still opens on the Word it was placed on.
	await openPreferences(page, 'Text');
	const size = page.getByRole('slider', { name: 'Text size' });
	await size.focus();
	for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Escape');
	await settled(page);
	for (const [i, ordinal] of places.entries()) {
		await showChrome(page);
		await page.getByRole('button', { name: 'Contents and notes' }).click();
		const sheet = page.getByRole('dialog', { name: 'Contents and notes' });
		await sheet.getByRole('tab', { name: 'Bookmarks' }).click();
		await sheet.getByRole('listitem').nth(i).getByRole('button').first().click();
		await settled(page);
		const on = await visibleWords(page);
		expect(on.first).toBeLessThanOrEqual(ordinal);
		expect(on.last).toBeGreaterThanOrEqual(ordinal);
		await expect(page.getByTestId('bookmark-ribbon')).toBeVisible();
	}
});

test('highlights and bookmarks are still there after a reload', async ({ page }) => {
	await chapterOne(page);
	await dragAcrossWords(page, 1, 3);
	await toolbar(page).getByRole('button', { name: 'Highlight purple' }).click();
	await page.keyboard.press('b');
	await expect
		.poll(async () => (await storedRecords(page, 'user-reader', 'placedBookmarks')).length)
		.toBe(1);
	await page.reload();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	// The bookmark is listed and opens its page, where the highlight is painted again.
	await page.keyboard.press('n');
	const sheet = page.getByRole('dialog', { name: 'Contents and notes' });
	await sheet.getByRole('tab', { name: 'Bookmarks' }).click();
	await sheet.getByRole('listitem').first().getByRole('button').first().click();
	await settled(page);
	await expect(page.getByTestId('bookmark-ribbon')).toBeVisible();
	await expect
		.poll(() => bookFrame(page).evaluate(() => CSS.highlights.get('rd-highlight-5')?.size ?? 0))
		.toBe(1);
});
