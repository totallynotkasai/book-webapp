import type { CDPSession, Page, TestInfo } from '@playwright/test';
import { silentNarration } from './audio';
import { bigEpub } from './books';
import {
	expect,
	openPreferences,
	openReader,
	settled,
	showChrome,
	switchPersona,
	test,
	visibleWords
} from './fixtures';

// P1-QA-01: DESIGN.md §12.3's budgets at phone speed. Chromium's CPU is slowed PERF_CPU times
// (default 4×, the usual stand-in for a 2023–24 mid-range phone such as a Galaxy A15 next to a
// desktop) and, for the cold open, the network is a 4G link. Throttling doesn't reach Web
// Workers, so steps that process an EPUB also report a figure with the worker slowed as much. Run with `npm run test:perf`; the
// numbers go in docs/perf/p1-qa-01.md. Not part of CI: timings on shared runners are too noisy
// for a pass/fail line, so CI checks the JavaScript budget and the import time instead.

const CPU = Number(process.env.PERF_CPU ?? 4);
// 4G, as Lighthouse and WebPageTest model it: 9 Mbit/s down, 1.5 up, 170 ms round trip.
const FOUR_G = {
	latency: 170,
	downloadThroughput: (9e6 / 8) | 0,
	uploadThroughput: (1.5e6 / 8) | 0
};

test.use({
	viewport: { width: 412, height: 915 },
	deviceScaleFactor: 2.625,
	hasTouch: true,
	fixedClock: false,
	// An Android phone, as the page curl sees it (it draws without multisampling there, D-045).
	userAgent:
		'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
});

async function throttle(page: Page, network = false): Promise<CDPSession> {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
	if (network) {
		await cdp.send('Network.enable');
		await cdp.send('Network.emulateNetworkConditions', { offline: false, ...FOUR_G });
	}
	return cdp;
}

function record(testInfo: TestInfo, measure: string, value: string, budget: string) {
	testInfo.annotations.push({ type: measure, description: `${value} (budget ${budget})` });
	console.log(`[${CPU}× CPU] ${measure}: ${value} (budget ${budget})`);
}

/**
 * CDP's CPU throttling slows the page but not its Web Workers, where the EPUB is processed. So
 * the import worker's own time (`pipeline:ingest`, measured from the page) is added again
 * CPU − 1 times: what the step would take if the worker were as slow as the page.
 */
async function withSlowWorker(page: Page, elapsed: number) {
	const worker = await page.evaluate(() =>
		performance.getEntriesByName('pipeline:ingest').reduce((sum, e) => sum + e.duration, 0)
	);
	return {
		measured: elapsed,
		worker: Math.round(worker),
		scaled: Math.round(elapsed + (CPU - 1) * worker)
	};
}

const stats = (samples: number[]) => {
	const sorted = [...samples].sort((a, b) => a - b);
	const at = (q: number) =>
		Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!);
	return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) };
};

// Three runs, each in a new browser context, so each open is cold.
for (const run of [1, 2, 3]) {
	test(`open a Book to its first readable page, cold, over 4G (< 2 s), run ${run}`, async ({
		page
	}, testInfo) => {
		await page.goto('/library');
		await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
		await page.waitForLoadState('networkidle');
		await throttle(page, true);
		// Timed in the page, from the tap to the first page's Words being reported.
		await page.evaluate(() => {
			(window as unknown as { __open: Promise<number> }).__open = new Promise((done) => {
				let tapped = 0;
				addEventListener('click', () => (tapped ||= performance.now()), { capture: true });
				const observer = new MutationObserver(() => {
					const reader = document.querySelector<HTMLElement>('[data-testid="reader"]');
					if (reader?.dataset.ready && reader.dataset.first) {
						observer.disconnect();
						requestAnimationFrame(() => done(performance.now() - tapped));
					}
				});
				observer.observe(document.body, { subtree: true, childList: true, attributes: true });
			});
		});
		await page
			.getByRole('link', { name: /Alice's Adventures in Wonderland/ })
			.first()
			.click();
		const elapsed = Math.round(
			await page.evaluate(() => (window as unknown as { __open: Promise<number> }).__open)
		);
		const times = await withSlowWorker(page, elapsed);
		record(testInfo, `cold open, Alice (run ${run})`, JSON.stringify(times), '2000 ms');
		expect(times.scaled).toBeLessThan(2000);
	});
}

test('open a cached 10,000-word Chapter (< 1 s)', async ({ page }, testInfo) => {
	await page.goto('/library');
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Import EPUB' }).first().click();
	await (
		await chooser
	).setFiles({
		name: 'long-chapters.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(bigEpub({ chapters: 4, wordsPerChapter: 10_000, title: 'Long chapters' }))
	});
	await page.getByRole('dialog').getByRole('link', { name: 'Read now' }).click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await settled(page);
	await throttle(page);
	const samples: number[] = [];
	for (const n of [3, 2, 4]) {
		await showChrome(page);
		await page.getByRole('button', { name: 'Contents and notes' }).click();
		const started = Date.now();
		await page.getByRole('button', { name: `Chapter ${n}`, exact: true }).click();
		await expect(page.getByTestId('chapter-title')).toHaveText(`Chapter ${n}`, {
			timeout: 10_000
		});
		await expect(page.getByTestId('reader')).toHaveAttribute('data-first', /\d+/);
		samples.push(Date.now() - started);
		await settled(page);
	}
	record(testInfo, 'cached 10,000-word Chapter', JSON.stringify(stats(samples)), '1000 ms');
	expect(stats(samples).max).toBeLessThan(1000);
});

test('the overview of a 10,000-word Chapter, drawn on screen (< 1 s)', async ({
	page
}, testInfo) => {
	// P1-RDR-17: no budget of its own in §12.3, so a cached Chapter's (it lays nothing out).
	await page.goto('/library');
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Import EPUB' }).first().click();
	await (
		await chooser
	).setFiles({
		name: 'long-chapters.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(bigEpub({ chapters: 2, wordsPerChapter: 10_000, title: 'Long chapters' }))
	});
	await page.getByRole('dialog').getByRole('link', { name: 'Read now' }).click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await settled(page);
	// Loaded once first: the measure is opening it, not downloading its code.
	await showChrome(page);
	await page.getByTestId('page-label').click();
	await expect(page.getByTestId('overview')).toBeVisible();
	await page.keyboard.press('Escape');
	await throttle(page);
	const samples: number[] = [];
	for (let i = 0; i < 3; i++) {
		await showChrome(page);
		const started = Date.now();
		await page.getByTestId('page-label').click();
		const thumbs = page.getByTestId('overview-page');
		for (const n of [0, 1, 2, 3])
			await expect(thumbs.nth(n).locator('.line').first()).toBeAttached();
		samples.push(Date.now() - started);
		const count = await thumbs.count();
		expect(count).toBeGreaterThan(30);
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('overview')).toBeHidden();
	}
	record(testInfo, 'overview, 10,000-word Chapter', JSON.stringify(stats(samples)), '1000 ms');
	expect(stats(samples).max).toBeLessThan(1000);
});

test('page turn, input to first frame (< 100 ms)', async ({ page }, testInfo) => {
	await openReader(page, 'book-alice');
	await settled(page);
	await throttle(page);
	// Event Timing: from the key press to the next frame painted after its handlers.
	await page.evaluate(() => {
		const w = window as unknown as { __turns: number[] };
		w.__turns = [];
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (entry.name === 'keydown') w.__turns.push(entry.duration);
			}
		}).observe({
			type: 'event',
			durationThreshold: 16,
			buffered: false
		} as PerformanceObserverInit);
	});
	for (let i = 0; i < 12; i++) {
		await page.keyboard.press('ArrowRight');
		await page.waitForTimeout(600);
	}
	await page.waitForTimeout(500);
	// Turns faster than 16 ms aren't reported at all, so they count as 16.
	const reported = await page.evaluate(() => (window as unknown as { __turns: number[] }).__turns);
	const samples = [...reported, ...Array(Math.max(0, 12 - reported.length)).fill(16)];
	record(testInfo, 'page turn', JSON.stringify(stats(samples)), '100 ms');
	expect(stats(samples).p95).toBeLessThan(100);
});

test('page curl: input to first frame (< 100 ms), holding 60 fps', async ({ page }, testInfo) => {
	await openReader(page, 'book-alice');
	await openPreferences(page, 'Page');
	await page
		.getByRole('radiogroup', { name: 'Page turns' })
		.getByRole('radio', { name: 'Curl' })
		.click();
	await page.keyboard.press('Escape');
	await settled(page);
	const cdp = await throttle(page);
	// Event Timing, as for a plain turn: the curl's first frame is drawn in the key's own task
	// (the paginator moves, the curl starts over it), so it's in the next paint. And every frame
	// while the curl is on screen, from the page's own frame clock.
	await page.evaluate(() => {
		const w = window as unknown as { __turns: number[]; __frames: number[] };
		w.__turns = [];
		w.__frames = [];
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (entry.name === 'keydown') w.__turns.push(entry.duration);
			}
		}).observe({
			type: 'event',
			durationThreshold: 16,
			buffered: false
		} as PerformanceObserverInit);
		const curl = () => document.querySelector<HTMLElement>('canvas[data-page-curl]');
		let last = 0;
		const frame = (now: number) => {
			const on = curl()?.style.visibility === 'visible';
			if (on && last) w.__frames.push(now - last);
			last = on ? now : 0;
			requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
	});
	const turnPages = async (n: number) => {
		await page.evaluate(() => {
			const w = window as unknown as { __turns: number[]; __frames: number[] };
			w.__turns = [];
			w.__frames = [];
		});
		for (let i = 0; i < n; i++) {
			await page.keyboard.press('ArrowRight');
			await page.waitForTimeout(900);
		}
		return page.evaluate(() => {
			const w = window as unknown as { __turns: number[]; __frames: number[] };
			return { turns: w.__turns, frames: w.__frames };
		});
	};
	const slow = (frames: number[]) => frames.filter((ms) => ms > 1000 / 60 + 4).length;
	const slowed = await turnPages(12);
	const samples = [...slowed.turns, ...Array(Math.max(0, 12 - slowed.turns.length)).fill(16)];
	// Where a turn's time goes: picturing the page (while the reader reads, mostly), uploading
	// it, drawing a frame.
	for (const step of ['capture', 'upload', 'draw']) {
		const ms = await page.evaluate(
			(name) => performance.getEntriesByName(`page-curl:${name}`).map((e) => e.duration),
			step
		);
		record(testInfo, `page curl: ${step}`, JSON.stringify(stats(ms)), '-');
	}
	record(testInfo, 'page curl: input to first frame', JSON.stringify(stats(samples)), '100 ms');
	record(
		testInfo,
		'page curl: frame intervals',
		`${JSON.stringify(stats(slowed.frames))}, ${slow(slowed.frames)} of ${slowed.frames.length} over 20.7 ms`,
		'60 fps (not checked when slowed)'
	);
	// The frame rate is checked at full speed: headless Chromium draws WebGL with SwiftShader, on
	// the CPU the slowdown slows, where a phone draws it on its GPU (at a quarter of the pixels the
	// slowed curl holds 60 fps too). The Android app's figures come from scripts/perf-android.mjs
	// --curl (the plan's Phase 1.21 notes).
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
	const full = await turnPages(6);
	record(
		testInfo,
		'page curl: frame intervals at 1×',
		`${JSON.stringify(stats(full.frames))}, ${slow(full.frames)} of ${full.frames.length} over 20.7 ms`,
		'60 fps'
	);
	expect(slowed.frames.length).toBeGreaterThan(12 * 10);
	expect(stats(samples).p95).toBeLessThan(100);
	expect(stats(full.frames).p95).toBeLessThan(1000 / 60 + 4);
});

test('re-layout after a typography change, first visible Word kept (< 300 ms)', async ({
	page
}, testInfo) => {
	await openReader(page, 'book-alice');
	for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
	await settled(page);
	await throttle(page);
	const samples: number[] = [];
	let kept = true;
	for (const key of ['Control+Equal', 'Control+Equal', 'Control+Minus', 'Control+0']) {
		const before = await visibleWords(page);
		// From the key press to the last change of the visible range: the new layout is done.
		await page.evaluate(() => {
			const reader = document.querySelector<HTMLElement>('[data-testid="reader"]')!;
			(window as unknown as { __relayout: Promise<number> }).__relayout = new Promise((done) => {
				let pressed = 0;
				let changed = 0;
				addEventListener('keydown', () => (pressed = performance.now()), {
					capture: true,
					once: true
				});
				const observer = new MutationObserver(() => (changed = performance.now()));
				observer.observe(reader, {
					attributeFilter: ['data-first', 'data-last', 'data-first-word']
				});
				setTimeout(() => {
					observer.disconnect();
					done(pressed && changed ? changed - pressed : -1);
				}, 2500);
			});
		});
		await page.keyboard.press(key);
		const ms = await page.evaluate(
			() => (window as unknown as { __relayout: Promise<number> }).__relayout
		);
		if (ms >= 0) samples.push(ms);
		await settled(page);
		const after = await visibleWords(page);
		kept &&= after.first <= before.first && before.first <= after.last;
	}
	record(
		testInfo,
		're-layout after a text size change',
		`${JSON.stringify(stats(samples))}, first Word kept: ${kept}`,
		'300 ms'
	);
	expect(kept).toBe(true);
});

test('narration highlight lag (< 100 ms)', async ({ page }, testInfo) => {
	// The Author holds every Layer of the catalogue Alice, narration included.
	await switchPersona(page, 'Author');
	await page.addInitScript(() => {
		const play = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function () {
			(window as unknown as { __narration: HTMLMediaElement }).__narration = this;
			return play.call(this);
		};
	});
	await silentNarration(page);
	await openReader(page, 'book-alice');
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await page.getByRole('button', { name: /Down the Rabbit-Hole/ }).click();
	await settled(page);
	await page.keyboard.press('ArrowRight');
	await settled(page);
	await throttle(page);
	await showChrome(page);
	await page.getByRole('button', { name: 'Listen to the narration' }).click();
	await expect
		.poll(async () => Number(await page.getByTestId('reader').getAttribute('data-narrated')), {
			timeout: 20_000
		})
		.toBeGreaterThan(0);
	const samples = await page.evaluate(async () => {
		const audio = (window as unknown as { __narration: HTMLMediaElement }).__narration;
		const reader = document.querySelector<HTMLElement>('[data-testid="reader"]')!;
		const lags: number[] = [];
		const observer = new MutationObserver(() => {
			const start = Number(reader.dataset.narratedStart);
			if (!audio.paused && Number.isFinite(start)) lags.push(audio.currentTime * 1000 - start);
		});
		observer.observe(reader, { attributeFilter: ['data-narrated'] });
		await new Promise((r) => setTimeout(r, 10_000));
		observer.disconnect();
		return lags;
	});
	record(testInfo, 'narration highlight lag', JSON.stringify(stats(samples)), '100 ms');
	expect(stats(samples).p95).toBeLessThan(100);
});

test('import a 150,000-word EPUB (< 10 s)', async ({ page }, testInfo) => {
	await page.goto('/library');
	await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
	await throttle(page);
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Import EPUB' }).first().click();
	const started = Date.now();
	await (
		await chooser
	).setFiles({
		name: 'big.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(bigEpub())
	});
	await expect(page.getByRole('progressbar', { name: /Importing big.epub/ })).toBeVisible();
	await expect(page.getByTestId('import-summary')).toHaveText(/30 chapters, 150,000 words/, {
		timeout: 60_000
	});
	const times = await withSlowWorker(page, Date.now() - started);
	record(testInfo, 'import, 150,000 words', JSON.stringify(times), '10000 ms');
	expect(times.scaled).toBeLessThan(10_000);
});

test('search a 150,000-word Book: typing stays within the interaction budget (< 100 ms)', async ({
	page
}, testInfo) => {
	// P1-RDR-10: the first search reads every Chapter, one at a time, on the page's thread.
	await page.goto('/library');
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Import EPUB' }).first().click();
	await (
		await chooser
	).setFiles({
		name: 'big.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(bigEpub())
	});
	await expect(page.getByTestId('import-summary')).toHaveText(/150,000 words/, { timeout: 60_000 });
	await page
		.getByRole('dialog', { name: 'Imported' })
		.getByRole('link', { name: 'Read now' })
		.click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await settled(page);
	await throttle(page);
	await page.evaluate(() => {
		const w = window as unknown as { __events: number[]; __tasks: number[] };
		w.__events = [];
		w.__tasks = [];
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) w.__events.push(entry.duration);
		}).observe({
			type: 'event',
			durationThreshold: 16,
			buffered: false
		} as PerformanceObserverInit);
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) w.__tasks.push(entry.duration);
		}).observe({ type: 'longtask', buffered: false });
	});
	const opened = Date.now();
	await page.keyboard.press('Slash');
	const field = page.getByRole('searchbox', { name: 'Search in this book' });
	await expect(field).toBeFocused();
	const openMs = Date.now() - opened;
	await page.keyboard.type('sister on the bank', { delay: 150 });
	const typed = Date.now();
	const status = page.getByTestId('search-status');
	await expect(status).toHaveText(/result/, { timeout: 60_000 });
	const firstMs = Date.now() - typed;
	await expect(status).toHaveText(/^[\d,]+ results in 30 chapters$/, { timeout: 120_000 });
	const allMs = Date.now() - typed;
	const { events, tasks } = await page.evaluate(() => {
		const w = window as unknown as { __events: number[]; __tasks: number[] };
		return { events: w.__events, tasks: w.__tasks };
	});
	// Keystrokes faster than 16 ms aren't reported, so they count as 16.
	const keys = 'sister on the bank'.length;
	const samples = [...events, ...Array(Math.max(0, keys - events.length)).fill(16)];
	record(testInfo, 'search: input to next frame', JSON.stringify(stats(samples)), '100 ms');
	record(
		testInfo,
		'search: longest task, open, first and all results',
		JSON.stringify({ longestTask: Math.round(Math.max(0, ...tasks)), openMs, firstMs, allMs }),
		'100 ms per task'
	);
	expect(stats(samples).p95).toBeLessThan(100);
});
