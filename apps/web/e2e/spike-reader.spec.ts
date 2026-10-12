import { expect, test, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

// SPIKE (P0-04): drives both engines on /spike/reader through ADR-001's criteria and records
// measurements. Deleted with the spike. Run: npx playwright test spike-reader --project chromium
const ENGINES = ['foliate', 'readium'] as const;

async function waitOpened(page: Page) {
	for (const id of ENGINES) {
		await expect(page.getByTestId(`status-${id}`)).toContainText('Opened', { timeout: 60_000 });
	}
}

async function kept(page: Page) {
	const out: Record<string, string> = {};
	for (const id of ENGINES)
		out[id] =
			(await page
				.getByTestId(`kept-${id}`)
				.textContent({ timeout: 3000 })
				.catch(() => '?')) ?? '';
	return out;
}

async function visible(page: Page) {
	const out: Record<string, string> = {};
	for (const id of ENGINES) out[id] = (await page.getByTestId(`visible-${id}`).textContent()) ?? '';
	return out;
}

test('both engines through the ADR-001 criteria', async ({ page, browserName }, info) => {
	test.setTimeout(300_000);
	await page.setViewportSize({ width: 1400, height: 950 });
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/spike/reader');
	await waitOpened(page);
	mkdirSync('test-results/spike', { recursive: true });

	const log: Record<string, unknown>[] = [];
	const step = async (name: string, action: () => Promise<void>) => {
		await action();
		await page.waitForTimeout(400);
		log.push({ step: name, kept: await kept(page), visible: await visible(page) });
	};

	await step('chapter 1', async () => {
		await page.getByRole('combobox', { name: 'Chapter' }).selectOption({ index: 2 });
		await page.waitForTimeout(1500);
	});
	for (let i = 0; i < 6; i++)
		await step(`next ${i + 1}`, () => page.getByRole('button', { name: 'Next page' }).click());
	for (let i = 0; i < 3; i++)
		await step(`A+ ${i + 1}`, () => page.getByRole('button', { name: 'Larger text' }).click());
	for (let i = 0; i < 3; i++)
		await step(`A− ${i + 1}`, () => page.getByRole('button', { name: 'Smaller text' }).click());
	await step('spread', () => page.getByRole('radio', { name: 'Spread' }).click());
	await step('scroll', () => page.getByRole('radio', { name: 'Scroll' }).click());
	await step('single', () => page.getByRole('radio', { name: 'Single' }).click());
	await step('highlight', () => page.getByRole('button', { name: 'Highlight' }).click());
	await page.screenshot({ path: `test-results/spike/highlight-${browserName}.png` });
	await step('insert figure', () => page.getByRole('button', { name: 'Insert figure' }).click());
	const figures: Record<string, string> = {};
	for (const id of ENGINES)
		figures[id] =
			(await page
				.getByTestId(`figure-${id}`)
				.textContent({ timeout: 3000 })
				.catch(() => '(none)')) ?? '';

	const alice = await page.evaluate(() =>
		(globalThis as unknown as { __spikeResults: () => unknown }).__spikeResults()
	);

	// Criterion 7: a ~10,800-word chapter.
	await page.getByRole('combobox', { name: 'Book' }).selectOption('alice-long');
	await waitOpened(page);
	await page.waitForTimeout(1000);
	for (let i = 0; i < 8; i++)
		await step(`long next ${i + 1}`, () => page.getByRole('button', { name: 'Next page' }).click());
	for (let i = 0; i < 2; i++)
		await step(`long A+ ${i + 1}`, () => page.getByRole('button', { name: 'Larger text' }).click());
	const long = await page.evaluate(() =>
		(globalThis as unknown as { __spikeResults: () => unknown }).__spikeResults()
	);

	// Spread needs the width of one pane per engine.
	const spread: Record<string, string> = {};
	for (const id of ENGINES) {
		await page.getByRole('combobox', { name: 'Book' }).selectOption('alice');
		await page.getByRole('combobox', { name: 'Show' }).selectOption(id);
		await expect(page.getByTestId(`status-${id}`)).toContainText('Opened', { timeout: 60_000 });
		await page.getByRole('combobox', { name: 'Chapter' }).selectOption({ index: 2 });
		await page.waitForTimeout(1200);
		const single = (await page.getByTestId(`visible-${id}`).textContent()) ?? '';
		await page.getByRole('radio', { name: 'Spread' }).click();
		await page.waitForTimeout(1200);
		spread[id] =
			`single ${single} → spread ${await page.getByTestId(`visible-${id}`).textContent()}`;
		await page.screenshot({ path: `test-results/spike/spread-${id}-${browserName}.png` });
		await page.getByRole('radio', { name: 'Single' }).click();
	}

	const report = { browserName, alice, long, figures, spread, errors, log };
	mkdirSync('test-results/spike', { recursive: true });
	writeFileSync(`test-results/spike/reader-${browserName}.json`, JSON.stringify(report, null, 2));
	await info.attach('spike-report', {
		body: JSON.stringify(report, null, 2),
		contentType: 'application/json'
	});

	// Basic health only; the numbers go into ADR-001.
	for (const id of ENGINES) expect(log.at(-1)?.visible).toHaveProperty(id);
});
