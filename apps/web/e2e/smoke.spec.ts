import { expect, test } from '@playwright/test';

test('the Library opens', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
});

test('the reader route is served by the SPA fallback', async ({ page }) => {
	await page.goto('/read/sample');
	await expect(page.getByRole('link', { name: 'Back to library' })).toBeVisible();
});
