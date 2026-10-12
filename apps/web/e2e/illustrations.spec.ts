import type { Page } from '@playwright/test';
import {
	expect,
	openReader,
	settled,
	showChrome,
	storedRecords,
	switchPersona,
	test,
	visibleWords
} from './fixtures';

// Phase 1.4 Try-it list (IMPLEMENTATION-PLAN.md §6) and acceptance for P1-LAY-01, P1-LAY-02 and
// P1-LAY-07: the hint, the picture and its dot, every mode keeping position, the lightbox, a
// second pack first, and nothing anchored ahead of the reader ever showing (Invariant 6).

test.use({ viewport: { width: 1280, height: 800 } });

const card = (page: Page) => page.getByTestId('illustration-card');

async function chapter(page: Page, title: RegExp) {
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await page.getByRole('button', { name: title }).click();
	await settled(page);
}

async function setMode(page: Page, mode: 'Pop-up' | 'Per page' | 'Spread' | 'In text' | 'Off') {
	await showChrome(page);
	await page.getByRole('button', { name: 'Illustrations' }).click();
	await page
		.getByRole('radiogroup', { name: 'Show pictures' })
		.getByRole('radio', { name: mode })
		.click();
	await page.keyboard.press('Escape');
	await settled(page);
}

/** The shown Illustration starts at or before the last visible Word. */
async function expectNotAhead(page: Page, start: string | null) {
	const { last } = await visibleWords(page);
	expect(Number(start), `picture starts at ${start}, page ends at ${last}`).toBeLessThanOrEqual(
		last
	);
}

test('first open: the hint, the picture, closing it, and the dot for a new one', async ({
	page
}) => {
	await openReader(page, 'book-alice');
	// Official packs are on from the start (§8.1), and nothing is saved until the reader changes it.
	expect(await storedRecords(page, 'user-reader', 'layerSelection')).toEqual([]);
	await chapter(page, /Down the Rabbit-Hole/);
	for (let i = 0; i < 2; i++) {
		await page.keyboard.press('ArrowRight');
		await settled(page);
	}
	await expect(page.getByTestId('illustration-hint')).toBeVisible();
	const button = page.getByRole('button', { name: /Show the (new )?picture/ });
	await button.click();
	await expect(card(page)).toBeVisible();
	await expect(card(page)).toContainText('John Tenniel’s illustrations');
	await expectNotAhead(page, await card(page).getAttribute('data-start'));
	// The hint is gone for good once the picture has been opened.
	await expect(page.getByTestId('illustration-hint')).toBeHidden();
	await page.keyboard.press('Escape');
	await expect(card(page)).toBeHidden();
	await expect(page.getByRole('button', { name: 'Show the picture' })).toBeVisible();

	// Read on until a later picture becomes current: the dot says so.
	let found = false;
	for (let i = 0; i < 12 && !found; i++) {
		await page.keyboard.press('ArrowRight');
		await settled(page);
		found = await page.getByRole('button', { name: 'Show the new picture' }).isVisible();
	}
	expect(found).toBe(true);
	await page.getByRole('button', { name: 'Show the new picture' }).click();
	await expectNotAhead(page, await card(page).getAttribute('data-start'));
	await card(page).getByRole('button', { name: 'Close picture' }).click();
	await expect(card(page)).toBeHidden();

	await page.reload();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await expect(page.getByTestId('illustration-hint')).toBeHidden();
});

test('every mode keeps the reader’s place and shows nothing from ahead', async ({ page }) => {
	await openReader(page, 'book-alice');
	await chapter(page, /The Pool of Tears/);
	await page.keyboard.press('ArrowRight');
	await settled(page);
	for (const mode of ['Per page', 'Spread', 'In text', 'Off', 'Pop-up'] as const) {
		const before = await visibleWords(page);
		await setMode(page, mode);
		if (mode === 'In text') {
			// The figures arrive once their images have loaded; measure after that.
			const frame = page.frames().find((f) => f.url().startsWith('blob:'))!;
			await expect
				.poll(
					() => frame.evaluate(() => document.querySelectorAll('figure[data-injected]').length),
					{
						timeout: 15_000
					}
				)
				.toBeGreaterThan(0);
			await settled(page);
		}
		const after = await visibleWords(page);
		expect(after.first, `${mode}: first Word left the screen`).toBeLessThanOrEqual(before.first);
		expect(after.last, `${mode}: first Word left the screen`).toBeGreaterThanOrEqual(before.first);
		if (mode === 'Per page' || mode === 'Spread') {
			// The current picture (an old one may still be fading out for a moment).
			const panel = page.getByTestId('illustration-panel');
			await expect(panel).toHaveAttribute('data-start', /\d+/);
			await expectNotAhead(page, await panel.getAttribute('data-start'));
		}
		if (mode === 'In text') {
			const frame = page.frames().find((f) => f.url().startsWith('blob:'))!;
			await expect
				.poll(() => frame.evaluate(() => document.querySelectorAll('figure[data-injected]').length))
				.toBeGreaterThan(0);
		}
		if (mode === 'Off') {
			await expect(page.getByTestId('illustration-panel')).toBeHidden();
			await expect(page.getByRole('button', { name: /picture/ })).toHaveCount(0);
		}
	}
});

test('jumping far ahead and back never shows a picture from ahead', async ({ page }) => {
	await openReader(page, 'book-alice');
	await chapter(page, /Down the Rabbit-Hole/);
	await showChrome(page);
	const thumb = page.getByRole('slider', { name: 'Position in book' });
	await thumb.focus();
	await page.keyboard.press('End');
	await settled(page);
	await page.getByRole('button', { name: /Show the (new )?picture/ }).click();
	await expectNotAhead(page, await card(page).getAttribute('data-start'));
	await page.keyboard.press('Escape');
	await showChrome(page);
	await page.getByRole('button', { name: 'Back' }).click();
	await settled(page);
	await page.keyboard.press('i');
	await expect(card(page)).toBeVisible();
	await expectNotAhead(page, await card(page).getAttribute('data-start'));
});

test('the lightbox opens from the picture and zooms', async ({ page }) => {
	await openReader(page, 'book-alice');
	await chapter(page, /Down the Rabbit-Hole/);
	await page.keyboard.press('i');
	await card(page)
		.getByRole('button', { name: /^Zoom:/ })
		.click();
	const stage = page.getByTestId('lightbox-stage');
	await expect(stage).toHaveAttribute('data-scale', '1.00');
	await page.getByRole('button', { name: 'Zoom in' }).click();
	await expect(stage).not.toHaveAttribute('data-scale', '1.00');
	await stage.dblclick();
	await expect(stage).toHaveAttribute('data-scale', '1.00');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('lightbox')).toBeHidden();
});

test('turn on Rackham, put it first, and move between the packs', async ({ page }) => {
	await openReader(page, 'book-alice');
	await chapter(page, /The Pool of Tears/);
	await showChrome(page);
	await page.getByRole('button', { name: 'Illustrations' }).click();
	await page.getByRole('switch', { name: /Show Arthur Rackham/ }).click();
	await page.getByRole('button', { name: /Move Arthur Rackham.* up/ }).click();
	await expect
		.poll(
			async () =>
				(
					await storedRecords<{ illustrationPackIds: string[] }>(
						page,
						'user-reader',
						'layerSelection'
					)
				)[0]?.illustrationPackIds
		)
		.toEqual(['pack-alice-rackham', 'pack-alice-tenniel']);
	await page.keyboard.press('Escape');
	await page.keyboard.press('i');
	await expect(card(page)).toHaveAttribute('data-pack', 'pack-alice-rackham');
	await expect(card(page)).toContainText('1 of 2 packs');
	await card(page).getByRole('button', { name: 'Next pack' }).click();
	await expect(card(page)).toHaveAttribute('data-pack', 'pack-alice-tenniel');
	await page.keyboard.press('ArrowLeft');
	await expect(card(page)).toHaveAttribute('data-pack', 'pack-alice-rackham');
});

test('a pack the reader doesn’t hold can’t be turned on', async ({ page }) => {
	await switchPersona(page, 'Moderator');
	await openReader(page, 'book-alice');
	await showChrome(page);
	await page.getByRole('button', { name: 'Illustrations' }).click();
	await expect(page.getByRole('switch', { name: /Show Arthur Rackham/ })).toBeDisabled();
	await expect(page.getByText('You don’t have this pack yet.')).toBeVisible();
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('per-page is a strip above the text that collapses to a thumbnail', async ({ page }) => {
		await openReader(page, 'book-alice');
		await chapter(page, /The Pool of Tears/);
		await setMode(page, 'Per page');
		const panel = page.getByTestId('illustration-panel');
		await expect(panel).toBeVisible();
		const open = await panel.boundingBox();
		await panel.getByRole('button', { name: 'Make the picture smaller' }).click();
		await settled(page);
		const small = await panel.boundingBox();
		expect(small!.height).toBeLessThan(open!.height);
		// The text sits below the strip, never under it.
		const stage = await page.getByRole('region', { name: 'Book text' }).boundingBox();
		expect(stage!.y).toBeGreaterThanOrEqual(small!.y + small!.height - 1);
	});
});
