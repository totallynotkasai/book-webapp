import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import {
	ariaSample,
	ENGINES,
	openFixtures,
	RESULTS_DIR,
	runCriteria,
	waitOpened
} from './spike-reader-steps';

// SPIKE (P0-04): drives both engines on /spike/reader through ADR-001's criteria and writes
// measurements to apps/web/spike-results/. Deleted with the spike.
// Run: npx playwright test spike-reader --project chromium --project webkit

test('both engines through the ADR-001 criteria', async ({ page, browserName }) => {
	test.setTimeout(300_000);
	await page.setViewportSize({ width: 1400, height: 950 });
	await page.goto('/spike/reader');
	await waitOpened(page);
	const report = await runCriteria(page, { label: `${browserName}-desktop`, show: 'both' });
	// Basic health only; the numbers go into ADR-001.
	expect(report.log.length).toBeGreaterThan(20);
});

for (const id of ENGINES) {
	test(`${id} alone at full width (spread and budgets without a second pane)`, async ({
		page,
		browserName
	}) => {
		test.setTimeout(300_000);
		await page.setViewportSize({ width: 1400, height: 950 });
		await page.goto('/spike/reader');
		await waitOpened(page);
		await runCriteria(page, { label: `${browserName}-${id}-wide`, show: id });
	});
}

test('both engines open every fixture', async ({ page, browserName }) => {
	test.setTimeout(240_000);
	await page.setViewportSize({ width: 1400, height: 950 });
	await page.goto('/spike/reader');
	await waitOpened(page);
	const results = (await openFixtures(page, { label: browserName, show: 'both' })) as Record<
		string,
		{ status: Record<string, string> }
	>;
	for (const r of Object.values(results)) {
		for (const id of ENGINES) expect(r.status[id]).toContain('Opened');
	}
});

// P0-05 (OPEN-13): the same run with each Word-marking option, plus an accessibility sample.
for (const marking of ['spans', 'offsets'] as const) {
	test(`word marking ${marking}`, async ({ page, browserName }) => {
		test.setTimeout(300_000);
		await page.setViewportSize({ width: 1400, height: 950 });
		await page.goto('/spike/reader');
		await waitOpened(page);
		const report = await runCriteria(page, {
			label: `${browserName}-marking-${marking}`,
			show: 'both',
			marking
		});
		// Back to chapter 1 for a comparable accessibility sample.
		await page.getByRole('combobox', { name: 'Book' }).selectOption('alice');
		await waitOpened(page);
		await page.getByRole('combobox', { name: 'Chapter' }).selectOption({ index: 2 });
		await page.waitForTimeout(1500);
		const aria = await ariaSample(page);
		const visible = await page.getByTestId('visible-readium').textContent();
		writeFileSync(
			`${RESULTS_DIR}/aria-${browserName}-${marking}.json`,
			JSON.stringify({ visible, aria }, null, 2)
		);
		expect(report.log.length).toBeGreaterThan(20);
	});
}

// Criterion 4 / Invariant 5: a selection from mid-Word to mid-Word snaps to whole Words.
for (const marking of ['spans', 'offsets'] as const) {
	test(`selection snaps to whole Words (${marking})`, async ({ page }) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1400, height: 950 });
		await page.goto('/spike/reader');
		await waitOpened(page);
		await page.getByRole('combobox', { name: 'Word marking' }).selectOption(marking);
		await waitOpened(page);
		await page.getByRole('combobox', { name: 'Chapter' }).selectOption({ index: 2 });
		await page.waitForTimeout(1500);
		for (const id of ENGINES) {
			// Select via the engine's documents, from the middle of Word A to the middle of Word B.
			const result = await page.evaluate(
				async ({ engineId }) => {
					type Engine = {
						documents(): Document[];
						visibleWords(): { first: number } | null;
					};
					const engine = (globalThis as unknown as { __spike: Record<string, Engine> }).__spike[
						engineId
					]!;
					const doc = engine.documents()[0]!;
					const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
					const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
					const words: [Text, number, number, string][] = [];
					while (walker.nextNode()) {
						const node = walker.currentNode as Text;
						if (node.parentElement?.closest('script, style')) continue;
						for (const s of segmenter.segment(node.data)) {
							if (s.isWordLike) words.push([node, s.index, s.index + s.segment.length, s.segment]);
						}
					}
					// Pick long Words a few apart, well inside the visible page.
					const pick = words.findIndex((w, i) => i > 40 && w[3].length >= 5);
					const a = words[pick]!;
					const b = words.slice(pick + 3).find((w) => w[3].length >= 5)!;
					const bIndex = words.indexOf(b);
					const selection = doc.getSelection()!;
					selection.setBaseAndExtent(a[0], a[1] + 2, b[0], b[1] + 2);
					await new Promise((r) => setTimeout(r, 400));
					return { a: a[3], b: b[3], words: bIndex - pick + 1 };
				},
				{ engineId: id }
			);
			const shown = await page.getByTestId(`selection-${id}`).textContent();
			const match = /Words (\d+)–(\d+)/.exec(shown ?? '');
			expect(match, `${id}: ${shown}`).not.toBeNull();
			const [start, end] = [Number(match![1]), Number(match![2])];
			// Snapped to whole Words: the range covers exactly the Words touched, A through B.
			expect(end - start + 1, `${id} ${result.a}…${result.b}`).toBe(result.words);
		}
	});
}
