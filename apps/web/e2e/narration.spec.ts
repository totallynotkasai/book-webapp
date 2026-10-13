import type { Page } from '@playwright/test';
import { silentNarration } from './audio';
import {
	expect,
	openReader,
	settled,
	showChrome,
	storedPreferences,
	switchPersona,
	test,
	visibleWords
} from './fixtures';

// Phase 1.5 Try-it list (IMPLEMENTATION-PLAN.md §6) and acceptance for P1-LAY-04: the highlight
// follows the audio, pages turn by themselves, speed, tap to seek, "Back to narration", the
// disabled button's reason, and audio never starting by itself (Invariant 11).
//
// The real narration audio is generated on the owner's PC and not committed, so the audio here
// is silence of each Chapter's real length; the Sync Maps are the real ones.

test.use({ viewport: { width: 1280, height: 800 } });

// The Author holds every Layer of the catalogue Alice. The Reader starts with the book only and
// gets its Layers in the store (plan §6 Phase 1.6; store.spec.ts).
test.beforeEach(async ({ page }) => {
	await switchPersona(page, 'Author');
});

const player = (page: Page) => page.getByTestId('narration-player');
const bookFrame = (page: Page) => page.frames().find((f) => f.url().startsWith('blob:'))!;

/**
 * A Chapter's second page: play starts from the page on screen, past the recording's own
 * introduction (the first page would start with it, about 10–17 s of LibriVox preamble).
 */
async function chapter(page: Page, title: RegExp) {
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await page.getByRole('button', { name: title }).click();
	await settled(page);
	await page.keyboard.press('ArrowRight');
	await settled(page);
}

async function listen(page: Page) {
	await showChrome(page);
	await page.getByRole('button', { name: 'Listen to the narration' }).click();
	await expect(player(page)).toHaveAttribute('data-playing', 'true');
}

async function narrated(page: Page): Promise<number> {
	const value = await page.getByTestId('reader').getAttribute('data-narrated');
	return value === null ? NaN : Number(value);
}

/** What the reader paints as the narration highlight. */
function highlighted(page: Page) {
	return bookFrame(page).evaluate(() => {
		const h = CSS.highlights.get('rd-narration');
		return h ? [...h].map((r) => (r as Range).toString()).join(' ') : null;
	});
}

/** The narrated Word is on screen. */
async function expectNarratedOnScreen(page: Page) {
	await expect
		.poll(
			async () => {
				const n = await narrated(page);
				const { first, last } = await visibleWords(page);
				return n >= first && n <= last;
			},
			{ timeout: 10_000 }
		)
		.toBe(true);
}

test('audio never starts by itself; play follows the text, turns the page and speeds up', async ({
	page
}) => {
	const requests = await silentNarration(page);
	await openReader(page, 'book-alice');
	await chapter(page, /Down the Rabbit-Hole/);
	await page.waitForTimeout(1000);
	// Invariant 11: nothing loads or plays until the reader asks.
	await expect(player(page)).toHaveCount(0);
	expect(requests).toEqual([]);

	const page2 = await visibleWords(page);
	await listen(page);
	await expect(page.getByTestId('narration-hint')).toHaveText(
		'Tap any word to move the narration there.'
	);
	// It starts from the first Word on screen, and the highlight follows the audio.
	await expect.poll(() => narrated(page), { timeout: 15_000 }).toBeGreaterThan(0);
	expect(Math.abs((await narrated(page)) - page2.first)).toBeLessThan(10);
	const start = await narrated(page);
	await expect.poll(() => narrated(page), { timeout: 10_000 }).toBeGreaterThan(start);
	await expectNarratedOnScreen(page);
	await expect.poll(() => highlighted(page)).not.toBeNull();

	// 1.5×: the clock runs faster than the wall clock.
	await player(page).getByRole('button', { name: 'Speed, 1×' }).click();
	await page.getByRole('menuitem', { name: '1.5×' }).click();
	await expect(player(page).getByRole('button', { name: 'Speed, 1.5×' })).toBeVisible();
	await expect
		.poll(
			async () =>
				((await storedPreferences(page, 'user-author')) as { narration?: object } | undefined)
					?.narration
		)
		.toMatchObject({ rate: 1.5 });
	const clock = async () => {
		const [m, s] = (await page.getByTestId('narration-clock').textContent())!
			.split(' / ')[0]!
			.split(':')
			.map(Number);
		return m! * 60 + s!;
	};
	const before = await clock();
	await page.waitForTimeout(4000);
	expect((await clock()) - before).toBeGreaterThanOrEqual(5);

	// Skip ahead past the page: it turns by itself and the narrated Word stays in view.
	const page1 = await visibleWords(page);
	for (let i = 0; i < 12 && (await narrated(page)) <= page1.last; i++) {
		await player(page).getByRole('button', { name: 'Forward 15 seconds' }).first().click();
		await page.waitForTimeout(200);
	}
	await expect.poll(async () => (await visibleWords(page)).first).toBeGreaterThan(page1.last);
	await expectNarratedOnScreen(page);
	await expect(page.getByTestId('reader')).toHaveAttribute('data-following', 'true');
});

test('tap a Word to jump there; page ahead by hand; then back to the narration', async ({
	page
}) => {
	await silentNarration(page);
	await openReader(page, 'book-alice');
	await chapter(page, /The Pool of Tears/);
	await listen(page);
	await expect.poll(() => narrated(page), { timeout: 15_000 }).toBeGreaterThan(0);

	// The last Word on screen clear of the player, well ahead of the narration.
	const target = await bookFrame(page).evaluate(() => {
		const frame = window.frameElement!.getBoundingClientRect();
		const top = window.top!;
		let found: { x: number; y: number } | null = null;
		for (const p of document.querySelectorAll('p')) {
			for (const node of p.childNodes) {
				if (node.nodeType !== 3) continue;
				for (const word of (node as Text).data.matchAll(/\S+/g)) {
					const range = document.createRange();
					range.setStart(node, word.index!);
					range.setEnd(node, word.index! + 1);
					const r = range.getBoundingClientRect();
					const x = frame.left + r.left + r.width / 2;
					const y = frame.top + r.top + r.height / 2;
					if (x > 0 && x < top.innerWidth && y > 80 && y < top.innerHeight - 160) {
						found = { x, y };
					}
				}
			}
		}
		if (!found) throw new Error('No Word on screen');
		return found;
	});
	const before = await narrated(page);
	await page.mouse.click(target.x, target.y);
	await expect.poll(() => narrated(page)).toBeGreaterThan(before + 20);
	await expectNarratedOnScreen(page);
	await expect(page.getByTestId('narration-hint')).toBeHidden();

	// Paging ahead by hand: auto-turn waits, and says how to get back.
	await page.keyboard.press('ArrowRight');
	await settled(page);
	const ahead = await visibleWords(page);
	await expect(page.getByTestId('reader')).toHaveAttribute('data-following', 'false');
	await page.waitForTimeout(1500);
	expect((await visibleWords(page)).first).toBe(ahead.first);
	await page.getByRole('button', { name: 'Back to narration' }).click();
	await expectNarratedOnScreen(page);
	await expect(page.getByTestId('reader')).toHaveAttribute('data-following', 'true');
	await expect(page.getByRole('button', { name: 'Back to narration' })).toBeHidden();
});

test('sentences: highlight a sentence, step to the next one, or turn the highlight off', async ({
	page
}) => {
	await silentNarration(page);
	await openReader(page, 'book-alice');
	await chapter(page, /Down the Rabbit-Hole/);
	await listen(page);
	await expect.poll(() => narrated(page), { timeout: 15_000 }).toBeGreaterThan(0);
	await player(page).getByRole('button', { name: 'More narration controls' }).click();
	const controls = page.getByTestId('narration-controls');
	await controls.getByRole('radio', { name: 'Sentence' }).click();
	// A sentence is several Words, and holds the narrated one.
	await expect
		.poll(async () => (await highlighted(page))?.split(/\s+/).length ?? 0)
		.toBeGreaterThan(3);

	await controls.getByRole('button', { name: 'Pause narration' }).click();
	await expect(player(page)).not.toHaveAttribute('data-playing', 'true');
	const sentence = await highlighted(page);
	await controls.getByRole('button', { name: 'Next sentence' }).click();
	await expect.poll(() => highlighted(page)).not.toBe(sentence);
	expect(await highlighted(page)).not.toContain(sentence!);

	await controls.getByRole('radio', { name: 'Off' }).click();
	await expect.poll(() => highlighted(page)).toBeNull();
	await controls.getByRole('button', { name: 'Close player' }).click();
	await expect(player(page)).toHaveCount(0);
});

test('outside chapters 1–3 the button says why it can’t play', async ({ page }) => {
	await silentNarration(page);
	await openReader(page, 'book-alice');
	await chapter(page, /Advice from a Caterpillar/);
	await showChrome(page);
	const button = page.getByRole('button', { name: 'Listen to the narration' });
	await expect(button).toHaveAttribute('aria-disabled', 'true');
	await expect(button).toHaveAccessibleDescription('Narration covers chapters 1–3.');
	// Playwright won't click an aria-disabled button by itself; readers can, to hear why.
	await button.click({ force: true });
	await expect(page.getByText('Narration covers chapters 1–3.').first()).toBeVisible();
	await expect(player(page)).toHaveCount(0);
});

test('a reader without the narration is told so', async ({ page }) => {
	await silentNarration(page);
	await switchPersona(page, 'Moderator');
	await openReader(page, 'book-alice');
	await showChrome(page);
	await page.getByRole('button', { name: 'Listen to the narration' }).click({ force: true });
	await expect(
		page.getByText('You don’t have the narration for this book yet.').first()
	).toBeVisible();
	await expect(player(page)).toHaveCount(0);
});

test('at the end of a Chapter it goes on to the next, and the page goes with it', async ({
	page
}) => {
	await silentNarration(page);
	await openReader(page, 'book-alice');
	await chapter(page, /Down the Rabbit-Hole/);
	await listen(page);
	await player(page).getByRole('button', { name: 'More narration controls' }).click();
	const position = page.getByTestId('narration-controls').getByRole('slider');
	await position.focus();
	await page.keyboard.press('End');
	await expect(player(page)).toContainText('CHAPTER II. The Pool of Tears', { timeout: 10_000 });
	// Before the new recording's first Word, the reader is already at its Chapter.
	await expect(page.getByTestId('chapter-title')).toHaveText('CHAPTER II. The Pool of Tears');
	await expect(player(page)).toHaveAttribute('data-playing', 'true');
});

test('paused, paging away stays put until the reader goes back', async ({ page }) => {
	await silentNarration(page);
	await openReader(page, 'book-alice');
	await chapter(page, /Down the Rabbit-Hole/);
	await listen(page);
	await expect.poll(() => narrated(page), { timeout: 15_000 }).toBeGreaterThan(0);
	await player(page).getByRole('button', { name: 'Pause narration' }).click();
	await page.keyboard.press('ArrowRight');
	await settled(page);
	await page.keyboard.press('ArrowRight');
	await settled(page);
	const away = await visibleWords(page);
	await page.waitForTimeout(1000);
	expect((await visibleWords(page)).first).toBe(away.first);
	await expect(page.getByRole('button', { name: 'Back to narration' })).toBeVisible();
	await page.getByRole('button', { name: 'Back to narration' }).click();
	await expectNarratedOnScreen(page);
});

test('the highlight is within 100 ms of the audio (P1-LAY-04), at 1× and 2×', async ({
	page
}, testInfo) => {
	// The player's <audio> element, so its clock can be read when the highlight moves.
	await page.addInitScript(() => {
		const play = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function () {
			(window as unknown as { __narration: HTMLMediaElement }).__narration = this;
			return play.call(this);
		};
	});
	await silentNarration(page);
	await openReader(page, 'book-alice');
	await chapter(page, /Down the Rabbit-Hole/);
	await listen(page);
	await expect.poll(() => narrated(page), { timeout: 15_000 }).toBeGreaterThan(0);

	/** Audio time minus the Word's start, each time the highlight moves on by itself. */
	const lags = (ms: number) =>
		page.evaluate(async (ms) => {
			const audio = (window as unknown as { __narration: HTMLMediaElement }).__narration;
			const reader = document.querySelector<HTMLElement>('[data-testid="reader"]')!;
			const samples: number[] = [];
			const observer = new MutationObserver(() => {
				const start = Number(reader.dataset.narratedStart);
				if (!audio.paused && Number.isFinite(start)) samples.push(audio.currentTime * 1000 - start);
			});
			observer.observe(reader, { attributeFilter: ['data-narrated'] });
			await new Promise((r) => setTimeout(r, ms));
			observer.disconnect();
			return samples;
		}, ms);
	const summary = (samples: number[]) => {
		const sorted = [...samples].sort((a, b) => a - b);
		const at = (q: number) =>
			Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!);
		return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) };
	};

	const normal = summary(await lags(8000));
	await player(page).getByRole('button', { name: 'Speed, 1×' }).click();
	await page.getByRole('menuitem', { name: '2×' }).click();
	await page.waitForTimeout(500);
	const fast = summary(await lags(5000));
	testInfo.annotations.push({
		type: 'highlight lag (ms)',
		description: `1×: ${JSON.stringify(normal)}; 2×: ${JSON.stringify(fast)}`
	});
	console.log(`${testInfo.project.name} highlight lag 1×`, normal, '2×', fast);
	expect(normal.n).toBeGreaterThan(10);
	expect(normal.p95).toBeLessThan(100);
	expect(fast.p95).toBeLessThan(100);
});
