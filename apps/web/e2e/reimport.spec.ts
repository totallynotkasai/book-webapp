import type { Page } from '@playwright/test';
import { expect, openDevPanel, settled, storedRecords, test } from './fixtures';

// Phase 1.3 Try-it (IMPLEMENTATION-PLAN.md §6) and P1-ING-03 acceptance: re-import an edited copy
// of Alice (one paragraph changed, one deleted). Notes elsewhere keep their WordIds; the note on
// deleted text shows as orphaned.

test.use({ viewport: { width: 1280, height: 800 } });

interface StoredAnnotation {
	id: string;
	anchorStatus: string;
	anchor: { revisionId: string; startWordId: number; endWordId: number; quote: { exact: string } };
}

const bookFrame = (page: Page) => page.frames().find((f) => f.url().startsWith('blob:'))!;

/** Drags over Words `from`..`to` of the paragraph starting with `text`, turning pages to it. */
async function highlightIn(page: Page, text: string, colour: string) {
	for (let turn = 0; turn < 12; turn++) {
		const points = await bookFrame(page).evaluate((start) => {
			const frame = window.frameElement!.getBoundingClientRect();
			const p = [...document.querySelectorAll('p')].find((el) =>
				(el.textContent ?? '').trim().replace(/\s+/g, ' ').startsWith(start)
			);
			if (!p) return null;
			// Words across all of the paragraph's text (inline markup splits it into several nodes).
			const words: { node: Text; index: number }[] = [];
			const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
			for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
				for (const m of n.data.matchAll(/\S+/g)) words.push({ node: n, index: m.index! });
			}
			const at = (w: { node: Text; index: number }) => {
				const range = document.createRange();
				range.setStart(w.node, w.index + 1);
				range.setEnd(w.node, w.index + 2);
				const r = range.getBoundingClientRect();
				return { x: frame.left + r.left, y: frame.top + r.top + r.height / 2 };
			};
			const a = at(words[1]!);
			const b = at(words[4]!);
			const width = window.top!.innerWidth;
			return a.x > 0 && b.x < width && a.x < width ? { a, b } : null;
		}, text);
		if (points) {
			await page.mouse.move(points.a.x, points.a.y);
			await page.mouse.down();
			await page.mouse.move(points.b.x, points.b.y, { steps: 5 });
			await page.mouse.up();
			await page
				.getByRole('toolbar', { name: 'Selection' })
				.getByRole('button', { name: `Highlight ${colour}` })
				.click();
			return;
		}
		await page.keyboard.press('ArrowRight');
		await settled(page);
	}
	throw new Error(`Paragraph not found: ${text}`);
}

test('re-importing an edited copy keeps notes on their Words and orphans the deleted one', async ({
	page
}) => {
	test.slow();
	await openDevPanel(page);
	await page.getByRole('button', { name: 'Import Rackham’s illustrated Alice' }).click();
	await page.getByRole('link', { name: 'Read now' }).click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	// This Gutenberg file's Contents lists no chapters: End goes to the end of the front matter,
	// and the next page is Chapter I.
	await page.keyboard.press('End');
	await settled(page);
	await page.keyboard.press('ArrowRight');
	await settled(page);
	await highlightIn(page, 'So she was considering', 'green');
	await highlightIn(page, 'There was nothing so', 'pink');
	await expect
		.poll(async () => (await storedRecords(page, 'user-reader', 'annotations')).length)
		.toBe(2);
	const before = await storedRecords<StoredAnnotation>(page, 'user-reader', 'annotations');
	const kept = before.find((a) => a.anchor.quote.exact.startsWith('she was'))!;
	const doomed = before.find((a) => a.anchor.quote.exact.startsWith('was nothing'))!;
	expect(kept && doomed).toBeTruthy();

	await openDevPanel(page);
	await page.getByRole('button', { name: 'Import an edited copy of Rackham’s Alice' }).click();
	const dialog = page.getByRole('dialog', { name: 'Imported' });
	await expect(dialog.getByTestId('import-migration')).toContainText(
		'1 note or bookmark moved to it. 1 note or bookmark couldn’t be placed',
		{ timeout: 30_000 }
	);

	const after = await storedRecords<StoredAnnotation>(page, 'user-reader', 'annotations');
	const moved = after.find((a) => a.id === kept.id)!;
	expect(moved.anchorStatus).toBe('migrated');
	expect(moved.anchor.revisionId).not.toBe(kept.anchor.revisionId);
	expect(moved.anchor.startWordId).toBe(kept.anchor.startWordId);
	expect(moved.anchor.endWordId).toBe(kept.anchor.endWordId);
	const orphan = after.find((a) => a.id === doomed.id)!;
	expect(orphan.anchorStatus).toBe('orphaned');

	// In the reader: the kept note is painted, and the orphaned one is listed with its quote.
	await dialog.getByRole('link', { name: 'Read now' }).click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await page.keyboard.press('n');
	const sheet = page.getByRole('dialog', { name: 'Contents and notes' });
	const orphaned = sheet.getByRole('region', { name: 'Orphaned' });
	await expect(orphaned).toContainText(doomed.anchor.quote.exact);
	await sheet
		.getByRole('button', { name: new RegExp(kept.anchor.quote.exact.slice(0, 20)) })
		.click();
	await settled(page);
	await expect
		.poll(() => bookFrame(page).evaluate(() => CSS.highlights.get('rd-highlight-2')?.size ?? 0))
		.toBe(1);
});
