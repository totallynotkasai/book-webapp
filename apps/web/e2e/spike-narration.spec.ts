import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// SPIKE (P0-06): /spike/narration, for ADR-003. Deleted with the spike.
// The narration audio is generated (npm run fixtures:narration) and never committed, so in CI and
// fresh clones only the "how to get it" path runs. Playwright runs from apps/web.
const AUDIO = existsSync('build/demo/audio/alice/ch01.m4a');
const WORD_INDEX = '../../fixtures/sync/alice-word-index.json';

interface Results {
	audioState: 'checking' | 'missing' | 'unsupported' | 'ready';
	coverage?: number;
	words: number;
	current: number;
	currentWordId?: number;
	positionMs: number;
	playing: boolean;
	rate: number;
	turns: number;
	lagSamples: number;
	lagP50?: number;
	lagP95?: number;
	lagMax?: number;
	highlightP50?: number;
	visible: { first: number | null; last: number | null; count: number } | null;
}

interface Hooks {
	results(): Results;
	wordRect(id: number): { x: number; y: number; width: number; height: number } | null;
	startOf(id: number): number | undefined;
	wordIndex(chapters: number[]): Promise<{ chapter: number; words: [number, string][] }[]>;
}
/** Calls one of the page's spike hooks (the function runs in the page, so it can't close over ours). */
function call<K extends keyof Hooks>(page: Page, name: K, ...args: Parameters<Hooks[K]>) {
	return page.evaluate(
		([n, a]) => {
			const spike = (globalThis as unknown as { __narrationSpike: Record<string, unknown> })
				.__narrationSpike;
			return (spike[n as string] as (...x: unknown[]) => unknown)(...(a as unknown[]));
		},
		[name, args] as const
	) as Promise<Awaited<ReturnType<Hooks[K]>>>;
}

const results = (page: Page) => call(page, 'results');

async function open(page: Page, engine: 'foliate' | 'readium' = 'foliate') {
	await page.goto(`/spike/narration?engine=${engine}`);
	await expect(page.getByTestId('status')).toContainText('Opened', { timeout: 60_000 });
}

test('opens chapter 1 with its Sync Map, and nothing plays by itself', async ({ page }) => {
	await open(page);
	await expect(page.getByTestId('coverage')).toContainText('%');
	const r = await results(page);
	expect(r.coverage).toBeGreaterThanOrEqual(0.95);
	// Invariant 11: audio never starts on its own.
	await page.waitForTimeout(1000);
	expect((await results(page)).playing).toBe(false);
	expect((await results(page)).positionMs).toBe(0);
});

test('the page assigns the WordIds the Sync Map was built against', async ({
	page,
	browserName
}) => {
	// Known: WebKit's Intl.Segmenter splits the front matter differently, so every WordId from
	// chapter 1 on is 4 lower than in Chromium (same Words, different IDs). Runtime IDs are a spike
	// shortcut; text-pipeline assigns them once at ingest (§7.1), which removes this (ADR-003).
	test.fail(browserName === 'webkit', 'WebKit assigns different WordIds to the same Words');
	await open(page);
	const reference = JSON.parse(readFileSync(WORD_INDEX, 'utf8')) as {
		chapters: { chapter: number; words: [number, string][] }[];
	};
	const [chapter1, chapter2] = await call(page, 'wordIndex', [1, 2]);
	expect(chapter1!.words, browserName).toEqual(reference.chapters[0]!.words);
	expect(chapter2!.words, browserName).toEqual(reference.chapters[1]!.words);
});

test('without the audio, the page says how to get it', async ({ page }) => {
	test.skip(AUDIO, 'The narration audio is present in this build');
	await open(page);
	await expect(page.getByTestId('audio-missing')).toContainText('npm run fixtures:narration');
	await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled();
});

for (const engine of ['foliate', 'readium'] as const) {
	test(`${engine}: highlights Words in time with the audio, turns pages and seeks on tap`, async ({
		page,
		browserName
	}, info) => {
		test.skip(!AUDIO, 'No narration audio in this build: run npm run fixtures:narration first');
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1280, height: 900 });
		await open(page, engine);
		const opened = await results(page);
		test.skip(
			opened.audioState === 'unsupported',
			`${browserName} here can't decode AAC (.m4a): canPlayType('audio/mp4; codecs="mp4a.40.2"') is empty`
		);
		expect(opened.audioState).toBe('ready');

		// Tap a Word near the end of the page: the narration moves there.
		const visible = opened.visible!;
		const target = visible.last! - 12;
		const rect = await call(page, 'wordRect', target);
		expect(rect).not.toBeNull();
		await page.mouse.click(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
		const startMs = await call(page, 'startOf', target);
		// Within an AAC frame or two: WebKit lands on frame boundaries.
		await expect
			.poll(async () => Math.abs((await results(page)).positionMs - startMs!))
			.toBeLessThan(50);
		expect((await results(page)).playing).toBe(false);

		// Play: the highlight follows the audio and the page turns when the narration leaves it.
		await page.getByRole('button', { name: 'Play' }).click();
		await page.waitForTimeout(8000);
		const played = await results(page);
		expect(played.playing).toBe(true);
		expect(played.current).toBeGreaterThan(0);
		expect(played.lagSamples).toBeGreaterThan(10);
		expect(played.turns).toBeGreaterThanOrEqual(1);
		expect(played.visible?.first).not.toBe(visible.first);
		if (browserName === 'chromium') expect(played.lagP95!).toBeLessThan(100);

		// Speed, then pause.
		await page.getByRole('combobox', { name: 'Speed' }).selectOption('2');
		await page.waitForTimeout(3000);
		const fast = await results(page);
		expect(fast.rate).toBe(2);
		await page.getByRole('button', { name: 'Pause' }).click();
		const paused = await results(page);
		expect(paused.playing).toBe(false);

		const report = { browserName, engine, opened, played, fast, paused };
		mkdirSync('test-results/spike', { recursive: true });
		writeFileSync(
			`test-results/spike/narration-${engine}-${browserName}.json`,
			JSON.stringify(report, null, 2)
		);
		await info.attach('narration-report', {
			body: JSON.stringify(report, null, 2),
			contentType: 'application/json'
		});
	});
}
