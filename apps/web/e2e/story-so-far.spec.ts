import type { Page } from '@playwright/test';
import {
	E2E_NOW,
	expect,
	expectNoViolations,
	selectPhrase,
	settled,
	showChrome,
	storedPreferences,
	storedRecords,
	switchPersona,
	test,
	visibleWords
} from './fixtures';

// Phase 1.14 Try-it list (IMPLEMENTATION-PLAN.md §6) and acceptance for P1-STU-05 and P1-RDR-13:
// the Author writes a recap and a glossary entry and publishes; the Reader at Chapter 3 sees the
// recaps of 1–2 and only the names met so far (Invariant 6); "In the glossary" in the selection
// toolbar; still there offline once the Book is open; the empty and AI-hidden states; and the
// catch-up offer after a week away.

test.use({ viewport: { width: 1280, height: 800 } });

const LEDGER = 'book-lamplighters-ledger';
const dialog = (page: Page) => page.getByRole('dialog');

/** As the Reader: buys the Ledger (simulated) and opens it at its first chapter. */
async function buyLedger(page: Page) {
	await page.goto('/book/the-lamplighters-ledger');
	await page.getByRole('button', { name: 'Buy · £3.99' }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: /^Pay .* \(simulated\)$/ })
		.click();
	await page.getByRole('dialog').getByRole('link', { name: 'Read now' }).click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await settled(page);
}

async function chapter(page: Page, title: RegExp) {
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await page.getByRole('button', { name: title }).click();
	await settled(page);
}

/** Opens Contents on its Story so far tab. */
async function openStory(page: Page) {
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await page.getByRole('tab', { name: 'Story so far' }).click();
}

async function closeSheet(page: Page) {
	await page.keyboard.press('Escape');
	await expect(dialog(page)).toHaveCount(0);
}

const recapTitles = (page: Page) => page.getByTestId('story-recap').locator('h4').allTextContents();
const entryNames = (page: Page) => page.getByTestId('story-entry').locator('h4').allTextContents();

test('the Author writes a recap and an entry and publishes; the Reader at Chapter 3 sees 1–2 and the names met', async ({
	page
}) => {
	test.slow();
	await switchPersona(page, 'Author');
	await page.goto(`/studio/books/${LEDGER}`);
	await page.getByRole('tab', { name: 'Story so far' }).click();
	const panel = page.getByTestId('story-panel');
	await expect(panel).toContainText('Published');

	// A recap for Chapter 2.
	const recap = panel.getByRole('textbox', { name: '2. The Ledger' });
	await recap.fill('Cobb handed Tam the Ledger, and Bram came looking for Pim.');
	await expect(panel.getByRole('button', { name: 'Publish…' })).toBeDisabled();
	await panel.getByRole('button', { name: 'Save recap' }).click();
	await expect(page.getByText('Recap saved.')).toBeVisible();

	// A glossary entry, found in the text; one whose name isn't there can't be published.
	await panel.getByRole('button', { name: 'Add an entry' }).click();
	await dialog(page).getByRole('textbox', { name: 'Name' }).fill('Pim');
	await dialog(page)
		.getByRole('textbox', { name: 'Description' })
		.fill('Bram’s younger brother, who went to Saltgate.');
	await dialog(page).getByRole('button', { name: 'Add entry' }).click();
	const pim = panel.getByTestId('glossary-entry').filter({ hasText: 'Pim' });
	await expect(pim).toContainText('First appears in 2. The Ledger');

	await panel.getByRole('button', { name: 'Add an entry' }).click();
	await dialog(page).getByRole('textbox', { name: 'Name' }).fill('Zebedee Crumbhorn');
	await dialog(page).getByRole('textbox', { name: 'Description' }).fill('Nobody.');
	await dialog(page).getByRole('button', { name: 'Add entry' }).click();
	const zebedee = panel.getByTestId('glossary-entry').filter({ hasText: 'Zebedee' });
	await expect(zebedee).toContainText('Not in the book’s text');
	await expect(panel.getByRole('list', { name: 'Before publishing' })).toContainText(
		'“Zebedee Crumbhorn” isn’t in the book’s text'
	);
	await panel.getByRole('button', { name: 'Publish…' }).click();
	await dialog(page).getByRole('radio', { name: 'AI-generated' }).click();
	await dialog(page).getByRole('button', { name: 'Publish', exact: true }).click();
	await expect(dialog(page).getByRole('alert')).toContainText('Zebedee Crumbhorn');
	await dialog(page).getByRole('button', { name: 'Cancel' }).click();
	await zebedee.getByRole('button', { name: 'Remove Zebedee Crumbhorn' }).click();
	await expect(zebedee).toHaveCount(0);

	await panel.getByRole('button', { name: 'Publish…' }).click();
	// The last answer is kept; the AI question must still be answered (§10.6).
	await expect(dialog(page).getByRole('radio', { name: 'AI-generated' })).toBeChecked();
	await dialog(page).getByRole('button', { name: 'Publish', exact: true }).click();
	await expect(dialog(page)).toHaveCount(0);
	await expect(panel).toContainText('Published Oct 11, 2026');
	await expect(panel).not.toContainText('changes not published yet');
	await expect(panel.getByRole('button', { name: 'Publish…' })).toBeDisabled();

	// As the Reader, at Chapter 3.
	await switchPersona(page, 'Reader');
	await buyLedger(page);
	await chapter(page, /^3\. Murk on Saltgate Bridge/);
	await openStory(page);
	await expect.poll(() => recapTitles(page)).toEqual(['1. Dusk Shift', '2. The Ledger']);
	await expect(page.getByTestId('story-recap').nth(1)).toContainText(
		'Cobb handed Tam the Ledger, and Bram came looking for Pim.'
	);
	const names = await entryNames(page);
	expect(names).toEqual(expect.arrayContaining(['Pim', 'Mister Cobb', 'Wick', 'Hollowmere']));
	for (const later of ['Isolde Vell', 'First Lamp', 'Warden of the Murk']) {
		expect(names).not.toContain(later);
	}
	// What Mister Cobb is also called was met in Chapter 2; the First Lamp's "Lamp Zero" never.
	const entry = (name: string) =>
		page
			.getByTestId('story-entry')
			.filter({ has: page.getByRole('heading', { name, exact: true }) });
	await expect(entry('Mister Cobb')).toContainText('Also called Ezra Cobb');
	await expect(page.getByTestId('story-entry').first()).toBeVisible();
	await expectNoViolations(page);

	// "First appears" goes there, and Back returns.
	await page.getByRole('button', { name: /Go to where Pim first appears/ }).click();
	await settled(page);
	await expect(page.getByTestId('chapter-title')).toHaveText('2. The Ledger');
});

test('nothing from ahead: Chapter by Chapter, in the selection toolbar, and offline once open', async ({
	page
}) => {
	test.slow();
	await buyLedger(page);
	await openStory(page);
	// At the start of Chapter 1: no recaps yet, and only names on this page.
	await expect(
		page.getByText('A chapter’s recap appears here once you’ve read to its end.')
	).toBeVisible();
	let names = await entryNames(page);
	expect(names).toContain('Hollowmere');
	expect(names).not.toContain('Wick');
	expect(names).not.toContain('Bram Ollery');
	await closeSheet(page);

	// "In the glossary" for a name met, not for any other Word.
	await selectPhrase(page, 'Hollowmere');
	const toolbar = page.getByRole('toolbar', { name: 'Selection' });
	await toolbar.getByRole('button', { name: 'In the glossary' }).click();
	await expect(dialog(page).getByRole('heading', { name: 'Hollowmere' })).toBeVisible();
	await expect(page.getByTestId('glossary-card')).toContainText('the bells of St Ember');
	await dialog(page).getByRole('button', { name: 'Close' }).click();
	await expect(dialog(page)).toHaveCount(0);
	await selectPhrase(page, 'sensible');
	await expect(toolbar.getByRole('button', { name: 'Copy' })).toBeVisible();
	await expect(toolbar.getByRole('button', { name: 'In the glossary' })).toHaveCount(0);
	await page.keyboard.press('Escape');

	// At the start of Chapter 2, Chapter 1's recap; Chapter 2's not yet.
	await chapter(page, /^2\. The Ledger/);
	// Offline now: what's already here still works (P1-RDR-13 acceptance).
	await page.evaluate(() => {
		globalThis.__BOOK_E2E_SIMULATION__!.offline = true;
	});
	await openStory(page);
	await expect.poll(() => recapTitles(page)).toEqual(['1. Dusk Shift']);
	names = await entryNames(page);
	// All of Chapter 1's names, nothing first named after this page.
	expect(names).toEqual(expect.arrayContaining(['Hollowmere', 'Kindle', 'the Murk']));
	expect(names).not.toContain('Isolde Vell');
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a Book with no story has no tab, and AI-generated ones are hidden on request', async ({
	page
}) => {
	await page.goto('/read/book-alice');
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await expect(page.getByRole('tab', { name: 'Bookmarks' })).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Story so far' })).toHaveCount(0);
	await closeSheet(page);

	await page.goto('/you/settings');
	await page.getByRole('switch', { name: /Hide AI-generated/ }).click();
	// Written before the next page loads: a full load aborts an IndexedDB write still running.
	await expect
		.poll(() => storedPreferences(page, 'user-reader'))
		.toMatchObject({ hideAiGenerated: true });
	await buyLedger(page);
	await openStory(page);
	await expect(dialog(page)).toContainText('you’ve chosen to hide AI-generated content');
	await expect(page.getByTestId('story-entry')).toHaveCount(0);
});

test('back after a week, the reader is offered the story so far', async ({ page }) => {
	test.slow();
	await buyLedger(page);
	await chapter(page, /^3\. Murk on Saltgate Bridge/);
	// The place is saved a moment after the page settles (§9.5).
	const { first } = await visibleWords(page);
	await expect
		.poll(
			async () =>
				(
					await storedRecords<{ bookId: string; current: { ordinal: number } }>(
						page,
						'user-reader',
						'progress'
					)
				).find((p) => p.bookId === LEDGER)?.current.ordinal
		)
		.toBe(first);
	// The same day: no offer.
	await page.goto(`/read/${LEDGER}`);
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await page.waitForTimeout(500);
	await expect(page.getByText('Back after a while?')).toHaveCount(0);
	// Leaving saves the place today; a week and a day later, the Book is opened again.
	await page.goto('/library');
	await page.clock.setFixedTime(new Date(E2E_NOW.getTime() + 8 * 24 * 60 * 60 * 1000));
	await page.goto(`/read/${LEDGER}`);
	await expect(page.getByText('Back after a while? Catch up with the story so far.')).toBeVisible({
		timeout: 30_000
	});
	await page.getByRole('button', { name: 'Story so far' }).click();
	await expect(page.getByRole('tab', { name: 'Story so far' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect.poll(() => recapTitles(page)).toEqual(['1. Dusk Shift', '2. The Ledger']);
});
