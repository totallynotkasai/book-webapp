import type { Page, Request } from '@playwright/test';
import {
	expect,
	openPreferences,
	openReader,
	selectPhrase,
	settled,
	showChrome,
	test,
	visibleWords
} from './fixtures';

// Phase 1.19 (IMPLEMENTATION-PLAN.md §6): its Try-it items and the acceptance of P1-RDR-17
// (overview mode) and P1-RDR-18 (Define, D-043). Looking up a Word with the phone offline is
// also checked in the Android app (docs/device-checklist.md), which carries the whole dictionary.

const overview = (page: Page) => page.getByTestId('overview');
const thumbnails = (page: Page) => page.getByTestId('overview-page');

/** The page indicator's numbers: "Page 3 of 17". */
async function pageNumbers(page: Page) {
	const text = (await page.getByTestId('page-label').textContent()) ?? '';
	const [, index, count] = /Page (\d+) of (\d+)/.exec(text) ?? [];
	return { index: Number(index), count: Number(count) };
}

/** The Book's frames: the overview must not lay out anything new (P1-RDR-17, §9.2). */
const bookFrames = (page: Page) => page.frames().filter((f) => f.url().startsWith('blob:'));

async function openOverview(page: Page) {
	await showChrome(page);
	await page.getByTestId('page-label').click();
	await expect(overview(page)).toBeVisible();
}

test.describe('overview mode (P1-RDR-17)', () => {
	test('open the overview in a long Chapter and jump to a page, then Back', async ({ page }) => {
		await openReader(page, 'book-alice');
		const start = await visibleWords(page);
		const { count } = await pageNumbers(page);
		expect(count).toBeGreaterThan(4);
		const frames = bookFrames(page).map((f) => f.url());

		await openOverview(page);
		await expect(page.getByRole('dialog', { name: /^Pages of CHAPTER I/ })).toBeVisible();
		await expect(thumbnails(page)).toHaveCount(count);
		const here = thumbnails(page).nth(0);
		await expect(here).toHaveAttribute('aria-current', 'page');
		await expect(here).toBeFocused();
		await expect(here).toHaveAccessibleName(
			new RegExp(`^Page 1 of ${count}, where you are: “${start.word}`)
		);
		// Nothing new laid out: the same frame, the same Chapter, no other.
		expect(bookFrames(page).map((f) => f.url())).toEqual(frames);

		// Page 4 lands on its first Word.
		const fourth = thumbnails(page).nth(3);
		const first = Number(await fourth.getAttribute('data-first'));
		await fourth.click();
		await expect(overview(page)).toBeHidden();
		await settled(page);
		expect((await visibleWords(page)).first).toBe(first);
		expect(await pageNumbers(page)).toEqual({ index: 4, count });

		await page.getByRole('button', { name: 'Back', exact: true }).click();
		await settled(page);
		expect((await visibleWords(page)).first).toBe(start.first);
	});

	test('every page’s thumbnail lands on that page’s first Word, and shows it', async ({ page }) => {
		test.slow();
		await openReader(page, 'book-alice');
		const { count } = await pageNumbers(page);
		for (const index of [1, Math.floor(count / 2), count - 1]) {
			await openOverview(page);
			const thumb = thumbnails(page).nth(index);
			await thumb.scrollIntoViewIfNeeded();
			const first = Number(await thumb.getAttribute('data-first'));
			// The thumbnail is drawn from the page: its text starts with the page's first Word.
			await expect(thumb.locator('.line').first()).toBeAttached();
			const drawn = (await thumb.locator('.page').innerText()).replace(/\s+/g, ' ');
			await thumb.click();
			await settled(page);
			const now = await visibleWords(page);
			expect(now.first).toBe(first);
			expect(drawn).toContain(now.word);
			expect((await pageNumbers(page)).index).toBe(index + 1);
		}
	});

	test('keyboard: O opens it, arrows move, Enter goes, Esc closes', async ({ page }) => {
		await openReader(page, 'book-alice');
		const start = await visibleWords(page);
		await page.keyboard.press('o');
		await expect(overview(page)).toBeVisible();
		await expect(thumbnails(page).nth(0)).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(overview(page)).toBeHidden();
		expect((await visibleWords(page)).first).toBe(start.first);

		await page.keyboard.press('o');
		await expect(thumbnails(page).nth(0)).toBeFocused();
		const count = await thumbnails(page).count();
		await page.keyboard.press('End');
		await expect(thumbnails(page).nth(count - 1)).toBeFocused();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowRight');
		await expect(thumbnails(page).nth(1)).toBeFocused();
		// Four to a row on a desktop: down is four pages on, up four back.
		await page.keyboard.press('ArrowDown');
		await expect(thumbnails(page).nth(5)).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowRight');
		const target = thumbnails(page).nth(2);
		await expect(target).toBeFocused();
		const first = Number(await target.getAttribute('data-first'));
		await page.keyboard.press('Enter');
		await expect(overview(page)).toBeHidden();
		await settled(page);
		expect((await visibleWords(page)).first).toBe(first);
		expect((await pageNumbers(page)).index).toBe(3);
	});

	test('on a phone, two to a row; a tap goes there', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 740 });
		await openReader(page, 'book-alice');
		await openOverview(page);
		const [a, b, c] = await Promise.all(
			[0, 1, 2].map((i) => thumbnails(page).nth(i).boundingBox())
		);
		expect(Math.abs(a!.y - b!.y)).toBeLessThan(1);
		expect(c!.y).toBeGreaterThan(a!.y + a!.height);
		const second = thumbnails(page).nth(1);
		const first = Number(await second.getAttribute('data-first'));
		await second.click();
		await settled(page);
		expect((await visibleWords(page)).first).toBe(first);
	});

	test('the pages follow a new layout while it’s open', async ({ page }) => {
		await openReader(page, 'book-alice');
		await openOverview(page);
		const spreads = await thumbnails(page).count();
		// Under 1024 px wide a page is no longer a spread: about twice as many pages.
		await page.setViewportSize({ width: 800, height: 720 });
		await expect.poll(() => thumbnails(page).count()).toBeGreaterThan(spreads);
		const { count } = await pageNumbers(page);
		await expect(thumbnails(page)).toHaveCount(count);
		await expect(thumbnails(page).nth(0).locator('.line').first()).toBeAttached();
		await expect(thumbnails(page).nth(1).locator('.line').first()).toBeAttached();
	});

	test('scrolling has no pages, so no overview', async ({ page }) => {
		await openReader(page, 'book-alice');
		await openPreferences(page, 'Page');
		await page.getByRole('radio', { name: 'Scroll' }).click();
		await page.keyboard.press('Escape');
		await settled(page);
		await expect(page.getByTestId('page-label')).toHaveText(/%$/);
		await expect(page.getByRole('button', { name: /Show the chapter’s pages/ })).toHaveCount(0);
		await page.keyboard.press('o');
		await expect(overview(page)).toHaveCount(0);
	});
});

/** Every request the page makes, to check nothing about a look-up leaves the device. */
function recordRequests(page: Page): Request[] {
	const requests: Request[] = [];
	page.on('request', (r) => requests.push(r));
	return requests;
}

/** Finds a passage on the page and double-clicks one Word in it, as a reader would. */
async function doubleClickWord(page: Page, passage: string, word: string) {
	await expect(page.getByRole('dialog')).toHaveCount(0);
	const frame = bookFrames(page)[0]!;
	const point = await frame.evaluate(
		([text, target]) => {
			const host = window.frameElement!.getBoundingClientRect();
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text) {
				const at = node.data.indexOf(text!);
				if (at < 0) continue;
				const range = document.createRange();
				const start = at + text!.indexOf(target!);
				range.setStart(node, start);
				range.setEnd(node, start + target!.length);
				const r = range.getBoundingClientRect();
				if (r.left + host.left < 0 || r.left + host.left > window.top!.innerWidth) continue;
				return { x: host.left + r.left + r.width / 2, y: host.top + r.top + r.height / 2 };
			}
			throw new Error(`“${text}” isn’t on screen`);
		},
		[passage, word]
	);
	await page.mouse.dblclick(point.x, point.y);
	await expect(page.getByRole('toolbar', { name: 'Selection' })).toBeVisible();
}

/** Searches the Book and goes to the first result. */
async function goToText(page: Page, text: string) {
	await page.keyboard.press('/');
	const field = page.getByRole('searchbox', { name: 'Search in this book' });
	await field.fill(text);
	await expect(page.getByTestId('search-status')).toHaveText(/^1 result/);
	await field.press('Enter');
	await expect(page.getByRole('dialog', { name: 'Search in this book' })).toBeHidden();
	await settled(page);
}

const card = (page: Page) => page.getByTestId('define-card');

test.describe('Define (P1-RDR-18)', () => {
	test('look up “antipathies” in Chapter I of Alice, offline, from the app’s own files', async ({
		page
	}) => {
		await openReader(page, 'book-alice');
		await goToText(page, 'The Antipathies');
		// The simulated backend is offline: Define never asks it.
		await page.evaluate(() => (globalThis.__BOOK_E2E_SIMULATION__!.offline = true));
		const requests = recordRequests(page);
		await selectPhrase(page, 'Antipathies');
		await page.getByRole('button', { name: 'Define' }).click();
		const dialog = page.getByRole('dialog', { name: 'Antipathies' });
		await expect(card(page)).toContainText('a feeling of intense dislike');
		await expect(dialog.getByRole('heading', { name: 'antipathy' })).toBeVisible();
		await expect(card(page)).toContainText('noun');
		await expect(card(page)).toContainText('/ænˈtɪpəθi/');
		await expect(card(page)).toContainText('From Open English WordNet 2025 (CC BY 4.0)');
		// The Word never left the device: only the app's own dictionary files were read.
		const origin = new URL(page.url()).origin;
		const looked = requests.filter((r) => !r.url().startsWith('blob:'));
		expect(looked.length).toBeGreaterThan(0);
		for (const request of looked) {
			expect(request.url().startsWith(`${origin}/`)).toBe(true);
			expect(request.url()).not.toMatch(/antipath/i);
		}
		expect(looked.some((r) => r.url().includes('/dictionary/oewn-2025/'))).toBe(true);
		await dialog.getByRole('button', { name: 'Close' }).click();
		await expect(dialog).toBeHidden();
	});

	test('with the network gone, what was read still works; the rest says why', async ({
		page,
		context
	}) => {
		await openReader(page, 'book-alice');
		await goToText(page, 'The Antipathies');
		await selectPhrase(page, 'Antipathies');
		await page.getByRole('button', { name: 'Define' }).click();
		await expect(card(page)).toContainText('a feeling of intense dislike');
		await page.keyboard.press('Escape');

		await context.setOffline(true);
		await selectPhrase(page, 'Antipathies');
		await page.getByRole('button', { name: 'Define' }).click();
		await expect(card(page)).toContainText('a feeling of intense dislike');
		await page.keyboard.press('Escape');

		// "Latitude" is in a part of the dictionary not read yet: on the web it needs the network
		// the first time (the Android app has all of it).
		await goToText(page, 'what Latitude or Longitude');
		await selectPhrase(page, 'Latitude');
		await page.getByRole('button', { name: 'Define' }).click();
		await expect(page.getByRole('alert')).toHaveText(
			'The dictionary couldn’t open. Check your connection and try again.'
		);
		await context.setOffline(false);
		await page.getByRole('button', { name: 'Try again' }).click();
		await expect(card(page)).toContainText('the angular distance between an imaginary line');
	});

	test('a Word it hasn’t got offers Wiktionary, which sees it only on a tap', async ({ page }) => {
		await openReader(page, 'book-alice');
		await goToText(page, 'Dinah was the cat');
		const requests = recordRequests(page);
		await doubleClickWord(page, '(Dinah was', 'Dinah');
		await page.getByRole('button', { name: 'Define' }).click();
		await expect(card(page)).toContainText('“Dinah” isn’t in the dictionary on this device.');
		const link = page.getByRole('link', { name: 'Look up on Wiktionary' });
		await expect(link).toHaveAttribute('href', 'https://en.wiktionary.org/wiki/Dinah');
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(link).toHaveAccessibleDescription(
			'Opens Wiktionary on the web, which will see the word.'
		);
		expect(requests.filter((r) => r.url().includes('wiktionary'))).toEqual([]);

		await page
			.context()
			.route('https://en.wiktionary.org/**', (route) =>
				route.fulfill({ contentType: 'text/html', body: '<title>Dinah</title>' })
			);
		const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
		expect(popup.url()).toBe('https://en.wiktionary.org/wiki/Dinah');
	});

	test('only for one Word: not for a phrase', async ({ page }) => {
		await openReader(page, 'book-alice');
		await selectPhrase(page, 'Alice was beginning');
		await expect(page.getByRole('button', { name: 'Share quote' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Define' })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await doubleClickWord(page, 'beginning to get very tired', 'tired');
		await page.getByRole('button', { name: 'Define' }).click();
		await expect(page.getByRole('dialog', { name: 'tired' })).toBeVisible();
		await expect(card(page)).toContainText('adjective');
	});
});
