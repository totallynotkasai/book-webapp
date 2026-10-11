import { expect, test } from './fixtures';

// Runs against the tester build (P0-09 acceptance): no dev panel, no flagged-off areas.

test('hides the dev panel, link and route included', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Developer panel' })).toHaveCount(0);

	await page.goto('/dev');
	await expect(page.getByText('Not found')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Developer panel' })).toHaveCount(0);
});

test('keeps the reading experience', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('link', { name: "Alice's Adventures in Wonderland" })).toBeVisible();
	await page.goto('/read/sample');
	await expect(page.getByRole('link', { name: 'Back to library' })).toBeVisible();
});
