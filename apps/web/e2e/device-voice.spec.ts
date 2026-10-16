import type { Page } from '@playwright/test';
import { frontMatterEpub } from './books';
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
import { fakeSpeech, spoken } from './speech';

// Phase 1.11 Try-it list (IMPLEMENTATION-PLAN.md §6) and P1-LAY-08's acceptance: any Book read
// aloud by the device's own voice, with narration's highlighting and page turns; off until the
// reader presses play (Invariant 11); narration first where the reader has it; on-device voices
// only (D-036). The voice is a scripted stand-in for the Web Speech API (e2e/speech.ts).

test.use({ viewport: { width: 1280, height: 800 } });

const player = (page: Page) => page.getByTestId('narration-player');
const bookFrames = (page: Page) => page.frames().filter((f) => f.url().startsWith('blob:'));

async function narrated(page: Page): Promise<number> {
	const value = await page.getByTestId('reader').getAttribute('data-narrated');
	return value === null ? NaN : Number(value);
}

/** What the reader paints as the read-aloud highlight, in whichever Chapter frame has it. */
async function highlighted(page: Page): Promise<string | null> {
	for (const frame of bookFrames(page)) {
		const text = await frame
			.evaluate(() => {
				const h = CSS.highlights.get('rd-narration');
				return h ? [...h].map((r) => (r as Range).toString()).join(' ') : null;
			})
			.catch(() => null);
		if (text) return text;
	}
	return null;
}

/** A Word near the foot of the page, clear of the player, in top-level coordinates. */
async function wordNearFoot(page: Page): Promise<{ x: number; y: number }> {
	for (const frame of bookFrames(page)) {
		const found = await frame.evaluate(() => {
			const box = window.frameElement!.getBoundingClientRect();
			const top = window.top!;
			let at: { x: number; y: number } | null = null;
			for (const p of document.querySelectorAll('p')) {
				for (const node of p.childNodes) {
					if (node.nodeType !== 3) continue;
					for (const word of (node as Text).data.matchAll(/\S+/g)) {
						const range = document.createRange();
						range.setStart(node, word.index!);
						range.setEnd(node, word.index! + 1);
						const r = range.getBoundingClientRect();
						const x = box.left + r.left + r.width / 2;
						const y = box.top + r.top + r.height / 2;
						if (x > 0 && x < top.innerWidth && y > 80 && y < top.innerHeight - 160) {
							at = { x, y };
						}
					}
				}
			}
			return at;
		});
		if (found) return found;
	}
	throw new Error('No Word on screen');
}

async function readAloud(page: Page) {
	await showChrome(page);
	await page.getByRole('button', { name: 'Read aloud with the device voice' }).click();
	await expect(player(page)).toHaveAttribute('data-playing', 'true');
	await expect(player(page)).toHaveAttribute('data-kind', 'device');
}

async function addTreasureIsland(page: Page) {
	await page.goto('/book/treasure-island');
	await page.getByRole('button', { name: 'Add to library' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Add to library' }).click();
	await expect(page.getByTestId('checkout')).toContainText('is in your library');
}

test('Treasure Island read aloud: each Word lights up, the page turns, speed and voice change', async ({
	page
}) => {
	await fakeSpeech(page, { wordMs: 30 });
	await addTreasureIsland(page);
	await openReader(page, 'book-treasure-island');
	await settled(page);
	await page.waitForTimeout(800);
	// Invariant 11: nothing is said until the reader presses play.
	await expect(player(page)).toHaveCount(0);
	expect(await spoken(page)).toEqual([]);

	const start = await visibleWords(page);
	await readAloud(page);
	await expect(page.getByTestId('device-voice-label')).toHaveText('Device voice · Test George');
	await expect(page.getByTestId('narration-hint')).toHaveText(
		'Tap any word to move the voice there.'
	);
	// It starts at the first Word on screen, a Word at a time.
	await expect.poll(() => narrated(page)).toBeGreaterThanOrEqual(start.first);
	const first = await narrated(page);
	await expect.poll(() => narrated(page)).toBeGreaterThan(first);
	// One Word at a time is painted (a page turn can briefly leave none).
	await expect.poll(async () => (await highlighted(page))?.trim().split(/\s+/).length ?? 0).toBe(1);
	const said = await spoken(page);
	// The first thing said is the first Word on the page (with any punctuation before it).
	expect(said[0]!.text.slice(0, start.word.length + 2)).toContain(start.word);
	expect(said[0]!.voice).toBe('Test George');
	expect(said[0]!.lang).toBe('en-GB');

	// It reaches the end of the page and turns it by itself, keeping the Word in view.
	await expect
		.poll(async () => (await visibleWords(page)).first, { timeout: 30_000 })
		.toBeGreaterThan(start.last);
	await expect(page.getByTestId('reader')).toHaveAttribute('data-following', 'true');
	const shown = await visibleWords(page);
	const now = await narrated(page);
	expect(now).toBeGreaterThanOrEqual(shown.first);
	expect(now).toBeLessThanOrEqual(shown.last + 20);

	// Speed: 2× from the Word being said, and remembered as the device voice's own.
	await player(page).getByRole('button', { name: 'Speed, 1×' }).click();
	await page.getByRole('menuitem', { name: '2×' }).click();
	await expect.poll(async () => (await spoken(page)).at(-1)!.rate).toBe(2);
	await expect
		.poll(
			async () =>
				((await storedPreferences(page, 'user-reader')) as { deviceVoice?: object } | undefined)
					?.deviceVoice
		)
		.toMatchObject({ rate: 2 });

	// Voice: the other on-device English voice; never the online one, nor the French one.
	await player(page).getByRole('button', { name: 'More device voice controls' }).click();
	await player(page).getByRole('button', { name: 'Voice, Test George' }).click();
	const voices = page.getByRole('menuitem');
	await expect(voices).toHaveText(['Test George', 'Test Hazel']);
	await page.getByRole('menuitem', { name: 'Test Hazel' }).click();
	await expect(page.getByTestId('device-voice-label')).toHaveText('Device voice · Test Hazel');
	await expect.poll(async () => (await spoken(page)).at(-1)!.voice).toBe('Test Hazel');
	await expect
		.poll(
			async () =>
				((await storedPreferences(page, 'user-reader')) as { deviceVoice?: object } | undefined)
					?.deviceVoice
		)
		.toMatchObject({ voices: { en: 'test-hazel' } });
	expect((await spoken(page)).some((u) => u.voice === 'Online Natural')).toBe(false);

	// Close the player: the voice stops.
	await player(page).getByRole('button', { name: 'Close player' }).click();
	await expect(player(page)).toHaveCount(0);
	const count = (await spoken(page)).length;
	await page.waitForTimeout(800);
	expect((await spoken(page)).length).toBe(count);
	await expect.poll(() => highlighted(page)).toBeNull();
});

test('pause and play, previous and next sentence, and tap a Word to move the voice', async ({
	page
}) => {
	await fakeSpeech(page, { wordMs: 250 });
	await addTreasureIsland(page);
	await openReader(page, 'book-treasure-island');
	await settled(page);
	// A full page of Chapter I (Part I's own page is short: the voice would soon leave it).
	await showChrome(page);
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await page.getByRole('button', { name: /At the Admiral Benbow/ }).click();
	await settled(page);
	await page.keyboard.press('ArrowRight');
	await settled(page);
	await readAloud(page);
	await expect.poll(() => narrated(page)).toBeGreaterThan(0);

	await player(page).getByRole('button', { name: 'Pause the device voice' }).click();
	await expect(player(page)).not.toHaveAttribute('data-playing');
	const paused = await narrated(page);
	await page.waitForTimeout(800);
	expect(await narrated(page)).toBe(paused);
	await player(page).getByRole('button', { name: 'Play the device voice' }).click();
	await expect(player(page)).toHaveAttribute('data-playing', 'true');
	// It goes on from the Word it had reached, not the sentence's start.
	await expect.poll(async () => (await spoken(page)).at(-1)!.text.length).toBeGreaterThan(0);
	expect(await narrated(page)).toBeGreaterThanOrEqual(paused);

	// Next sentence: the voice says the following sentence from its start.
	const saying = (await spoken(page)).at(-1)!.text;
	await player(page).getByRole('button', { name: 'Next sentence' }).click();
	await expect.poll(async () => (await spoken(page)).at(-1)!.text).not.toBe(saying);
	const next = (await spoken(page)).at(-1)!.text;
	expect(saying.endsWith(next)).toBe(false);
	// Previous sentence, a few Words in: back to the start of the same one.
	await page.waitForTimeout(800);
	await player(page).getByRole('button', { name: 'Previous sentence' }).click();
	await expect.poll(async () => (await spoken(page)).filter((u) => u.text === next).length).toBe(2);

	// Sentence highlighting.
	await player(page).getByRole('button', { name: 'More device voice controls' }).click();
	await player(page).getByRole('radio', { name: 'Sentence' }).click();
	await expect
		.poll(async () => ((await highlighted(page)) ?? '').split(/\s+/).length)
		.toBeGreaterThan(2);
	await player(page).getByRole('button', { name: 'Fewer device voice controls' }).click();

	// Tap a Word further down the page: the voice moves there.
	const { last } = await visibleWords(page);
	const target = await wordNearFoot(page);
	const before = await narrated(page);
	await page.mouse.click(target.x, target.y);
	await expect.poll(() => narrated(page)).toBeGreaterThan(before + 20);
	expect(await narrated(page)).toBeLessThanOrEqual(last);
});

test('a voice without Word timing highlights the sentence', async ({ page }) => {
	await fakeSpeech(page, { wordMs: 120 });
	await addTreasureIsland(page);
	await openReader(page, 'book-treasure-island');
	await settled(page);
	await page.evaluate(() => (globalThis.__speech.boundaries = false));
	await readAloud(page);
	await expect
		.poll(async () => ((await highlighted(page)) ?? '').split(/\s+/).length)
		.toBeGreaterThan(1);
	await page.getByRole('button', { name: 'More device voice controls' }).click();
	await expect(player(page)).toContainText('This voice doesn’t say where each word is');
});

test('in Alice, chapters 1–3 play the narration and Chapter 4 offers the device voice', async ({
	page
}) => {
	await fakeSpeech(page);
	await silentNarration(page);
	await switchPersona(page, 'Author');
	await openReader(page, 'book-alice');
	await settled(page);
	await showChrome(page);
	await expect(page.getByRole('button', { name: 'Listen to the narration' })).toBeVisible();

	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await page.getByRole('button', { name: /The Rabbit Sends in a Little Bill/ }).click();
	await settled(page);
	await showChrome(page);
	await readAloud(page);
	await expect(page.getByTestId('device-voice-label')).toContainText('Device voice');
	// The Author owns the narration: no store link.
	await page.getByRole('button', { name: 'More device voice controls' }).click();
	await expect(player(page).getByRole('link', { name: 'Get it in the store' })).toHaveCount(0);
});

test('a reader without the narration hears the device voice, with the narration offered in the store', async ({
	page
}) => {
	await fakeSpeech(page);
	await openReader(page, 'book-alice');
	await settled(page);
	await readAloud(page);
	await page.getByRole('button', { name: 'More device voice controls' }).click();
	await expect(player(page).getByRole('link', { name: 'Get it in the store' })).toHaveAttribute(
		'href',
		/\/book\/alice/
	);
	await expect(player(page)).toContainText('Read by your device’s own voice, not a recording.');
});

test('an imported Book is read aloud too', async ({ page }) => {
	await fakeSpeech(page, { wordMs: 40 });
	await page.goto('/library');
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Import EPUB' }).first().click();
	await (
		await chooser
	).setFiles({
		name: 'the-quay.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(frontMatterEpub())
	});
	await page
		.getByRole('dialog', { name: 'Imported' })
		.getByRole('link', { name: 'Read now' })
		.click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await settled(page);
	await readAloud(page);
	await expect.poll(() => highlighted(page)).not.toBeNull();
	// The heading's "1." ends a sentence before "Low Tide", as narration's sentences do (§8.3).
	await expect
		.poll(async () => (await spoken(page)).slice(0, 2).map((u) => u.text))
		.toEqual(['Chapter 1.', 'Low Tide']);
});

test('where the browser has no voice, there is no read-aloud button', async ({ page }) => {
	// No stand-in installed: the browser has no Web Speech API (fixtures.ts).
	await addTreasureIsland(page);
	await openReader(page, 'book-treasure-island');
	await settled(page);
	await showChrome(page);
	await expect(page.getByRole('button', { name: 'Read aloud with the device voice' })).toHaveCount(
		0
	);
	await expect(page.getByRole('button', { name: 'Listen to the narration' })).toHaveCount(0);
});
