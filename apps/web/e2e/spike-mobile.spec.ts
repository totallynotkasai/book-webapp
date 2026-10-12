import { expect, test } from '@playwright/test';

// SPIKE (P0-07): the mobile capabilities page works in a desktop browser too. Its real checks are
// made by hand on the owner's phone (ADR-004). Deleted with the spike.
test('the mobile spike page loads, reports the platform and keeps a storage marker', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/spike/mobile');
	await expect(page.getByRole('heading', { name: 'Mobile capabilities spike' })).toBeVisible();
	await expect(page.getByText('Platform', { exact: true })).toBeVisible();
	await expect(page.getByTestId('marker')).toHaveText('No marker yet.');
	await page.getByRole('button', { name: 'Write a marker' }).click();
	await expect(page.getByTestId('marker')).toContainText('is still here');
	await page.reload();
	await expect(page.getByTestId('marker')).toContainText('is still here');
	expect(errors).toEqual([]);
});
