import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// What jsdom can't check for @book/ui (P1-UI-02): focus trapping, floating menus and tooltips,
// in real Chromium and WebKit, on the dev panel's component gallery.

async function openGallery(page: Page) {
	await page.goto('/dev/components');
	await expect(page.getByRole('heading', { name: 'Component gallery' })).toBeVisible();
}

const lastAction = (page: Page) => page.getByTestId('last-action');

test('a dialog traps focus, closes on Esc and gives focus back to its opener', async ({ page }) => {
	await openGallery(page);
	// Opened from the keyboard: Safari doesn't focus buttons on click, so only keyboard users have a
	// focused opener to come back to.
	const opener = page.getByRole('button', { name: 'Open dialog' });
	await opener.focus();
	await page.keyboard.press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Delete this note?' });
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAccessibleDescription('This can’t be undone.');
	for (let i = 0; i < 4; i++) {
		await page.keyboard.press('Tab');
		expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
	}
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(opener).toBeFocused();
	await expect(lastAction(page)).toHaveText('Dialog closed');
});

for (const [name, opener] of [
	['bottom sheet', 'Open bottom sheet'],
	['side sheet', 'Open side sheet']
] as const) {
	test(`a ${name} keeps Tab inside and closes with its close button`, async ({ page }) => {
		await openGallery(page);
		await page.getByRole('button', { name: opener }).focus();
		await page.keyboard.press('Enter');
		const sheet = page.getByRole('dialog');
		await expect(sheet).toBeVisible();
		for (let i = 0; i < 5; i++) {
			await page.keyboard.press('Tab');
			expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
		}
		await sheet.getByRole('button', { name: 'Close' }).click();
		await expect(sheet).toBeHidden();
		await expect(page.getByRole('button', { name: opener })).toBeFocused();
	});
}

test('the adaptive sheet is a bottom sheet on a phone and a side sheet on a desktop', async ({
	page
}) => {
	await page.setViewportSize({ width: 360, height: 780 });
	await openGallery(page);
	await page.getByRole('button', { name: 'Open adaptive sheet' }).click();
	let box = await page.getByRole('dialog', { name: 'Reading preferences' }).boundingBox();
	expect(box!.y + box!.height).toBeGreaterThan(770);
	expect(box!.width).toBeGreaterThan(350);
	await page.keyboard.press('Escape');

	await page.setViewportSize({ width: 1280, height: 800 });
	await page.getByRole('button', { name: 'Open adaptive sheet' }).click();
	box = await page.getByRole('dialog', { name: 'Reading preferences' }).boundingBox();
	expect(box!.x + box!.width).toBeGreaterThan(1270);
	expect(box!.width).toBeLessThan(450);
});

test('a menu works from the keyboard and returns focus to its button', async ({ page }) => {
	await openGallery(page);
	const trigger = page.getByRole('button', { name: 'More actions' });
	await trigger.focus();
	await page.keyboard.press('Enter');
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: 'Copy' })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(menu.getByRole('menuitem', { name: 'Add note' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(menu).toBeHidden();
	await expect(lastAction(page)).toHaveText('Add note');
	await expect(trigger).toBeFocused();
});

test('a tooltip shows on keyboard focus and describes its button', async ({ page }) => {
	await openGallery(page);
	const button = page.getByRole('button', { name: 'Contents with tooltip' });
	await button.focus();
	await expect(page.getByRole('tooltip')).toHaveText('Table of contents');
	await expect(button).toHaveAccessibleDescription('Table of contents');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('tooltip')).toBeHidden();
});

test('a snackbar confirms, offers its action, and errors are announced as alerts', async ({
	page
}) => {
	await openGallery(page);
	await page.getByRole('button', { name: 'Show snackbar' }).click();
	await expect(page.getByText('Added to library')).toBeVisible();
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(lastAction(page)).toHaveText('Undo');
	await expect(page.getByText('Added to library')).toBeHidden();

	await page.getByRole('button', { name: 'Show error snackbar' }).click();
	await expect(
		page.locator('[aria-live="assertive"]', { hasText: 'You’re offline.' })
	).toBeVisible();
});

test('reduced motion turns every component animation off', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await openGallery(page);
	await page.getByRole('button', { name: 'Open bottom sheet' }).click();
	const durations = await page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('*')].flatMap((el) => {
			const s = getComputedStyle(el);
			return [s.animationDuration, s.transitionDuration]
				.flatMap((d) => d.split(','))
				.map((d) => parseFloat(d))
				.filter((d) => d > 0)
				.map(() => el.className.toString());
		})
	);
	expect(durations).toEqual([]);
});
