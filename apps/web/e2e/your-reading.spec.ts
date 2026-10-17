import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
	E2E_NOW,
	expect,
	expectNoViolations,
	openReader,
	settled,
	showChrome,
	storedPreferences,
	storedRecords,
	test,
	visibleWords
} from './fixtures';
import { fakeSpeech } from './speech';

// Phase 1.16 Try-it list (IMPLEMENTATION-PLAN.md §6) and the acceptance of P1-RDR-14 and
// P1-RDR-15: time left starts from the stated pace and settles to a scripted reader's; it never
// shows while the device voice reads; You → Your reading shows the stats, and turning them off
// hides them and stops collecting, so the export has no new records. The page's clock is
// Playwright's, moved on as a reader at a set pace would take to read each page.

test.use({ viewport: { width: 1280, height: 800 }, fixedClock: false });

const timeLeft = (page: Page) => page.getByTestId('time-left');

/** Reads `pages` pages at `wpm` Words a minute, turning each with the keyboard. */
async function readPages(page: Page, pages: number, wpm: number) {
	for (let i = 0; i < pages; i++) {
		const { first, last } = await visibleWords(page);
		await page.clock.fastForward(Math.round(((last - first + 1) / wpm) * 60_000));
		await page.keyboard.press('ArrowRight');
		await settled(page);
	}
}

interface Day {
	readMs: number;
	listenedMs: number;
	words: number;
}

const totals = (days: Day[]) =>
	days.reduce(
		(sum, d) => ({
			readMs: sum.readMs + d.readMs,
			listenedMs: sum.listenedMs + d.listenedMs,
			words: sum.words + d.words
		}),
		{ readMs: 0, listenedMs: 0, words: 0 }
	);

test('time left starts from a typical pace and settles to the reader’s own', async ({ page }) => {
	test.slow();
	await page.clock.install({ time: E2E_NOW });
	await openReader(page, 'book-alice');
	await settled(page);
	await expect(timeLeft(page)).toHaveText(/^(\d+ min|Less than a minute) left in chapter$/);
	const before = await timeLeft(page).textContent();
	// The scrubber says it for the Book, to the screen reader and while dragging.
	await showChrome(page);
	await expect(page.getByRole('slider', { name: 'Position in book' })).toHaveAttribute(
		'aria-valuetext',
		/, .* left in book$/
	);

	// Ten minutes at 120 Words a minute, about half the typical pace.
	let read = 0;
	while (read < 10 * 60_000) {
		const { first, last } = await visibleWords(page);
		read += ((last - first + 1) / 120) * 60_000;
		await readPages(page, 1, 120);
	}
	await expect(timeLeft(page)).not.toHaveText(before!);
	// Leaving the reader saves the pace (P1-RDR-14: within a tenth of the reader's).
	await page.goto('/you');
	await expect
		.poll(async () => {
			const [pace] = await storedRecords<{ words: number; ms: number }>(
				page,
				'user-reader',
				'readingPace'
			);
			return pace ? (pace.words / pace.ms) * 60_000 : null;
		})
		.toBeGreaterThan(108);
	const [pace] = await storedRecords<{ words: number; ms: number }>(
		page,
		'user-reader',
		'readingPace'
	);
	expect((pace!.words / pace!.ms) * 60_000).toBeLessThan(132);
});

test('time left goes while the device voice reads, and the switch turns it off', async ({
	page
}) => {
	test.slow();
	await fakeSpeech(page, { wordMs: 200 });
	await page.goto('/book/treasure-island');
	await page.getByRole('button', { name: 'Add to library' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Add to library' }).click();
	await expect(page.getByTestId('checkout')).toContainText('is in your library');
	await openReader(page, 'book-treasure-island');
	await settled(page);
	await expect(timeLeft(page)).toBeVisible();
	await showChrome(page);
	await page.getByRole('button', { name: 'Read aloud with the device voice' }).click();
	await expect(page.getByTestId('narration-player')).toHaveAttribute('data-playing', 'true');
	await expect(timeLeft(page)).toHaveCount(0);
	await expect(page.getByRole('slider', { name: 'Position in book' })).not.toHaveAttribute(
		'aria-valuetext',
		/left in book/
	);

	await page.goto('/you/settings');
	await page.getByRole('switch', { name: 'Time left' }).click();
	await expect
		.poll(() => storedPreferences(page, 'user-reader'))
		.toMatchObject({ timeLeft: false });
	await openReader(page, 'book-treasure-island');
	await settled(page);
	await expect(timeLeft(page)).toHaveCount(0);
});

test('You → Your reading shows the stats; off, they’re gone and nothing new is kept', async ({
	page
}) => {
	test.slow();
	await page.clock.install({ time: E2E_NOW });
	await openReader(page, 'book-alice');
	await settled(page);
	// About six minutes at 150 Words a minute: a day for the streak.
	await readPages(page, 3, 150);
	await page.goto('/you');
	await page.getByRole('link', { name: /Your reading/ }).click();
	await expect(page.getByTestId('week-time')).toHaveText(/^\d+ min$/);
	await expect(page.getByTestId('week-words')).not.toHaveText('0');
	await expect(page.getByTestId('streak')).toContainText('1 day in a row');
	await expect(page.getByTestId('achievement')).toHaveCount(7);
	await expect(page.locator('[data-testid=achievement][data-earned=true]')).toHaveCount(0);
	await expectNoViolations(page);
	const kept = totals(await storedRecords<Day>(page, 'user-reader', 'readingDays'));
	expect(kept.readMs).toBeGreaterThan(5 * 60_000);

	await page.getByRole('switch', { name: 'Keep reading stats' }).click();
	await expect(page.getByTestId('reading-off')).toBeVisible();
	await expect(page.getByTestId('week-time')).toHaveCount(0);
	await page.goto('/you');
	await expect(page.getByRole('link', { name: /Your reading/ })).toContainText(
		'Reading stats are off'
	);

	// Reading on with them off keeps nothing new.
	await openReader(page, 'book-alice');
	await settled(page);
	await readPages(page, 2, 150);
	await page.goto('/you/data');
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export all data (JSON)' }).click();
	const data = JSON.parse(readFileSync(await (await download).path(), 'utf8')) as {
		readingDays: Day[];
	};
	expect(totals(data.readingDays)).toEqual(kept);
});
