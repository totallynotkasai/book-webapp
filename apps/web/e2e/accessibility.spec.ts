import type { Page } from '@playwright/test';
import { silentNarration } from './audio';
import {
	expect,
	expectNoViolations,
	openReader,
	selectPhrase,
	settled,
	showChrome,
	switchPersona,
	test
} from './fixtures';

// axe on every route at WCAG 2.2 AA (IMPLEMENTATION-PLAN.md §9, from Phase 1.1; P1-QA-02 adds
// the reader with each of its panels, and the screen-reader walkthroughs in
// docs/device-checklist.md). Each route is checked in its light and dark schemes. Screens only
// a flow reaches are checked in that flow's spec: the community hub (community.spec.ts), the
// narration review (studio.spec.ts) and the welcome (tester.spec.ts).

const ROUTES = [
	{ path: '/library', heading: 'Library' },
	{ path: '/store', heading: 'Store' },
	{ path: '/book/the-lamplighters-ledger', heading: "The Lamplighter's Ledger" },
	{ path: '/creator/wren-ashdown', heading: 'Wren Ashdown' },
	{ path: '/you', heading: 'You' },
	{ path: '/you/settings', heading: 'Settings' },
	{ path: '/you/help', heading: 'Help' },
	{ path: '/you/bookmarks', heading: 'Bookmark designs' },
	{ path: '/you/purchases', heading: 'Purchases and subscriptions' },
	{ path: '/you/data', heading: 'Your data' },
	{ path: '/you/reading', heading: 'Your reading' },
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

		test('the reader and each of its panels have no axe violations (P1-QA-02)', async ({
			page
		}) => {
			test.slow();
			// The Author holds Alice's Illustrations and narration, so every panel has content.
			await switchPersona(page, 'Author');
			await silentNarration(page);
			await openReader(page, 'book-alice');
			const panel = async (open: () => Promise<void>, name: string) => {
				await showChrome(page);
				await open();
				await expect(page.getByRole('dialog', { name })).toBeVisible();
				await expectNoViolations(page);
				await page.keyboard.press('Escape');
				await expect(page.getByRole('dialog', { name })).toBeHidden();
			};

			await showChrome(page);
			await page.getByRole('button', { name: 'Contents and notes' }).click();
			await page.getByRole('button', { name: /Down the Rabbit-Hole/ }).click();
			await settled(page);
			await showChrome(page);
			await expectNoViolations(page);

			await panel(
				() => page.getByRole('button', { name: 'Contents and notes' }).click(),
				'Contents and notes'
			);
			await showChrome(page);
			await page.getByRole('button', { name: 'Reading preferences' }).click();
			for (const tab of ['Text', 'Page', 'Theme']) {
				await page.getByRole('tab', { name: tab }).click();
				await expectNoViolations(page);
			}
			await page.keyboard.press('Escape');
			await panel(
				() => page.getByRole('button', { name: 'Illustrations' }).click(),
				'Illustrations'
			);
			await panel(() => page.keyboard.press('Shift+Slash'), 'Keyboard shortcuts');
			await panel(async () => {
				await page.keyboard.press('Slash');
				await page.getByRole('searchbox', { name: 'Search in this book' }).fill('cheshire');
				await expect(page.getByTestId('search-status')).toHaveText(/^7 results/);
			}, 'Search in this book');

			// The selection toolbar, then the pop-up picture, then the narration player.
			for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
			await expect(page.getByRole('toolbar', { name: 'Selection' })).toBeVisible();
			await expectNoViolations(page);
			await page.keyboard.press('Escape');
			for (let i = 0; i < 2; i++) {
				await page.keyboard.press('ArrowRight');
				await settled(page);
			}
			await page.getByRole('button', { name: /Show the (new )?picture/ }).click();
			await expect(page.getByTestId('illustration-card')).toBeVisible();
			await expectNoViolations(page);
			await page.keyboard.press('Escape');
			await showChrome(page);
			await page.getByRole('button', { name: 'Listen to the narration' }).click();
			await expect(page.getByTestId('narration-player')).toHaveAttribute('data-playing', 'true');
			await expectNoViolations(page);
		});

		test('the story so far and the glossary card have no axe violations (P1-RDR-13)', async ({
			page
		}) => {
			// The Author holds the Ledger, which has a seeded story so far.
			await switchPersona(page, 'Author');
			await openReader(page, 'book-lamplighters-ledger');
			await showChrome(page);
			await page.getByRole('button', { name: 'Contents and notes' }).click();
			await page.getByRole('button', { name: /^3\. Murk on Saltgate Bridge/ }).click();
			await settled(page);
			await showChrome(page);
			await page.getByRole('button', { name: 'Contents and notes' }).click();
			await page.getByRole('tab', { name: 'Story so far' }).click();
			await expect(page.getByTestId('story-recap').first()).toBeVisible();
			await expectNoViolations(page);
			await page.keyboard.press('Escape');
			await selectPhrase(page, 'Saltgate Bridge');
			await page.getByRole('button', { name: 'In the glossary' }).click();
			await expect(page.getByTestId('glossary-card')).toBeVisible();
			await expectNoViolations(page);
		});

		test('/studio and /admin have no axe violations', async ({ page }) => {
			await switchPersona(page, 'Author');
			await page.goto('/studio');
			await expect(page.getByRole('heading', { name: 'Creator Studio' })).toBeVisible();
			await page.waitForLoadState('networkidle');
			await expectNoViolations(page);
			await page.goto('/you/inbox');
			await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
			await expectNoViolations(page);
			await switchPersona(page, 'Moderator');
			await page.goto('/admin');
			await expect(page.getByText('Reader report')).toBeVisible();
			await expectNoViolations(page);
			await page.getByRole('link', { name: /Book: The Lamplighter/ }).click();
			await expect(page.getByRole('heading', { name: 'What fired' })).toBeVisible();
			await expectNoViolations(page);
			await page.goto('/admin/log');
			await expect(page.getByRole('heading', { name: 'Moderation log', level: 1 })).toBeVisible();
			await expectNoViolations(page);
		});

		test('the Studio’s Book, narration, plans and earnings screens have no axe violations', async ({
			page
		}) => {
			test.slow();
			await switchPersona(page, 'Author');
			await page.goto('/studio/books/book-lamplighters-ledger');
			await expect(page.getByRole('heading', { name: "The Lamplighter's Ledger" })).toBeVisible();
			for (const tab of ['Versions', 'Details', 'Illustrations', 'Narration', 'Story so far']) {
				await page.getByRole('tab', { name: tab }).click();
				await page.waitForLoadState('networkidle');
				await expectNoViolations(page);
			}
			// The story so far's entry dialog (P1-STU-05).
			await expect(page.getByTestId('glossary-entry').first()).toBeVisible();
			await page.getByRole('button', { name: 'Add an entry' }).click();
			await expect(page.getByTestId('glossary-entry-dialog')).toBeVisible();
			await expectNoViolations(page);
			await page.keyboard.press('Escape');
			await page.getByRole('tab', { name: 'Narration' }).click();
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

test.describe('reduced motion (P1-QA-02)', () => {
	test.use({ reducedMotion: 'reduce' });

	/** CSS animations and transitions that would take time to play. */
	const moving = (page: Page) =>
		page.evaluate(
			() =>
				document.getAnimations().filter((a) => {
					const timing = a.effect?.getComputedTiming();
					return a.playState === 'running' && Number(timing?.duration ?? 0) > 0;
				}).length
		);

	test('nothing moves: screens, dialogs and page turns are instant', async ({ page }) => {
		// An indeterminate bar stays in view, standing still, instead of sliding.
		await page.goto('/dev/components');
		const loading = page.getByRole('progressbar', { name: 'Loading' });
		const track = (await loading.boundingBox())!;
		const bar = (await loading.locator('.bar').boundingBox())!;
		expect(bar.width).toBeGreaterThan(0);
		expect(bar.x).toBeGreaterThanOrEqual(track.x);
		expect(bar.x + bar.width).toBeLessThanOrEqual(track.x + track.width + 1);
		expect(await moving(page)).toBe(0);

		await page.goto('/you/help');
		await page.getByRole('button', { name: 'Show the welcome again' }).click();
		await expect(page.getByRole('dialog', { name: 'Welcome to Book Reader' })).toBeVisible();
		expect(await moving(page)).toBe(0);

		// The reader's default page turn slides; under reduced motion it doesn't.
		await openReader(page, 'book-alice');
		await page.keyboard.press('ArrowRight');
		await settled(page);
		const animated = await page.evaluate(() => {
			const search = (root: Document | ShadowRoot): boolean =>
				[...root.querySelectorAll('*')].some(
					(el) => el.hasAttribute('animated') || (!!el.shadowRoot && search(el.shadowRoot))
				);
			return search(document);
		});
		expect(animated).toBe(false);
		expect(await moving(page)).toBe(0);
	});
});
