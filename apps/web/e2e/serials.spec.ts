import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { serialWithNextChapter } from '../src/lib/library/test-books';
import {
	E2E_NOW,
	expect,
	expectNoViolations,
	openDevPanel,
	settled,
	showChrome,
	switchPersona,
	test
} from './fixtures';

// Phase 1.15 Try-it list (IMPLEMENTATION-PLAN.md §6) and P1-STU-06's acceptance: as the Author,
// upload the Ledger with a seventh Chapter and schedule it for tomorrow; as the Reader, follow
// the Author: the Chapter is locked with its day, the Book page says when; move the dev clock a
// day: one inbox message arrives and the Chapter opens (for a subscriber, since early access
// still applies: the newest Chapter is early access at first).

test.use({ viewport: { width: 1280, height: 800 } });

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LEDGER = 'book-lamplighters-ledger';
const NEXT_VERSION = serialWithNextChapter(
	new Uint8Array(
		readFileSync(join(ROOT, 'apps/web/static/demo/books/the-lamplighters-ledger.epub'))
	),
	readFileSync(join(ROOT, 'fixtures/src/lamplighters-ledger-next/chapter-7.xhtml'), 'utf8')
);

const dialog = (page: Page) => page.getByRole('dialog');

/** `<input type="datetime-local">`'s value for a time, in this machine's zone (the browser's). */
function localInput(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
		date.getHours()
	)}:${pad(date.getMinutes())}`;
}

/** As the Author: uploads the Ledger's next version and waits until it's processed. */
async function uploadNextVersion(page: Page) {
	await switchPersona(page, 'Author');
	await page.goto(`/studio/books/${LEDGER}`);
	await page.getByRole('button', { name: 'Upload a new version' }).click();
	await dialog(page)
		.locator('input[type=file]')
		.setInputFiles({
			name: 'the-lamplighters-ledger-chapter-7.epub',
			mimeType: 'application/epub+zip',
			buffer: Buffer.from(NEXT_VERSION)
		});
	await dialog(page).getByRole('button', { name: 'Upload' }).click();
	await expect(page.getByTestId('revision').first()).toHaveAttribute('data-state', 'ready', {
		timeout: 30_000
	});
}

async function publish(page: Page) {
	await page.getByRole('button', { name: 'Publish…' }).click();
	// The Ledger is AI-generated (D-023): the answer starts from the Book's.
	await expect(dialog(page).getByRole('radio', { name: 'AI-generated' })).toBeChecked();
	await dialog(page).getByRole('button', { name: 'Publish version' }).click();
	await expect(page.getByText(/^Published/)).toBeVisible();
}

/** As the Reader: buys the Ledger, follows its author and subscribes (all simulated). */
async function readerFollowsAndSubscribes(page: Page) {
	await switchPersona(page, 'Reader');
	await page.goto('/book/the-lamplighters-ledger');
	await page.getByRole('button', { name: 'Buy · £3.99' }).click();
	await dialog(page)
		.getByRole('button', { name: /^Pay .* \(simulated\)$/ })
		.click();
	await expect(dialog(page).getByRole('link', { name: 'Read now' })).toBeVisible();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Subscribe' }).first().click();
	await page.getByRole('button', { name: 'Subscribe · £3.00 a month' }).click();
	await expect(page.getByTestId('subscribe-sheet')).toContainText('Early access is open now');
	await page.goto('/creator/wren-ashdown');
	await page.getByRole('button', { name: 'Follow' }).click();
	await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
}

test('the Author schedules the seventh chapter for tomorrow; a day later the Reader is told and reads it', async ({
	page
}) => {
	test.slow();
	await uploadNextVersion(page);
	const rows = page.getByTestId('chapter-release');
	await expect(rows).toHaveCount(1);
	await expect(rows).toContainText('7. The Night Round');
	await expect(rows).toContainText('Comes out with this version');
	await rows.getByRole('button', { name: 'When “7. The Night Round” comes out' }).click();
	await expect(dialog(page)).toContainText('When does “7. The Night Round” come out?');
	await expectNoViolations(page);
	// Tomorrow, a little before this time: one day on the dev clock is past it.
	const tomorrow = new Date(E2E_NOW.getTime() + 20 * 60 * 60 * 1000);
	await dialog(page).getByRole('textbox', { name: 'Day and time' }).fill(localInput(tomorrow));
	await dialog(page).getByRole('button', { name: 'Schedule' }).click();
	await expect(page.getByText(/^“7\. The Night Round” comes out /)).toBeVisible();
	await expect(rows).toHaveAttribute('data-state', 'scheduled');
	await publish(page);
	// The version readers have now lists the Chapter still to come.
	await expect(page.getByTestId('chapters-to-come')).toContainText('Chapters to come');

	await readerFollowsAndSubscribes(page);
	// In the browser's own locale, as the app writes it.
	const day = await page.evaluate(
		(iso) =>
			new Date(iso).toLocaleDateString(undefined, {
				weekday: 'long',
				day: 'numeric',
				month: 'long'
			}),
		tomorrow.toISOString()
	);
	await page.goto('/book/the-lamplighters-ledger');
	await expect(page.getByTestId('next-chapter')).toHaveText(`Next chapter: ${day}`, {
		useInnerText: true
	});
	await page.goto(`/read/${LEDGER}`);
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await expect(
		page.getByRole('button', { name: new RegExp(`7\\. The Night Round.*Out ${day}`) })
	).toBeVisible();
	await page.keyboard.press('Escape');
	await page.goto('/you/inbox');
	await expect(page.getByTestId('inbox-message')).toHaveCount(0);

	// A day on: it's out, and the Reader hears once.
	await openDevPanel(page);
	await page.getByRole('button', { name: '+1 day' }).click();
	await expect(page.getByText('(1 days ahead)')).toBeVisible();
	await page.goto('/you');
	await page.goto('/you/inbox');
	const message = page.getByTestId('inbox-message');
	await expect(message).toHaveCount(1);
	await expect(message).toContainText("New chapter of The Lamplighter's Ledger");
	await expect(message).toContainText('“7. The Night Round”');
	await page.goto('/book/the-lamplighters-ledger');
	await expect(page.getByTestId('next-chapter')).toHaveCount(0);
	await page.goto('/you/inbox');
	await expect(page.getByTestId('inbox-message')).toHaveCount(1);
	await page.getByRole('link', { name: 'Read it' }).click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await settled(page);
	await expect(page.getByTestId('chapter-title')).toHaveText('7. The Night Round');
});

test('a reader without the Book’s early access sees the scheduled chapter, then early access', async ({
	page
}) => {
	test.slow();
	await uploadNextVersion(page);
	await page
		.getByTestId('chapter-release')
		.getByRole('button', { name: 'When “7. The Night Round” comes out' })
		.click();
	await dialog(page)
		.getByRole('textbox', { name: 'Day and time' })
		.fill(localInput(new Date(E2E_NOW.getTime() + 20 * 60 * 60 * 1000)));
	await dialog(page).getByRole('button', { name: 'Schedule' }).click();
	await expect(page.getByTestId('chapter-release')).toHaveAttribute('data-state', 'scheduled');
	await publish(page);

	await switchPersona(page, 'Reader');
	await page.goto('/book/the-lamplighters-ledger');
	await page.getByRole('button', { name: 'Buy · £3.99' }).click();
	await dialog(page)
		.getByRole('button', { name: /^Pay .* \(simulated\)$/ })
		.click();
	await dialog(page).getByRole('link', { name: 'Read now' }).click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	// Chapters 5 and 6 are early access, and the Chapter to come is last, with its day.
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await expect(
		page.getByRole('button', { name: /6\. Balancing the Ledger.*Early access/ })
	).toBeVisible();
	await expect(page.getByRole('button', { name: /7\. The Night Round.*Out / })).toBeVisible();
	await page.keyboard.press('Escape');

	// Out a day later: the newest two Chapters are early access, so 5 is free and 7 waits.
	await openDevPanel(page);
	await page.getByRole('button', { name: '+1 day' }).click();
	await expect(page.getByText('(1 days ahead)')).toBeVisible();
	// The Reader doesn't follow Wren Ashdown, so no message.
	await page.goto('/you/inbox');
	await expect(page.getByText('Nothing here yet')).toBeVisible();
	await page.goto(`/read/${LEDGER}`);
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await expect(
		page.getByRole('button', { name: /7\. The Night Round.*Early access/ })
	).toBeVisible();
	await expect(page.getByRole('button', { name: /5\. The Lamp That Remembers/ })).not.toContainText(
		'Early access'
	);
});
