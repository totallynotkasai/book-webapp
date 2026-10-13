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

test.describe('first run (P1-QA-03)', () => {
	test.use({ welcomed: false });

	test('a new tester reaches Alice’s first chapter from the welcome', async ({ page }) => {
		const started = Date.now();
		await page.goto('/');
		const welcome = page.getByRole('dialog', { name: 'Welcome to Book Reader' });
		await expect(welcome).toBeVisible();
		await expect(welcome).not.toContainText('store');
		await welcome.getByRole('button', { name: 'Start reading' }).click();
		await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});
		await expect(page.getByTestId('chapter-title')).toContainText(/Rabbit-Hole/i);
		// DESIGN.md P1-QA-03: within a minute, unaided. Here it takes seconds.
		expect(Date.now() - started).toBeLessThan(60_000);
		// The chapter was a starting point: a reload resumes where the reader is, not there.
		await expect(page).toHaveURL(/\/read\/book-alice$/);
	});

	test('the welcome shows once, and again from Help', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Look around first' }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
		await expect(page.getByRole('dialog')).toHaveCount(0);

		await page.goto('/you');
		await page.getByRole('link', { name: /Help/ }).click();
		await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
		await expect(page.getByTestId('build-info')).toContainText('Tester build');
		await page.getByRole('button', { name: 'Show the welcome again' }).click();
		await expect(page.getByRole('dialog', { name: 'Welcome to Book Reader' })).toBeVisible();
	});
});

test('a facilitator link adds simulated areas on this device, never the dev panel (D-031)', async ({
	page
}) => {
	await page.goto('/?areas=store,devPanel');
	await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
	const nav = page.getByRole('navigation').first();
	await expect(nav.getByRole('link', { name: 'Store' })).toBeVisible();

	// Remembered on the device: a plain address keeps the store.
	await page.goto('/store');
	await expect(page.getByRole('heading', { name: 'Store', level: 1 })).toBeVisible();
	await page.goto('/dev');
	await expect(page.getByText('Not found')).toBeVisible();

	await page.goto('/?areas=none');
	await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Store' })).toHaveCount(0);
	await page.goto('/store');
	await expect(page.getByText('Not found')).toBeVisible();
});
