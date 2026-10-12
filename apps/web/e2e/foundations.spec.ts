import type { Page } from '@playwright/test';
import {
	expect,
	expectSaved,
	expectStoredFontScale,
	openDevPanel,
	openPreferences,
	openReader,
	switchPersona,
	test
} from './fixtures';

/** Opens Alice's reading preferences on the Text tab and returns the text-size slider. */
async function textSize(page: Page) {
	await openReader(page, 'book-alice');
	await openPreferences(page, 'Text');
	return page.getByRole('slider', { name: 'Text size' });
}

async function makeTextBigger(page: Page) {
	const slider = await textSize(page);
	await slider.focus();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect(slider).toHaveAttribute('aria-valuetext', '110%');
}

// Phase 0.1 Try-it list and P0-09 acceptance (IMPLEMENTATION-PLAN.md §6, DESIGN.md §13.1).

test('switching Persona reloads the app as that user, with their own Stores data', async ({
	page
}) => {
	await page.goto('/you');
	await expect(page.getByTestId('signed-in-as')).toHaveText('Signed in as Robin Reader.');

	// The Reader makes their text bigger…
	await makeTextBigger(page);
	await expectStoredFontScale(page, 'user-reader', 1.1);

	// …which the Author doesn't see,
	await switchPersona(page, 'Author');
	await page.goto('/you');
	await expect(page.getByTestId('signed-in-as')).toHaveText('Signed in as Wren Ashdown.');
	await page.goto('/library');
	await expect(page.getByRole('link', { name: /The Lamplighter's Ledger/ })).toBeVisible();
	await expect(await textSize(page)).toHaveAttribute('aria-valuetext', '100%');

	// …and the Reader gets back when they return.
	await switchPersona(page, 'Reader');
	await expect(await textSize(page)).toHaveAttribute('aria-valuetext', '110%');
});

test('the Library copes with failures and offline, and recovers', async ({ page }) => {
	const failureRate = page.getByRole('slider', { name: /Failure rate/ });
	const offline = page.getByRole('checkbox', { name: 'Offline' });

	await openDevPanel(page);
	await failureRate.fill('100');
	await expectSaved(page);
	await page.goto('/');
	await expect(page.getByRole('alert')).toContainText('Your library didn’t load');

	await openDevPanel(page);
	await failureRate.fill('0');
	await expectSaved(page);
	await openDevPanel(page);
	await offline.check();
	await expectSaved(page);
	await page.goto('/');
	await expect(page.getByRole('alert')).toContainText('You’re offline');

	await openDevPanel(page);
	await offline.uncheck();
	await expectSaved(page);
	await page.goto('/');
	await expect(page.getByRole('link', { name: "Alice's Adventures in Wonderland" })).toBeVisible();
});

test('the simulated clock moves forward and back', async ({ page }) => {
	await openDevPanel(page);
	const now = page.getByTestId('simulated-now');
	const before = await now.textContent();
	await page.getByRole('button', { name: '+30 days' }).click();
	await expect(page.getByText('(30 days ahead)')).toBeVisible();
	await expect(now).not.toHaveText(before ?? '');
	await page.getByRole('button', { name: 'Back to real time' }).click();
	await expect(now).toHaveText(before ?? '');
});

test('wiping device data clears every Persona’s data', async ({ page }) => {
	await makeTextBigger(page);
	await expectStoredFontScale(page, 'user-reader', 1.1);

	await openDevPanel(page);
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Wipe device data' }).click();
	await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();

	await expect(await textSize(page)).toHaveAttribute('aria-valuetext', '100%');
});
