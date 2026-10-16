import type { Frame, Page } from '@playwright/test';
import { silentNarration } from './audio';
import {
	E2E_NOW,
	expect,
	expectNoViolations,
	openDevPanel,
	openPreferences,
	openReader,
	settled,
	showChrome,
	storedPreferences,
	switchPersona,
	test,
	visibleWords
} from './fixtures';
import { fakeSpeech, spoken } from './speech';

// Phase 1.13 Try-it list (IMPLEMENTATION-PLAN.md §6) and the acceptance of P1-RDR-12 and
// P1-LAY-09: a squeezed table opens full screen, unwrapped and readable, while swipes on the page
// still turn it; the sleep timer stops narration and the device voice after its minutes or at
// the end of the Chapter, the player shows what's left, and the last choice is remembered.
// Locking an Android phone's screen is on docs/device-checklist.md.

const reader = (page: Page) => page.getByTestId('reader');
const player = (page: Page) => page.getByTestId('narration-player');

async function bookFrame(page: Page): Promise<Frame> {
	await expect.poll(() => page.frames().some((f) => f.url().startsWith('blob:'))).toBe(true);
	return page.frames().find((f) => f.url().startsWith('blob:'))!;
}

/** The status-window fixture at 200% text, as P1-RDR-08 tests it. */
async function statusWindowAt200(page: Page) {
	await openDevPanel(page);
	await page.getByRole('button', { name: 'Import the status-window fixture' }).click();
	await page.getByRole('link', { name: 'Read now' }).click();
	await expect(reader(page)).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
	await openPreferences(page, 'Text');
	const size = page.getByRole('slider', { name: 'Text size' });
	await size.focus();
	for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
	await expect(size).toHaveAttribute('aria-valuetext', '200%');
	await page.keyboard.press('Escape');
	await settled(page);
}

/** Where the "Open table" button is on screen, in top-level coordinates, or null. */
function openTableOnScreen(frame: Frame) {
	return frame.evaluate(() => {
		const button = document.querySelector('[data-rd-table] button');
		const host = window.frameElement?.getBoundingClientRect();
		if (!button || !host) return null;
		const r = button.getBoundingClientRect();
		const x = host.left + r.left + r.width / 2;
		const y = host.top + r.top + r.height / 2;
		return x > 0 && x < window.top!.innerWidth && y > 0 && y < window.top!.innerHeight
			? { x, y }
			: null;
	});
}

/** Turns pages until the stat table's "Open table" button is on screen. */
async function pageToTable(page: Page) {
	const frame = await bookFrame(page);
	for (let i = 0; i < 12; i++) {
		if (await openTableOnScreen(frame)) return frame;
		await page.keyboard.press('ArrowRight');
		await settled(page);
	}
	throw new Error('The "Open table" button never came on screen');
}

test.describe('the table viewer on a small phone at 200%', () => {
	test.use({ viewport: { width: 360, height: 640 } });

	test('a squeezed table opens full screen, unwrapped and at the reader’s text size', async ({
		page
	}) => {
		await statusWindowAt200(page);
		const frame = await pageToTable(page);
		const onPage = await frame.evaluate(() => {
			const table = document.querySelector('table.stats')!;
			const cell = table.querySelector('td')!;
			return {
				fontSize: getComputedStyle(cell).fontSize,
				// The page breaks the words to fit: "Endurance" takes more than one line.
				lines: (() => {
					const range = document.createRange();
					range.selectNodeContents(table.querySelectorAll('td')[12]!);
					return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
				})(),
				// Only squeezed tables get the button: the status window's has it, and it's alone.
				rows: document.querySelectorAll('[data-rd-table]').length
			};
		});
		expect(onPage.lines).toBeGreaterThan(1);
		expect(onPage.rows).toBe(1);

		await frame.getByRole('button', { name: 'Open table' }).click();
		const viewer = page.getByRole('dialog', { name: 'Table' });
		await expect(viewer).toBeVisible();
		await expect(viewer.getByRole('table')).toContainText('Unspent points');
		const inViewer = await page.getByTestId('table-viewer').evaluate((el) => {
			const table = el.querySelector('table')!;
			const lines = [...table.querySelectorAll('th, td')].map((cell) => {
				const range = document.createRange();
				range.selectNodeContents(cell);
				return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
			});
			return {
				lines: Math.max(...lines),
				fontSize: getComputedStyle(table.querySelector('td')!).fontSize,
				headers: table.querySelectorAll('th').length,
				spans: table.querySelector('td[colspan="3"]') !== null,
				scripts: el.querySelectorAll('script, iframe, [onclick], a[href]').length
			};
		});
		// Every cell on one line: nothing broken, nothing hyphenated.
		expect(inViewer.lines).toBe(1);
		expect(inViewer.fontSize).toBe(onPage.fontSize);
		expect(inViewer.headers).toBe(4);
		expect(inViewer.spans).toBe(true);
		expect(inViewer.scripts).toBe(0);
		await expectNoViolations(page);

		// Zoom like the lightbox: buttons and double-tap.
		const stage = page.getByTestId('table-stage');
		await expect(stage).toHaveAttribute('data-zoom', '1.00');
		await viewer.getByRole('button', { name: 'Zoom in' }).click();
		await expect(stage).toHaveAttribute('data-zoom', '1.50');
		await viewer.getByRole('button', { name: 'Zoom out' }).click();
		await viewer.getByRole('button', { name: 'Zoom out' }).click();
		expect(Number(await stage.getAttribute('data-zoom'))).toBeLessThan(1);
		await stage.dblclick();
		await expect(stage).toHaveAttribute('data-zoom', '2.00');

		// Esc closes it, and the page is where it was.
		const before = await visibleWords(page);
		await page.keyboard.press('Escape');
		await expect(viewer).toBeHidden();
		expect((await visibleWords(page)).first).toBe(before.first);
	});

	test('the button opens with the keyboard, and the close button closes', async ({ page }) => {
		await statusWindowAt200(page);
		const frame = await pageToTable(page);
		await frame.getByRole('button', { name: 'Open table' }).focus();
		await page.keyboard.press('Enter');
		const viewer = page.getByRole('dialog', { name: 'Table' });
		await expect(viewer).toBeVisible();
		await viewer.getByRole('button', { name: 'Close' }).click();
		await expect(viewer).toBeHidden();
	});

	test('a swipe across the squeezed table still turns the page', async ({ page, browserName }) => {
		test.skip(browserName !== 'chromium', 'Touch input is sent through Chromium’s DevTools');
		await statusWindowAt200(page);
		const frame = await pageToTable(page);
		const table = await frame.evaluate(() => {
			const t = document.querySelector('table.stats')!;
			const host = window.frameElement!.getBoundingClientRect();
			const r = [...t.getClientRects()].find((c) => c.left + host.left >= 0)!;
			return {
				x: host.left + r.left + r.width / 2,
				y: host.top + r.top + Math.min(r.height / 2, 40),
				scrolls: t.scrollWidth > t.clientWidth
			};
		});
		// The table never scrolls sideways itself, so it can't take the swipe.
		expect(table.scrolls).toBe(false);
		const before = await visibleWords(page);
		const cdp = await page.context().newCDPSession(page);
		const at = (x: number) => [{ x, y: table.y }];
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: at(table.x + 100)
		});
		for (let i = 1; i <= 8; i++) {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: at(table.x + 100 - i * 25)
			});
		}
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await settled(page);
		expect((await visibleWords(page)).first).toBeGreaterThan(before.first);
		await expect(page.getByRole('dialog', { name: 'Table' })).toHaveCount(0);
	});
});

test.describe('the reader’s top bar on a phone', () => {
	test.use({ viewport: { width: 360, height: 640 } });

	test('search, pictures and preferences are under More, so the titles have room', async ({
		page
	}) => {
		await openReader(page, 'book-alice');
		await showChrome(page);
		const bar = page.getByRole('banner');
		await expect(bar.getByRole('button', { name: 'Bookmark this page' })).toBeVisible();
		await expect(bar.getByRole('button', { name: 'Contents and notes' })).toBeVisible();
		await expect(bar.getByRole('button', { name: 'Search in this book' })).toHaveCount(0);
		await expect(bar.getByRole('button', { name: 'Reading preferences' })).toHaveCount(0);
		expect((await page.getByTestId('chapter-title').boundingBox())!.width).toBeGreaterThan(100);

		await bar.getByRole('button', { name: 'More reading options' }).click();
		const menu = page.getByRole('menu');
		await expect(menu.getByRole('menuitem', { name: 'Search in this book' })).toBeVisible();
		await menu.getByRole('menuitem', { name: 'Reading preferences' }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading preferences' });
		await expect(sheet).toBeVisible();
		await expect.poll(() => sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
		// "/" still opens search.
		await page.keyboard.press('Slash');
		await expect(page.getByRole('searchbox', { name: 'Search in this book' })).toBeFocused();
	});
});

test('a table with room to spare has no “Open table” button', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await openDevPanel(page);
	await page.getByRole('button', { name: 'Import the status-window fixture' }).click();
	await page.getByRole('link', { name: 'Read now' }).click();
	await expect(reader(page)).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
	await settled(page);
	const frame = await bookFrame(page);
	await expect.poll(() => frame.evaluate(() => document.querySelectorAll('table').length)).toBe(1);
	expect(await frame.evaluate(() => document.querySelectorAll('[data-rd-table]').length)).toBe(0);
});

// ---- the sleep timer (P1-LAY-09) ----

test.describe('the sleep timer', () => {
	test.use({ viewport: { width: 1280, height: 800 }, fixedClock: false });

	/** The sleep timer's menu, in the player's full controls. */
	async function sleepMenu(page: Page) {
		const controls = page.getByTestId('narration-controls');
		if (!(await controls.isVisible())) {
			await player(page)
				.getByRole('button', { name: /^More .* controls$/ })
				.click();
		}
		await controls.getByRole('button', { name: /^Sleep timer/ }).click();
		return page.getByRole('menu');
	}

	async function toChapter(page: Page, title: RegExp) {
		await showChrome(page);
		await page.getByRole('button', { name: 'Contents and notes' }).click();
		await page.getByRole('button', { name: title }).click();
		await settled(page);
	}

	/** Alice's narration from Chapter I's second page, past the recording's introduction. */
	async function listenToChapterOne(page: Page) {
		await switchPersona(page, 'Author');
		await silentNarration(page);
		await openReader(page, 'book-alice');
		await toChapter(page, /Down the Rabbit-Hole/);
		await page.keyboard.press('ArrowRight');
		await settled(page);
		await showChrome(page);
		await page.getByRole('button', { name: 'Listen to the narration' }).click();
		await expect(player(page)).toHaveAttribute('data-playing', 'true');
	}

	/** The device voice reading Alice's Chapter IV (the Reader doesn't have the narration). */
	async function voiceInChapterFour(page: Page, where: 'start' | 'end') {
		await openReader(page, 'book-alice');
		await toChapter(page, /Rabbit Sends in a Little Bill/);
		if (where === 'end') {
			await page.keyboard.press('End');
			await settled(page);
		}
		await showChrome(page);
		await page.getByRole('button', { name: 'Read aloud with the device voice' }).click();
		await expect(player(page)).toHaveAttribute('data-kind', 'device');
	}

	test('narration stops after its minutes, fading out, and the choice is remembered', async ({
		page
	}) => {
		// The page's clock is Playwright's, so five minutes can pass at once.
		await page.clock.install({ time: E2E_NOW });
		await listenToChapterOne(page);

		// Off until the reader sets it.
		await player(page).getByRole('button', { name: 'More narration controls' }).click();
		await expect(page.getByTestId('sleep-timer')).toContainText('Sleep timer: Off');
		await expect(player(page).getByTestId('sleep-left')).toHaveCount(0);
		const menu = await sleepMenu(page);
		await expect(menu.getByRole('menuitem')).toHaveText([
			'5 minutes',
			'15 minutes',
			'30 minutes',
			'60 minutes',
			'End of chapter'
		]);
		await menu.getByRole('menuitem', { name: '5 minutes', exact: true }).click();
		await expect(page.getByTestId('sleep-timer')).toContainText('Sleep timer: 5 minutes');
		const left = player(page).getByTestId('sleep-left');
		await expect(left).toContainText(/^[45]:\d\d/);
		await expect(left).toContainText('Sleep timer: 5 minutes left');

		// Paused, the timer stands still: only listening time counts.
		await player(page).getByRole('button', { name: 'Pause narration' }).first().click();
		await expect(player(page)).not.toHaveAttribute('data-playing', 'true');
		// The time left shown once it has caught up with the pause (it's read once a second).
		let paused = Number(await left.getAttribute('data-left-ms'));
		await expect
			.poll(async () => {
				const before = paused;
				await page.waitForTimeout(1100);
				paused = Number(await left.getAttribute('data-left-ms'));
				return paused === before;
			})
			.toBe(true);
		await page.clock.fastForward('02:00');
		await expect
			.poll(async () => Number(await left.getAttribute('data-left-ms')))
			.toBeGreaterThan(paused - 2000);
		await player(page).getByRole('button', { name: 'Play narration' }).first().click();
		await expect(player(page)).toHaveAttribute('data-playing', 'true');

		await page.clock.fastForward('05:01');
		await expect(player(page)).not.toHaveAttribute('data-playing', 'true', { timeout: 10_000 });
		await expect(left).toHaveCount(0);
		await expect(page.getByTestId('sleep-timer')).toContainText('Sleep timer: Off');
		await expect
			.poll(() => storedPreferences(page, 'user-author'))
			.toMatchObject({ narration: { sleepTimer: 5 } });
		// The menu marks the last choice; nothing turns it on by itself.
		const again = await sleepMenu(page);
		await expect(again.getByRole('menuitem', { name: '5 minutes, as last time' })).toBeVisible();
		await page.keyboard.press('Escape');
	});

	test('“End of chapter” stops narration at the Chapter’s end, ready at the next', async ({
		page
	}) => {
		await listenToChapterOne(page);
		const menu = await sleepMenu(page);
		await menu.getByRole('menuitem', { name: 'End of chapter' }).click();
		await expect(player(page).getByTestId('sleep-left')).toContainText('End of chapter');
		// To the last seconds of Chapter I.
		const position = page.getByTestId('narration-controls').getByRole('slider');
		await position.focus();
		await page.keyboard.press('End');
		await expect(player(page)).not.toHaveAttribute('data-playing', 'true', { timeout: 15_000 });
		// Stopped, and ready at the start of Chapter II: play goes on from there.
		await expect(player(page)).toContainText('CHAPTER II. The Pool of Tears');
		await expect(player(page).getByTestId('narration-clock')).toContainText(/^0:00 \//);
		await expect(page.getByTestId('sleep-timer')).toContainText('Sleep timer: Off');
		await page.waitForTimeout(1000);
		await expect(player(page)).not.toHaveAttribute('data-playing', 'true');
	});

	test('the device voice finishes its sentence and stops at the end of the Chapter', async ({
		page
	}) => {
		await fakeSpeech(page, { wordMs: 4 });
		// From the last page of Chapter IV.
		await voiceInChapterFour(page, 'end');
		await player(page).getByRole('button', { name: 'Pause the device voice' }).first().click();
		const menu = await sleepMenu(page);
		await menu.getByRole('menuitem', { name: 'End of chapter' }).click();
		await expect(player(page).getByTestId('sleep-left')).toContainText('End of chapter');
		await player(page).getByRole('button', { name: 'Play the device voice' }).first().click();
		await expect(player(page)).not.toHaveAttribute('data-playing', 'true', { timeout: 15_000 });
		// Nothing of Chapter V was said; it waits at its start.
		const said = await spoken(page);
		expect(said.at(-1)?.text).not.toMatch(/Advice from a Caterpillar/i);
		await expect(player(page)).toContainText('CHAPTER V');
		await expect(page.getByTestId('sleep-timer')).toContainText('Sleep timer: Off');
	});

	test('the device voice stops after its minutes, at the end of a sentence', async ({ page }) => {
		await page.clock.install({ time: E2E_NOW });
		// Slow enough that a sentence outlasts the test's own steps, in real time.
		await fakeSpeech(page, { wordMs: 400 });
		await voiceInChapterFour(page, 'start');
		await expect(player(page)).toHaveAttribute('data-playing', 'true');
		const menu = await sleepMenu(page);
		await menu.getByRole('menuitem', { name: '15 minutes' }).click();
		await expect(player(page).getByTestId('sleep-left')).toContainText(/^1[45]:\d\d/);
		const before = (await spoken(page)).length;
		await page.clock.fastForward('15:01');
		await expect(player(page)).not.toHaveAttribute('data-playing', 'true', { timeout: 15_000 });
		await expect(page.getByTestId('sleep-timer')).toContainText('Sleep timer: Off');
		// It finished the sentence it was saying (unit-tested in platform/sleep.test.ts), no more.
		const said = (await spoken(page)).length;
		expect(said).toBeLessThanOrEqual(before + 1);
		await page.waitForTimeout(1000);
		expect((await spoken(page)).length).toBe(said);
	});
});
