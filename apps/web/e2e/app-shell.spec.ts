import type { Page } from '@playwright/test';
import { expect, expectSaved, openDevPanel, switchPersona, test } from './fixtures';

// Phase 1.1 Try-it list (IMPLEMENTATION-PLAN.md §6) and P1-UI-03 / P1-APP-01 acceptance:
// every area at compact and expanded widths, as each Persona; the theme follows Settings; every
// screen's loading, empty, error and offline states can be forced from the dev panel.

const SIZES = {
	phone: { width: 360, height: 780 },
	medium: { width: 700, height: 900 },
	desktop: { width: 1280, height: 800 }
} as const;

/** The page never scrolls sideways (DESIGN.md §11.5 layouts at every window class). */
async function expectNoHorizontalScroll(page: Page) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
}

function nav(page: Page) {
	return page.getByRole('navigation', { name: 'Main' });
}

const PERSONAS = [
	{ label: 'Reader', studio: false, admin: false },
	{ label: 'Author', studio: true, admin: false },
	{ label: 'Illustrator', studio: true, admin: false },
	{ label: 'Moderator', studio: false, admin: true }
] as const;

for (const [sizeName, size] of Object.entries(SIZES)) {
	test.describe(`at ${sizeName} size`, () => {
		test.use({ viewport: size });

		test('uses a bottom bar on compact screens and a rail from 600 px', async ({ page }) => {
			await page.goto('/library');
			await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
			const box = await nav(page).boundingBox();
			if (size.width < 600) expect(box!.y).toBeGreaterThan(size.height - 120);
			else expect(box!.x).toBe(0);
			await expectNoHorizontalScroll(page);
		});

		for (const persona of PERSONAS) {
			test(`every area works as the ${persona.label}`, async ({ page }) => {
				await switchPersona(page, persona.label);

				await page.goto('/library');
				await expect(page.getByRole('link', { name: /Alice's Adventures/ })).toBeVisible();
				await expectNoHorizontalScroll(page);

				await nav(page).getByRole('link', { name: 'Store' }).click();
				await expect(page.getByRole('heading', { name: 'Store', level: 1 })).toBeVisible();
				await expect(page.getByText('Simulated: no real money')).toBeVisible();
				await page.getByRole('link', { name: /The Time Machine/ }).click();
				await expect(page.getByRole('heading', { name: 'The Time Machine' })).toBeVisible();
				await expect(page.getByText('£0.99').first()).toBeVisible();
				await expectNoHorizontalScroll(page);

				await page.getByRole('link', { name: 'H. G. Wells' }).click();
				await expect(page.getByRole('heading', { name: 'H. G. Wells', level: 1 })).toBeVisible();
				await expect(page.getByRole('link', { name: /The Time Machine/ })).toBeVisible();
				await expectNoHorizontalScroll(page);

				await expect(nav(page).getByRole('link', { name: 'Studio' })).toHaveCount(
					persona.studio ? 1 : 0
				);
				if (persona.studio) {
					await nav(page).getByRole('link', { name: 'Studio' }).click();
					await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible();
					await expect(page.getByRole('heading', { name: 'Your books' })).toBeVisible();
					await expectNoHorizontalScroll(page);
				}

				await nav(page).getByRole('link', { name: 'You' }).click();
				await expect(page.getByRole('heading', { name: 'You', level: 1 })).toBeVisible();
				await expect(page.getByRole('link', { name: /Review queue/ })).toHaveCount(
					persona.admin ? 1 : 0
				);
				if (persona.admin) {
					await page.getByRole('link', { name: /Review queue/ }).click();
					await expect(page.getByText('Reader report')).toBeVisible();
					await expectNoHorizontalScroll(page);
					await page.goBack();
				}
				await page.getByRole('link', { name: /Settings/ }).click();
				await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
				await expectNoHorizontalScroll(page);
			});
		}
	});
}

test('Studio and the review queue refuse the wrong roles inside the backend', async ({ page }) => {
	// The Reader has no links to them, but going there directly still fails in backend-local.
	await page.goto('/studio');
	await expect(page.getByRole('alert')).toContainText('Your account can’t do that');
	await page.goto('/admin');
	await expect(page.getByRole('alert')).toContainText('Your account can’t do that');
});

test('the whole app follows the seed colour, mode and contrast, and keeps them', async ({
	page
}) => {
	const primary = () =>
		page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim()
		);
	await page.goto('/you/settings');
	await page
		.getByRole('radiogroup', { name: 'Mode' })
		.getByRole('radio', { name: 'Light' })
		.click();
	const scheme = () => page.evaluate(() => document.documentElement.style.colorScheme);
	await expect.poll(scheme).toBe('light');
	const teal = await primary();

	// Changes apply a moment after the click, so each step waits for the new value.
	await page.getByRole('radio', { name: 'Terracotta' }).check();
	await expect.poll(primary).not.toBe(teal);
	const terracotta = await primary();

	await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Dark' }).click();
	await expect.poll(scheme).toBe('dark');
	await expect.poll(primary).not.toBe(terracotta);
	const dark = await primary();

	await page
		.getByRole('radiogroup', { name: 'Contrast' })
		.getByRole('radio', { name: 'High' })
		.click();
	await expect.poll(primary).not.toBe(dark);
	const high = await primary();

	// Another screen, and a fresh load, use the same theme.
	await page.goto('/store');
	expect(await primary()).toBe(high);
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Store', level: 1 })).toBeVisible();
	await expect.poll(primary).toBe(high);
});

test('a custom colour can be typed, and a wrong one says how to fix it', async ({ page }) => {
	await page.goto('/you/settings');
	const field = page.getByRole('textbox', { name: 'Custom colour (hex)' });
	await field.fill('teal');
	await field.press('Enter');
	await expect(page.getByText('Enter a colour like #00696b.')).toBeVisible();
	await field.fill('#123456');
	await field.press('Enter');
	await expect(page.getByRole('radio', { name: 'Custom colour' })).toBeChecked();
});

test('sepia tints only the reading page', async ({ page }) => {
	const tokens = () =>
		page.evaluate(() => {
			const style = getComputedStyle(document.documentElement);
			return {
				surface: style.getPropertyValue('--md-sys-color-surface').trim(),
				reader: style.getPropertyValue('--reader-background').trim(),
				sepia: document.documentElement.dataset.sepia !== undefined
			};
		});
	const mode = page.getByRole('radiogroup', { name: 'Mode' });
	await page.goto('/you/settings');
	await mode.getByRole('radio', { name: 'Light' }).click();
	await expect(mode.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
	const light = await tokens();
	expect(light.reader).toBe(light.surface);

	await mode.getByRole('radio', { name: 'Sepia' }).click();
	await expect.poll(async () => (await tokens()).sepia).toBe(true);
	const sepia = await tokens();
	expect(sepia.reader).not.toBe(light.reader);
	expect(sepia.surface).toBe(light.surface);
	await expect(page.getByTestId('reading-preview')).toHaveCSS('background-color', /rgb/);
});

test.describe('every screen copes with slow, failing, empty and offline backends', () => {
	const SCREENS = [
		{ path: '/library', what: 'Your library', empty: 'Your library is empty' },
		{ path: '/store', what: 'The store', empty: 'Nothing in the store yet' },
		{ path: '/creator/lewis-carroll', what: 'This creator', empty: null },
		{ path: '/book/treasure-island', what: 'This book', empty: null }
	];

	test('slow: skeletons appear while loading', async ({ page }) => {
		await openDevPanel(page);
		await page.getByRole('spinbutton', { name: 'Latency from (ms)' }).fill('2500');
		await page.getByRole('spinbutton', { name: 'Latency from (ms)' }).blur();
		await expectSaved(page);
		await page.goto('/store');
		await expect(page.getByTestId('skeleton').first()).toBeVisible();
		await expect(page.getByRole('status').filter({ hasText: 'Loading…' })).toBeAttached();
		await expect(page.getByRole('link', { name: /Treasure Island/ })).toBeVisible({
			timeout: 10_000
		});
	});

	test('failing: each screen says what didn’t load and offers Try again', async ({ page }) => {
		await openDevPanel(page);
		await page.getByRole('slider', { name: /Failure rate/ }).fill('100');
		await expectSaved(page);
		for (const screen of SCREENS) {
			await page.goto(screen.path);
			const alert = page.getByRole('alert').filter({ hasText: `${screen.what} didn’t load` });
			await expect(alert).toBeVisible();
			await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
		}
	});

	test('offline: each screen says so and what still works', async ({ page }) => {
		await openDevPanel(page);
		await page.getByRole('checkbox', { name: 'Offline' }).check();
		await expectSaved(page);
		for (const screen of SCREENS) {
			await page.goto(screen.path);
			const alert = page.getByRole('alert').first();
			await expect(alert).toContainText('You’re offline');
			await expect(alert).toContainText('Books you imported still work');
		}
		// The navigation still knows who you are (a cached session, as in Phase 2).
		await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
	});

	test('empty: lists say what to do next', async ({ page }) => {
		await openDevPanel(page);
		await page.getByRole('checkbox', { name: /Empty lists/ }).check();
		await expectSaved(page);
		for (const screen of SCREENS.filter((s) => s.empty)) {
			await page.goto(screen.path);
			await expect(page.getByText(screen.empty!)).toBeVisible();
		}
		await switchPersona(page, 'Moderator');
		await page.goto('/admin');
		await expect(page.getByText('Nothing to review')).toBeVisible();
	});

	test('recovers when the backend comes back', async ({ page }) => {
		await openDevPanel(page);
		await page.getByRole('slider', { name: /Failure rate/ }).fill('100');
		await expectSaved(page);
		await page.goto('/store');
		await expect(page.getByRole('alert')).toBeVisible();
		await openDevPanel(page);
		await page.getByRole('slider', { name: /Failure rate/ }).fill('0');
		await expectSaved(page);
		await page.goto('/store');
		await expect(page.getByRole('link', { name: /Treasure Island/ })).toBeVisible();
	});
});
