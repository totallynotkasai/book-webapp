import { expect, expectNoViolations, switchPersona, test } from './fixtures';

// axe on every route at WCAG 2.2 AA (IMPLEMENTATION-PLAN.md §9, from Phase 1.1; P1-QA-02 adds
// the screen-reader walkthroughs). Each route is checked in its light and dark schemes.

const ROUTES = [
	{ path: '/library', heading: 'Library' },
	{ path: '/store', heading: 'Store' },
	{ path: '/book/the-lamplighters-ledger', heading: "The Lamplighter's Ledger" },
	{ path: '/creator/wren-ashdown', heading: 'Wren Ashdown' },
	{ path: '/you', heading: 'You' },
	{ path: '/you/settings', heading: 'Settings' },
	{ path: '/dev', heading: 'Developer panel' },
	{ path: '/dev/components', heading: 'Component gallery' }
];

for (const scheme of ['light', 'dark'] as const) {
	test.describe(`${scheme} scheme`, () => {
		test.use({ colorScheme: scheme });

		for (const route of ROUTES) {
			test(`${route.path} has no axe violations`, async ({ page }) => {
				await page.goto(route.path);
				await expect(page.getByRole('heading', { name: route.heading, level: 1 })).toBeVisible();
				// Let covers and fonts settle so contrast is measured on the final page.
				await page.waitForLoadState('networkidle');
				await expectNoViolations(page);
			});
		}

		test('/studio and /admin have no axe violations', async ({ page }) => {
			await switchPersona(page, 'Author');
			await page.goto('/studio');
			await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible();
			await page.waitForLoadState('networkidle');
			await expectNoViolations(page);
			await switchPersona(page, 'Moderator');
			await page.goto('/admin');
			await expect(page.getByText('Reader report')).toBeVisible();
			await expectNoViolations(page);
		});

		test('the Studio’s Book, narration, plans and earnings screens have no axe violations', async ({
			page
		}) => {
			test.slow();
			await switchPersona(page, 'Author');
			await page.goto('/studio/books/book-lamplighters-ledger');
			await expect(page.getByRole('heading', { name: "The Lamplighter's Ledger" })).toBeVisible();
			for (const tab of ['Versions', 'Details', 'Illustrations', 'Narration']) {
				await page.getByRole('tab', { name: tab }).click();
				await page.waitForLoadState('networkidle');
				await expectNoViolations(page);
			}
			await page.getByRole('button', { name: 'New narration' }).click();
			await expectNoViolations(page);
			await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
			await expect(page.getByTestId('track-chapter').first()).toBeVisible();
			await expectNoViolations(page);
			for (const [path, heading] of [
				['/studio/plans', 'Subscription plans'],
				['/studio/earnings', 'Earnings']
			]) {
				await page.goto(path!);
				await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
				await page.waitForLoadState('networkidle');
				await expectNoViolations(page);
			}
		});
	});
}
