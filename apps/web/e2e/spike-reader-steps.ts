// SPIKE (P0-04): the ADR-001 measurement run, shared by the Playwright spec (desktop Chromium and
// WebKit) and scripts/spike-phone.ts (the Android WebView over adb). No `expect`, so it also runs
// outside the test runner. Reports go to spike-results/ (Playwright wipes test-results/).
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

export const ENGINES = ['foliate', 'readium'] as const;
export const RESULTS_DIR = 'spike-results';

export async function waitOpened(page: Page, engines: readonly string[] = ENGINES) {
	for (const id of engines) {
		await page.waitForFunction(
			(testId) =>
				document.querySelector(`[data-testid="${testId}"]`)?.textContent?.includes('Opened'),
			`status-${id}`,
			{ timeout: 90_000 }
		);
	}
}

async function texts(page: Page, prefix: string, engines: readonly string[] = ENGINES) {
	const out: Record<string, string> = {};
	for (const id of engines) {
		out[id] =
			(await page
				.getByTestId(`${prefix}-${id}`)
				.textContent({ timeout: 3000 })
				.catch(() => '?')) ?? '';
	}
	return out;
}

export const visible = (page: Page, engines?: readonly string[]) => texts(page, 'visible', engines);

function results(page: Page) {
	return page.evaluate(() =>
		(globalThis as unknown as { __spikeResults: () => unknown }).__spikeResults()
	);
}

export interface RunOptions {
	label: string;
	/** Which panes to show: both side by side (desktop), or one at a time (phone). */
	show: 'both' | 'foliate' | 'readium';
	screenshots?: boolean;
	settle?: number;
	/** P0-05 option: A (spans, the default) or B (Blocks + offsets). */
	marking?: 'spans' | 'offsets';
}

/** Runs ADR-001's criteria on /spike/reader (already open) and writes a JSON report. */
export async function runCriteria(page: Page, options: RunOptions) {
	const engines = options.show === 'both' ? ENGINES : [options.show];
	const settle = options.settle ?? 400;
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	mkdirSync(RESULTS_DIR, { recursive: true });
	const shot = async (name: string) => {
		if (options.screenshots !== false) {
			await page.screenshot({ path: `${RESULTS_DIR}/${name}-${options.label}.png` });
		}
	};

	const book = page.getByRole('combobox', { name: 'Book' });
	const chapter = page.getByRole('combobox', { name: 'Chapter' });
	if (options.marking) {
		await page.getByRole('combobox', { name: 'Word marking' }).selectOption(options.marking);
		await waitOpened(page);
	}
	await page.getByRole('combobox', { name: 'Show' }).selectOption(options.show);
	await waitOpened(page, engines);

	const log: Record<string, unknown>[] = [];
	const step = async (name: string, action: () => Promise<void>) => {
		await action();
		await page.waitForTimeout(settle);
		log.push({
			step: name,
			kept: await texts(page, 'kept', engines),
			visible: await visible(page, engines)
		});
	};
	const click = (name: string, role: 'button' | 'radio' = 'button') =>
		page.getByRole(role, { name }).click();

	await step('chapter 1', async () => {
		await chapter.selectOption({ index: 2 });
		await page.waitForTimeout(1500);
	});
	for (let i = 0; i < 6; i++) await step(`next ${i + 1}`, () => click('Next page'));
	for (let i = 0; i < 3; i++) await step(`A+ ${i + 1}`, () => click('Larger text'));
	for (let i = 0; i < 3; i++) await step(`A− ${i + 1}`, () => click('Smaller text'));
	await step('spread', () => click('Spread', 'radio'));
	await shot('spread');
	await step('scroll', () => click('Scroll', 'radio'));
	await step('single', () => click('Single', 'radio'));
	await step('highlight', () => click('Highlight'));
	await shot('highlight');
	await step('insert figure', () => click('Insert figure'));
	await shot('figure');
	const figures = await texts(page, 'figure', engines);
	const stats = () =>
		page
			.getByTestId('chapter-stats')
			.textContent({ timeout: 2000 })
			.catch(() => null);
	const chapterStats = await stats();
	const alice = await results(page);

	// Criterion 7: a ~10,800-word chapter with every Word marked.
	await book.selectOption('alice-long');
	await waitOpened(page, engines);
	await page.waitForTimeout(1000);
	for (let i = 0; i < 8; i++) await step(`long next ${i + 1}`, () => click('Next page'));
	for (let i = 0; i < 2; i++) await step(`long A+ ${i + 1}`, () => click('Larger text'));
	const long = await results(page);

	const report = {
		label: options.label,
		marking: options.marking ?? 'spans',
		chapterStats,
		longStats: await stats(),
		alice,
		long,
		figures,
		errors,
		log
	};
	writeFileSync(`${RESULTS_DIR}/reader-${options.label}.json`, JSON.stringify(report, null, 2));
	return report;
}

/** Opens every fixture in the engines shown; returns status and visible Words per book. */
export async function openFixtures(page: Page, options: RunOptions) {
	const engines = options.show === 'both' ? ENGINES : [options.show];
	const out: Record<string, unknown> = {};
	await page.getByRole('combobox', { name: 'Show' }).selectOption(options.show);
	for (const id of ['status-window', 'rackham', 'serial']) {
		await page.getByRole('combobox', { name: 'Book' }).selectOption(id);
		await waitOpened(page, engines);
		await page.getByRole('combobox', { name: 'Chapter' }).selectOption({ index: 1 });
		await page.waitForTimeout(1200);
		await page.getByRole('button', { name: 'Next page' }).click();
		await page.waitForTimeout(600);
		if (options.screenshots !== false) {
			await page.screenshot({ path: `${RESULTS_DIR}/fixture-${id}-${options.label}.png` });
		}
		out[id] = {
			status: await texts(page, 'status', engines),
			visible: await visible(page, engines)
		};
	}
	writeFileSync(`${RESULTS_DIR}/fixtures-${options.label}.json`, JSON.stringify(out, null, 2));
	return out;
}

/**
 * A screen-reader proxy for P0-05: the accessibility tree of the first paragraphs in Readium's
 * frame (foliate-js keeps its frames in a closed shadow root). TalkBack is checked on the phone.
 */
export async function ariaSample(page: Page) {
	const frame = page.frameLocator('.readium-navigator-iframe:not([style*="hidden"])').first();
	const paragraphs = frame.locator('p');
	const out: string[] = [];
	for (let i = 0; i < 3; i++) {
		out.push(
			await paragraphs
				.nth(i)
				.ariaSnapshot({ timeout: 5000 })
				.catch((e: Error) => `(${e.message.split('\n')[0]})`)
		);
	}
	return out;
}
