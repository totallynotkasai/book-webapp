import type { Page } from '@playwright/test';
import { silentNarration } from './audio';
import {
	expect,
	openDevPanel,
	openReader,
	settled,
	showChrome,
	storedPreferences,
	test
} from './fixtures';

// Phase 1.6 Try-it list (IMPLEMENTATION-PLAN.md §6), as the Reader Persona: browse and search,
// previews and the narration sample, a sample, the Complete edition, Layers available to get, a
// declined payment, a Bookmark Design in two Books, Tips and early access through a Creator
// Subscription that ends with the dev clock, and hiding AI-generated content.

test.use({ viewport: { width: 1280, height: 800 } });

const ALICE = '/book/alices-adventures-in-wonderland';
const SERIAL = '/book/the-lamplighters-ledger';

const checkout = (page: Page) => page.getByTestId('checkout');
// The sheet is modal, but role queries still see the page behind it, which can offer the same
// button ("Add to library", "Read now"), so actions in the sheet are scoped to the dialog.
const sheet = (page: Page) => page.getByRole('dialog');

async function pay(page: Page) {
	await sheet(page)
		.getByRole('button', { name: /^(Pay .* \(simulated\)|Add to library|Try again)$/ })
		.click();
}

async function paymentOutcome(page: Page, outcome: 'succeed' | 'decline') {
	await openDevPanel(page);
	await page.getByLabel('Payment outcome').selectOption(outcome);
	await expect(page.getByText(/saved/i).first()).toBeVisible();
}

async function chapterFromContents(page: Page, title: RegExp) {
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await page.getByRole('button', { name: title }).click();
	await settled(page);
}

test('browse and search, preview the pictures, hear a sample, read a sample', async ({ page }) => {
	await silentNarration(page);
	await page.goto('/store');
	await expect(page.getByRole('heading', { name: 'Illustrated and narrated' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'New chapters every month' })).toBeVisible();
	await page.getByLabel('Search books and authors').fill('wells');
	await expect(page.getByRole('heading', { name: /1 book for “wells”/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /The Time Machine/ })).toBeVisible();
	await page.getByLabel('Search books and authors').fill('');

	await page.goto(ALICE);
	await expect(page.getByTestId('illustration-previews').getByRole('img').first()).toBeVisible();
	const sample = page.getByTestId('narration-sample');
	await sample.getByRole('button', { name: /Listen to a sample/ }).click();
	await expect(sample).toHaveAttribute('data-playing', 'true');
	await sample.getByRole('button', { name: 'Stop the sample' }).click();
	await expect(sample).not.toHaveAttribute('data-playing', 'true');

	await page.goto(SERIAL);
	await page.getByRole('link', { name: 'Read sample' }).click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await expect(page.locator('.book-title')).toContainText('Sample');
	for (let i = 0; i < 20 && !(await page.getByTestId('locked-end').isVisible()); i++) {
		await page.keyboard.press('ArrowRight');
		await settled(page);
	}
	await expect(page.getByTestId('locked-end')).toContainText('That’s the end of the sample');
	await page.getByRole('link', { name: 'Get the book' }).click();
	await expect(page).toHaveURL(new RegExp(`${SERIAL}$`));
});

test('the Complete edition: pictures and narration are on when you open it', async ({ page }) => {
	// Alice starts in the Reader's library as the book only: its Layers are there to get.
	await openReader(page, 'book-alice');
	await showChrome(page);
	await page.getByRole('button', { name: 'Illustrations' }).click();
	await expect(page.getByText('You don’t have this pack yet.').first()).toBeVisible();
	await expect(page.getByRole('link', { name: 'Get it in the store' }).first()).toBeVisible();
	await page.keyboard.press('Escape');

	await page.goto(ALICE);
	const layers = page.getByTestId('book-layers');
	await expect(layers).toContainText('In the Complete edition');
	await page.getByRole('button', { name: 'Get the complete edition · £2.49' }).click();
	await expect(checkout(page)).toContainText('The book');
	await expect(checkout(page)).toContainText('You have this');
	await expect(page.getByTestId('checkout-total')).toHaveText('£2.49');
	await pay(page);
	await expect(checkout(page)).toContainText('is in your library');
	await sheet(page).getByRole('link', { name: 'Read now' }).click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	// Official Layers are on from the first open (§8.1); audio waits for play (Invariant 11).
	await expect(page.getByRole('button', { name: /picture/ })).toBeVisible();
	await chapterFromContents(page, /Down the Rabbit-Hole/);
	await showChrome(page);
	await expect(page.getByRole('button', { name: 'Listen to the narration' })).not.toHaveAttribute(
		'aria-disabled',
		'true'
	);

	await page.goto(ALICE);
	await expect(page.getByText('You have this')).toHaveCount(2);
	// The community pack isn't in the Bundle: still there to get on its own.
	await expect(layers.getByRole('button', { name: 'Get · £0.99' })).toBeVisible();
});

test('a declined payment buys nothing; trying again once it works buys once', async ({ page }) => {
	await paymentOutcome(page, 'decline');
	await page.goto('/book/the-princess-and-the-goblin');
	await page.getByRole('button', { name: 'Buy · £1.49' }).click();
	await pay(page);
	await expect(checkout(page)).toContainText('The payment didn’t go through');
	await page.keyboard.press('Escape');

	await paymentOutcome(page, 'succeed');
	await page.goto('/book/the-princess-and-the-goblin');
	await page.getByRole('button', { name: 'Buy · £1.49' }).click();
	await pay(page);
	await expect(checkout(page)).toContainText('is in your library');
	await page.goto('/you/purchases');
	await expect(page.getByTestId('order')).toHaveCount(1);
	await expect(page.getByTestId('order')).toContainText('The Princess and the Goblin');
});

test('a Bookmark Design bought once marks bookmarks in every Book', async ({ page }) => {
	await page.goto('/you/bookmarks');
	const queen = page.getByTestId('bookmark-design').filter({ hasText: 'Queen of Hearts' });
	await queen.getByRole('button', { name: 'Buy · £0.79' }).click();
	await pay(page);
	await expect(checkout(page)).toContainText('is yours, in every book');
	await page.keyboard.press('Escape');
	await expect(queen).toContainText('Your default');
	await expect
		.poll(
			async () =>
				(await storedPreferences(page, 'user-reader')) as { bookmarkDesignProductId?: string }
		)
		.toMatchObject({ bookmarkDesignProductId: 'product-design-queen-of-hearts' });

	// A second Book, free to add.
	await page.goto('/book/treasure-island');
	await page.getByRole('button', { name: 'Add to library' }).click();
	await pay(page);
	await expect(checkout(page)).toContainText('is in your library');

	for (const bookId of ['book-alice', 'book-treasure-island']) {
		await openReader(page, bookId);
		await page.keyboard.press('ArrowRight');
		await settled(page);
		await page.keyboard.press('b');
		await expect(page.getByTestId('bookmark-ribbon')).toHaveAttribute(
			'data-design',
			'product-design-queen-of-hearts'
		);
	}
});

test('tip, subscribe for early access, cancel, and the clock ends it; purchases stay', async ({
	page
}) => {
	test.slow();
	await page.goto(SERIAL);
	await page.getByRole('button', { name: 'Tip' }).click();
	await page.getByTestId('tip-sheet').getByRole('button', { name: '£3.00' }).click();
	await page.getByRole('button', { name: 'Send £3.00 (simulated)' }).click();
	await expect(page.getByText('Thank you! Wren Ashdown got your £3.00 tip.')).toBeVisible();

	await page.getByRole('button', { name: 'Buy · £3.99' }).click();
	await pay(page);
	await sheet(page).getByRole('link', { name: 'Read now' }).click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	// Chapters 5 and 6 are early access: listed, locked, and explained at the end of chapter 4.
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await expect(
		page.getByRole('button', { name: /5\. The Lamp That Remembers.*Early access/ })
	).toBeVisible();
	await page.getByRole('button', { name: /5\. The Lamp That Remembers/ }).click();
	await settled(page);
	const end = page.getByTestId('locked-end');
	await expect(end).toContainText('Next: 5. The Lamp That Remembers');
	await expect(end).toContainText('early access for Wren Ashdown’s subscribers');
	await end.getByRole('button', { name: 'Subscribe' }).click();
	await page.getByRole('button', { name: 'Subscribe · £3.00 a month' }).click();
	await expect(page.getByTestId('subscribe-sheet')).toContainText('Early access is open now');
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await chapterFromContents(page, /5\. The Lamp That Remembers/);
	await expect(page.getByTestId('chapter-title')).toHaveText('5. The Lamp That Remembers');

	await page.goto('/you/purchases');
	await expect(page.getByTestId('tip')).toContainText('£3.00 to Wren Ashdown');
	await page.getByTestId('subscription').getByRole('button', { name: 'Cancel' }).click();
	await page.getByRole('button', { name: 'Cancel subscription' }).click();
	await expect(page.getByTestId('subscription')).toContainText('cancelled; benefits until');

	// A month and a week on, the paid period is over: early access ends, the purchase stays.
	await openDevPanel(page);
	await page.getByRole('button', { name: '+30 days' }).click();
	await page.getByRole('button', { name: '+1 week' }).click();
	// The offset is saved asynchronously; leaving before it shows could lose it.
	await expect(page.getByText('(37 days ahead)')).toBeVisible();
	await page.goto('/you/purchases');
	await expect(page.getByTestId('subscription')).toContainText('ended');
	await openReader(page, 'book-lamplighters-ledger');
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await expect(
		page.getByRole('button', { name: /5\. The Lamp That Remembers.*Early access/ })
	).toBeVisible();
	await page.goto('/library');
	// Under "Continue reading" and in the list.
	await expect(page.getByRole('link', { name: /The Lamplighter's Ledger/ }).first()).toBeVisible();
});

test('“Hide AI-generated content” takes AI-generated Books out of the store', async ({ page }) => {
	await page.goto('/store');
	await expect(page.getByRole('link', { name: /The Lamplighter's Ledger/ }).first()).toBeVisible();
	await page.goto('/you/settings');
	await page.getByRole('switch', { name: 'Hide AI-generated content' }).click();
	await page.goto('/store');
	await expect(page.getByRole('heading', { name: 'Illustrated and narrated' })).toBeVisible();
	await expect(page.getByRole('link', { name: /The Lamplighter's Ledger/ })).toHaveCount(0);
	await expect(page.getByText('AI-generated books are hidden.')).toBeVisible();
	await page.getByLabel('Search books and authors').fill('lamplighter');
	await expect(page.getByRole('heading', { name: /0 books for “lamplighter”/ })).toBeVisible();
});
