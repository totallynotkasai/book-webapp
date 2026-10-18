import type { Page } from '@playwright/test';
import {
	expect,
	openPreferences,
	openReader,
	settled,
	showChrome,
	test,
	visibleWords
} from './fixtures';

// Phase 1.21 (IMPLEMENTATION-PLAN.md §6): its Try-it items and the acceptance of P1-RDR-19, the
// page curl (D-044). The curl is drawn with WebGL over the page; these specs hold the browser's
// animation frames to look at a turn frame by frame. Its page-turn budget at phone speed is in
// phone.perf.ts; in the Android app, in docs/device-checklist.md.

// Many screenshots of a WebGL canvas: Playwright's WebKit takes 15–20 s a test here, so twice the
// usual time for a busy machine.
test.describe.configure({ timeout: 60_000 });

const overlay = (page: Page) => page.locator('canvas[data-page-curl]');
const stage = (page: Page) => page.locator('.stage');

async function chooseCurl(page: Page) {
	await openPreferences(page, 'Page');
	const turns = page.getByRole('radiogroup', { name: 'Page turns' });
	await turns.getByRole('radio', { name: 'Curl' }).click();
	await expect(turns.getByRole('radio', { name: 'Curl' })).toHaveAttribute('aria-checked', 'true');
}

async function chooseLayout(page: Page, layout: 'Single' | 'Spread' | 'Scroll') {
	const group = page.getByRole('radiogroup', { name: 'Layout' });
	await group.getByRole('radio', { name: layout }).click();
	await expect(group.getByRole('radio', { name: layout })).toHaveAttribute('aria-checked', 'true');
}

async function closeSheet(page: Page) {
	await page.keyboard.press('Escape');
	await expect(page.getByRole('tablist', { name: 'Reading preferences' })).toBeHidden();
	await settled(page);
}

/** Holds the page's animation frames: from now on they only run when `step` says so. */
async function holdFrames(page: Page) {
	await page.evaluate(() => {
		const w = window as unknown as {
			__frames: FrameRequestCallback[];
			__now: number;
			__step: (ms: number) => void;
			__raf?: typeof requestAnimationFrame;
		};
		w.__frames = [];
		w.__now = performance.now();
		w.__raf ??= window.requestAnimationFrame.bind(window);
		window.requestAnimationFrame = (cb) => w.__frames.push(cb);
		window.cancelAnimationFrame = () => {};
		w.__step = (ms) => {
			w.__now += ms;
			const due = w.__frames.splice(0);
			for (const cb of due) cb(w.__now);
		};
	});
}

/** Lets animation frames run by themselves again. */
async function releaseFrames(page: Page) {
	await page.evaluate(() => {
		const w = window as unknown as {
			__raf?: typeof requestAnimationFrame;
			__frames: FrameRequestCallback[];
		};
		if (w.__raf) window.requestAnimationFrame = w.__raf;
		for (const cb of w.__frames.splice(0)) window.requestAnimationFrame(cb);
	});
}

/** Moves the held animation on by `ms`, and draws the frame it reaches. */
async function step(page: Page, ms: number) {
	await page.evaluate((d) => {
		const w = window as unknown as { __step: (ms: number) => void };
		w.__step(d);
		w.__step(0);
	}, ms);
}

/**
 * How different two screenshots of the same size are, out of 255: the mean difference after
 * scaling both down 4×, so text drawn a fraction of a pixel apart counts for little, but a
 * different page counts.
 */
async function difference(page: Page, a: Buffer, b: Buffer): Promise<number> {
	return page.evaluate(
		async ([ua, ub]) => {
			const load = (src: string) =>
				new Promise<HTMLImageElement>((resolve) => {
					const img = new Image();
					img.onload = () => resolve(img);
					img.src = src;
				});
			const [ia, ib] = await Promise.all([load(ua!), load(ub!)]);
			const w = Math.round(ia.width / 4);
			const h = Math.round(ia.height / 4);
			const read = (img: HTMLImageElement) => {
				const c = document.createElement('canvas');
				c.width = w;
				c.height = h;
				const ctx = c.getContext('2d')!;
				ctx.imageSmoothingQuality = 'high';
				ctx.drawImage(img, 0, 0, w, h);
				return ctx.getImageData(0, 0, w, h).data;
			};
			const da = read(ia);
			const db = read(ib);
			let total = 0;
			for (let i = 0; i < da.length; i += 4) {
				total +=
					(Math.abs(da[i]! - db[i]!) +
						Math.abs(da[i + 1]! - db[i + 1]!) +
						Math.abs(da[i + 2]! - db[i + 2]!)) /
					3;
			}
			return total / (w * h);
		},
		[
			`data:image/png;base64,${a.toString('base64')}`,
			`data:image/png;base64,${b.toString('base64')}`
		]
	);
}

/** A screenshot of part of the reading area, in CSS pixels from its top left. */
async function shot(page: Page, part?: { x: number; y: number; width: number; height: number }) {
	const box = (await stage(page).boundingBox())!;
	const clip = part ? { ...part, x: box.x + part.x, y: box.y + part.y } : box;
	return page.screenshot({ clip });
}

/**
 * Whether `actual` shows the same page as `expected`: at most a third as different from it as
 * `other`, a different page, is. A canvas draws text a fraction of a pixel from where the page
 * draws it (more so in WebKit), so screenshots never match exactly.
 */
async function looksLike(page: Page, actual: Buffer, expected: Buffer, other: Buffer) {
	const same = await difference(page, actual, expected);
	const unlike = await difference(page, other, expected);
	expect(unlike).toBeGreaterThan(2);
	expect(same).toBeLessThan(unlike / 3);
}

test.describe('the page curl (P1-RDR-19)', () => {
	test.use({ viewport: { width: 412, height: 860 } });

	test('a fourth page turn: a key curls the page over the real page turned to', async ({
		page
	}) => {
		await openReader(page, 'book-alice');
		await settled(page);
		await chooseCurl(page);
		await expect(
			page.getByText('Pages curl like paper. On a touch screen, drag a page to turn it.')
		).toBeVisible();
		await chooseLayout(page, 'Single');
		await closeSheet(page);
		await expect(overlay(page)).toBeAttached();
		await expect(overlay(page)).toHaveAttribute('aria-hidden', 'true');
		const before = await visibleWords(page);
		const box = (await stage(page).boundingBox())!;
		const strip = { x: box.width - 110, y: 60, width: 90, height: box.height - 120 };
		const pageBefore = await shot(page);
		const stripBefore = await shot(page, strip);

		await holdFrames(page);
		await page.keyboard.press('ArrowRight');
		await expect(overlay(page)).toHaveCSS('visibility', 'visible');
		const firstFrame = await shot(page);
		// The app hears where the turn went once the curl has played, as with the slide.
		expect(await visibleWords(page)).toEqual(before);

		// Half-way: the free edge's side shows the page turned to, the real one, and no other.
		await step(page, 16);
		await step(page, 230);
		const halfway = await shot(page, strip);
		for (let i = 0; i < 6; i++) await step(page, 100);
		await expect(overlay(page)).toHaveCSS('visibility', 'hidden');
		// One page on.
		await expect.poll(async () => (await visibleWords(page)).first).toBeGreaterThan(before.last);
		expect((await visibleWords(page)).first).toBeLessThanOrEqual(before.last + 2);
		// Its first frame is the page that was there.
		await looksLike(page, firstFrame, pageBefore, await shot(page));
		await looksLike(page, halfway, await shot(page, strip), stripBefore);
	});

	test('turning back uncurls the previous page over this one, and lands exactly on it', async ({
		page
	}) => {
		await openReader(page, 'book-alice');
		await page.keyboard.press('ArrowRight');
		await settled(page);
		await chooseCurl(page);
		await chooseLayout(page, 'Single');
		await closeSheet(page);
		await page.keyboard.press('ArrowRight');
		await expect(overlay(page)).toHaveCSS('visibility', 'hidden');
		await settled(page);
		const here = await visibleWords(page);
		const pageHere = await shot(page);

		await holdFrames(page);
		await page.keyboard.press('ArrowLeft');
		await expect(overlay(page)).toHaveCSS('visibility', 'visible');
		const firstFrame = await shot(page);
		for (let i = 0; i < 5; i++) await step(page, 90);
		// The last frame before the curl goes, then the page itself: the same picture.
		const landing = await shot(page);
		await step(page, 200);
		await expect(overlay(page)).toHaveCSS('visibility', 'hidden');
		const pagePrevious = await shot(page);
		await looksLike(page, firstFrame, pageHere, pagePrevious);
		await looksLike(page, landing, pagePrevious, pageHere);
		await expect.poll(async () => (await visibleWords(page)).last).toBeLessThan(here.first);
	});

	test('a tap at the side curls the page too; a jump never curls', async ({ page }) => {
		await openReader(page, 'book-alice');
		await settled(page);
		await chooseCurl(page);
		await closeSheet(page);
		const before = await visibleWords(page);
		const box = (await stage(page).boundingBox())!;
		await holdFrames(page);
		await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2);
		await expect(overlay(page)).toHaveCSS('visibility', 'visible');
		for (let i = 0; i < 8; i++) await step(page, 80);
		await expect(overlay(page)).toHaveCSS('visibility', 'hidden');
		await expect.poll(async () => (await visibleWords(page)).first).toBeGreaterThan(before.last);

		// The Contents sheet's jump goes straight there.
		await releaseFrames(page);
		await showChrome(page);
		await page.getByRole('button', { name: 'Contents' }).click();
		await page.getByRole('button', { name: /A Caucus-Race/ }).click();
		await expect(page.getByTestId('chapter-title')).toContainText('A Caucus-Race');
		await expect(overlay(page)).toHaveCSS('visibility', 'hidden');
	});

	test('at 200% text it still curls, from the page as it is', async ({ page }) => {
		await openReader(page, 'book-alice');
		await openPreferences(page, 'Text');
		const size = page.getByRole('slider', { name: 'Text size' });
		await size.focus();
		for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
		await expect(page.getByText('200%')).toBeVisible();
		await page.getByRole('tab', { name: 'Page' }).click();
		const turns = page.getByRole('radiogroup', { name: 'Page turns' });
		await turns.getByRole('radio', { name: 'Curl' }).click();
		await closeSheet(page);
		const pageBefore = await shot(page);
		const before = await visibleWords(page);
		await holdFrames(page);
		await page.keyboard.press('ArrowRight');
		await expect(overlay(page)).toHaveCSS('visibility', 'visible');
		const firstFrame = await shot(page);
		for (let i = 0; i < 8; i++) await step(page, 80);
		await expect(overlay(page)).toHaveCSS('visibility', 'hidden');
		await expect.poll(async () => (await visibleWords(page)).first).toBeGreaterThan(before.last);
		await looksLike(page, firstFrame, pageBefore, await shot(page));
	});

	test('not when scrolling: there are no pages to curl', async ({ page }) => {
		await openReader(page, 'book-alice');
		await chooseCurl(page);
		await chooseLayout(page, 'Scroll');
		await closeSheet(page);
		await holdFrames(page);
		await page.keyboard.press('PageDown');
		await step(page, 100);
		await expect(overlay(page)).toHaveCSS('visibility', 'hidden');
	});
});

test.describe('under reduced motion', () => {
	test.use({ viewport: { width: 412, height: 860 }, reducedMotion: 'reduce' });

	test('the curl is gone: pages turn without animation (Invariant 12)', async ({ page }) => {
		await openReader(page, 'book-alice');
		await settled(page);
		await chooseCurl(page);
		await expect(
			page.getByText('Your device asks for reduced motion, so pages turn without animation.')
		).toBeVisible();
		await closeSheet(page);
		const before = await visibleWords(page);
		await page.keyboard.press('ArrowRight');
		await expect.poll(async () => (await visibleWords(page)).first).toBeGreaterThan(before.last);
		// The reader's choice is kept, but the curl isn't even loaded.
		await expect(overlay(page)).toHaveCount(0);
	});
});

test.describe('in spread mode', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('the right page turns over onto the left; the new right page lies under it', async ({
		page
	}) => {
		await openReader(page, 'book-alice');
		await settled(page);
		await chooseCurl(page);
		await chooseLayout(page, 'Spread');
		await closeSheet(page);
		const box = (await stage(page).boundingBox())!;
		const outer = { x: box.width - 150, y: 60, width: 120, height: box.height - 120 };
		const pageBefore = await shot(page);
		const outerBefore = await shot(page, outer);
		await holdFrames(page);
		await page.keyboard.press('ArrowRight');
		await expect(overlay(page)).toHaveCSS('visibility', 'visible');
		const firstFrame = await shot(page);
		await step(page, 16);
		await step(page, 230);
		const halfway = await shot(page, outer);
		for (let i = 0; i < 6; i++) await step(page, 100);
		await expect(overlay(page)).toHaveCSS('visibility', 'hidden');
		await looksLike(page, firstFrame, pageBefore, await shot(page));
		// The outer edge of the right page, half-way through: the new right page, already there.
		await looksLike(page, halfway, await shot(page, outer), outerBefore);
	});
});

test.describe('on a touch screen', () => {
	test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });

	test('the curl follows a finger: let go past a quarter and it turns, early and it settles back', async ({
		page,
		browserName
	}) => {
		test.skip(browserName !== 'chromium', 'Touch drags go through Chromium’s DevTools protocol.');
		await openReader(page, 'book-alice');
		await settled(page);
		await chooseCurl(page);
		await closeSheet(page);
		const cdp = await page.context().newCDPSession(page);
		const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
			cdp.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: type === 'touchEnd' ? [] : [{ x, y }]
			});
		const box = (await stage(page).boundingBox())!;
		const drag = async (fromX: number, toX: number, y: number, during?: () => Promise<void>) => {
			await touch('touchStart', box.x + fromX, box.y + y);
			for (let i = 1; i <= 12; i++) {
				await touch('touchMove', box.x + fromX + ((toX - fromX) * i) / 12, box.y + y - i);
				await page.waitForTimeout(16);
			}
			await during?.();
			await touch('touchEnd');
		};

		// A short drag: the curl lifts with the finger, and settles back where it was.
		const start = await visibleWords(page);
		await drag(box.width - 60, box.width - 110, 500, async () => {
			await expect(overlay(page)).toHaveCSS('visibility', 'visible');
			// The page under the curl is the next one, but nothing is told yet: no relocation.
			expect(await visibleWords(page)).toEqual(start);
		});
		await expect(overlay(page)).toHaveCSS('visibility', 'hidden');
		await settled(page);
		expect(await visibleWords(page)).toEqual(start);

		// A long drag turns the page.
		await drag(box.width - 60, 80, 500);
		await expect(overlay(page)).toHaveCSS('visibility', 'hidden');
		await expect.poll(async () => (await visibleWords(page)).first).toBeGreaterThan(start.last);
		const next = await visibleWords(page);

		// Dragging the other way brings the page back.
		await drag(60, box.width - 80, 400);
		await expect(overlay(page)).toHaveCSS('visibility', 'hidden');
		await expect.poll(async () => (await visibleWords(page)).first).toBe(start.first);

		// A tap at the side still turns it.
		await page.touchscreen.tap(box.x + box.width - 16, box.y + box.height / 2);
		await expect.poll(async () => (await visibleWords(page)).first).toBe(next.first);
	});
});
