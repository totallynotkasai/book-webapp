import type { Page } from '@playwright/test';
import {
	expect,
	openReader,
	settled,
	showChrome,
	storedRecords,
	switchPersona,
	test
} from './fixtures';

// Phase 1.18 (IMPLEMENTATION-PLAN.md §6): its Try-it items and the acceptance of P1-STO-06
// (wishlists and sale alerts) and P1-STO-07 (reviews). The first Try-it uses The Lamplighter's
// Ledger rather than Treasure Island: Treasure Island is free and its author isn't a Persona, so
// no Persona can lower its price.

const LEDGER = "The Lamplighter's Ledger";

async function setLedgerPrice(page: Page, price: string) {
	await switchPersona(page, 'Author');
	await page.goto('/studio/books/book-lamplighters-ledger');
	await page.getByRole('tab', { name: 'Details' }).click();
	await page.getByRole('textbox', { name: 'Price (£, simulated)' }).fill(price);
	await page.getByRole('button', { name: 'Save details' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
}

test.describe('wishlist and sale alerts (P1-STO-06)', () => {
	test('wishlist the Ledger; its Author lowers the price; the Reader gets one alert', async ({
		page
	}) => {
		await page.goto('/store');
		const heart = page.getByRole('button', { name: `Wishlist ${LEDGER}` }).first();
		await expect(heart).toHaveAttribute('aria-pressed', 'false');
		await heart.click();
		await expect(heart).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByText('Added to your wishlist.')).toBeVisible();
		await page.goto('/you/wishlist');
		await expect(page.getByRole('list', { name: 'Wishlist' }).getByRole('link')).toHaveText(
			new RegExp(LEDGER)
		);

		await setLedgerPrice(page, '2.99');
		await switchPersona(page, 'Reader');
		await page.goto('/you/inbox');
		const alert = page.getByRole('listitem').filter({ hasText: `${LEDGER} is now £2.99` });
		await expect(alert).toBeVisible();
		await expect(alert).toContainText('It was £3.99 when you added it to your wishlist.');

		// A rise, then back to the same price: no second message.
		await setLedgerPrice(page, '4.99');
		await setLedgerPrice(page, '2.99');
		await switchPersona(page, 'Reader');
		await page.goto('/you/inbox');
		await expect(page.getByText(/is now £/)).toHaveCount(1);

		// The message leads to the Book page, at the new price.
		await page.getByRole('link', { name: 'See the book' }).first().click();
		await expect(page.getByRole('heading', { level: 1, name: LEDGER })).toBeVisible();
		await expect(page.getByRole('button', { name: /£2\.99/ }).first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Wishlist', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	test('owning a Book takes it off the wishlist', async ({ page }) => {
		await page.goto('/book/treasure-island');
		const wish = page.getByRole('button', { name: 'Wishlist', exact: true });
		await wish.click();
		await expect(wish).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('button', { name: 'Add to library' }).click();
		await page
			.getByRole('dialog')
			.getByRole('button', { name: /Add to library/ })
			.click();
		await expect(page.getByRole('link', { name: 'Read now' }).first()).toBeVisible();
		await expect(wish).toBeHidden();
		await page.goto('/you/wishlist');
		await expect(page.getByText('Your wishlist is empty')).toBeVisible();
	});
});

const ALICE = '/book/alices-adventures-in-wonderland';

test.describe('reviews (P1-STO-07)', () => {
	test('review Alice halfway through; the review shows how far you’d read', async ({ page }) => {
		// Read to Chapter VII, about half way, and wait for the place to be saved.
		await openReader(page, 'book-alice');
		await showChrome(page);
		await page.getByRole('button', { name: 'Contents' }).click();
		await page.getByRole('button', { name: /A Mad Tea-Party/ }).click();
		await settled(page);
		await expect
			.poll(async () => {
				const [p] = await storedRecords<{ furthestProgression: number }>(
					page,
					'user-reader',
					'progress'
				);
				return p?.furthestProgression ?? 0;
			})
			.toBeGreaterThan(0.4);
		const [progress] = await storedRecords<{ furthestProgression: number }>(
			page,
			'user-reader',
			'progress'
		);
		const percent = `Read ${Math.floor(progress!.furthestProgression * 100)}% when reviewing`;

		await page.goto(ALICE);
		const reviews = page.getByTestId('reviews');
		await expect(reviews.getByTestId('review-summary')).toContainText('4.2 out of 5 · 5 reviews');
		await reviews.getByRole('button', { name: 'Write a review' }).click();
		const dialog = page.getByRole('dialog', { name: /Review Alice/ });
		await expect(dialog.getByTestId('review-progress')).toContainText(percent);
		await expect(dialog.getByRole('button', { name: 'Post review' })).toBeDisabled();
		await dialog.getByRole('radio', { name: '4 stars' }).check({ force: true });
		await dialog
			.getByRole('textbox', { name: 'Your review (optional)' })
			.fill('Curiouser and curiouser, and I’m only half way.');
		await dialog.getByRole('button', { name: 'Post review' }).click();
		await expect(page.getByText('Review posted')).toBeVisible();

		const mine = reviews.getByTestId('review').filter({ hasText: 'Your review' });
		await expect(mine).toContainText('Curiouser and curiouser, and I’m only half way.');
		await expect(mine.getByRole('img', { name: '4 out of 5 stars' })).toBeVisible();
		await expect(mine.getByTestId('review-read')).toHaveText(percent);
		await expect(reviews.getByTestId('review-summary')).toContainText('4.2 out of 5 · 6 reviews');
		await expect(reviews.getByRole('button', { name: 'Write a review' })).toBeHidden();

		// One review per reader: changing it keeps it one.
		await mine.getByRole('button', { name: 'Change' }).click();
		await page.getByRole('dialog').getByRole('radio', { name: '5 stars' }).check({ force: true });
		await page.getByRole('dialog').getByRole('button', { name: 'Save review' }).click();
		await expect(page.getByText('Review saved')).toBeVisible();
		await expect(mine.getByRole('img', { name: '5 out of 5 stars' })).toBeVisible();
		await expect(reviews.getByTestId('review-summary')).toContainText('6 reviews');
	});

	test('a review with spoilers keeps its words back until you choose', async ({ page }) => {
		await page.goto(ALICE);
		const spoiler = page.getByTestId('review').filter({ hasText: 'Ellie R.' });
		await expect(spoiler).toContainText('This review gives away some of the story.');
		await expect(spoiler).not.toContainText('pack of cards');
		await spoiler.getByRole('button', { name: 'Show review' }).click();
		await expect(spoiler).toContainText('pack of cards');
		// Others' reviews say how far their writers had read.
		await expect(
			page.getByTestId('review').filter({ hasText: 'Tom Baxter' }).getByTestId('review-read')
		).toHaveText('Read 45% when reviewing');
		await expect(
			page.getByTestId('review').filter({ hasText: 'Priya N.' }).getByTestId('review-read')
		).toHaveText('Finished the book when reviewing');
	});

	test('only a Book you own can be reviewed', async ({ page }) => {
		await page.goto('/book/the-lamplighters-ledger');
		const reviews = page.getByTestId('reviews');
		await expect(reviews).toContainText('Get the book to review it.');
		await expect(reviews.getByRole('button', { name: 'Write a review' })).toHaveCount(0);
		await expect(reviews.getByTestId('review')).toHaveCount(3);
	});

	test('a reported review reaches the queue; hidden, it’s gone for other readers', async ({
		page
	}) => {
		await page.goto(ALICE);
		const mo = page.getByTestId('review').filter({ hasText: 'Mo' }).first();
		await mo.getByRole('button', { name: 'Report' }).click();
		const dialog = page.getByRole('dialog', { name: /Report/ });
		await dialog.getByRole('radio', { name: /Spam/ }).check({ force: true });
		await dialog.getByRole('button', { name: 'Report', exact: true }).click();
		await expect(page.getByText('Reported. A moderator will look at it.')).toBeVisible();

		await switchPersona(page, 'Moderator');
		await page.goto('/admin');
		await page
			.getByRole('link', { name: /Review of “Alice's Adventures in Wonderland” by Mo/ })
			.click();
		await expect(page.getByTestId('flag-excerpt')).toContainText(
			'Charming, but very much of its time.'
		);
		await expect(page.getByRole('button', { name: 'Suspend account' })).toHaveCount(0);
		await page.getByRole('button', { name: 'Hide', exact: true }).click();
		await page.getByRole('textbox', { name: 'Reason' }).fill('Testing the review queue.');
		await page.getByRole('dialog').getByRole('button', { name: 'Hide' }).click();
		await expect(page.getByText('Hide: done. The reviewer has been told.')).toBeVisible();

		await switchPersona(page, 'Reader');
		await page.goto(ALICE);
		await expect(page.getByTestId('review-summary')).toContainText('4 reviews');
		await expect(page.getByTestId('review').filter({ hasText: 'Charming' })).toHaveCount(0);
	});
});
