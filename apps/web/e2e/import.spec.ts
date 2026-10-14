import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { bigEpub } from './books';
import { expect, openDevPanel, test } from './fixtures';

// P1-ING-02 acceptance and the Phase 1.2 Try-it import items: import an EPUB, import it again
// (nothing happens), import a broken file (a readable reason), and a 150,000-word EPUB within
// budget. Also D-026: the browser's WordIds match Node's byte for byte.

const STATUS_WINDOW = new URL('../../../fixtures/epub/status-window.epub', import.meta.url);

async function importFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
	await page.goto('/library');
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Import EPUB' }).first().click();
	await (await chooser).setFiles(file);
}

const epubFile = (name: string, bytes: Uint8Array) => ({
	name,
	mimeType: 'application/epub+zip',
	buffer: Buffer.from(bytes)
});

test('imports an EPUB, reports on it, and opens it', async ({ page }) => {
	await importFile(page, epubFile('status-window.epub', readFileSync(STATUS_WINDOW)));
	const dialog = page.getByRole('dialog', { name: 'Imported' });
	await expect(dialog.getByTestId('import-summary')).toHaveText(
		/^Imported .+: 2 chapters, [\d,]+ words\.$/
	);
	await dialog.getByRole('link', { name: 'Read now' }).click();
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
});

test('importing the same file again changes nothing', async ({ page }) => {
	const file = epubFile('status-window.epub', readFileSync(STATUS_WINDOW));
	await importFile(page, file);
	await expect(page.getByRole('dialog', { name: 'Imported' })).toBeVisible();
	const title = (await page.getByTestId('import-summary').textContent())!.replace(
		/^Imported (.+): .*$/,
		'$1'
	);
	await page.getByRole('button', { name: 'Close' }).click();
	await importFile(page, file);
	await expect(page.getByRole('dialog', { name: 'Already in your library' })).toContainText(
		'Nothing changed'
	);
	await page.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByRole('link', { name: new RegExp(title) })).toHaveCount(1);
});

test('a broken file gets a reason the reader can act on', async ({ page }) => {
	await importFile(page, {
		name: 'not-really.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from('this is a text file, not an EPUB')
	});
	await expect(page.getByTestId('import-error')).toHaveText(
		/isn’t an EPUB: it can’t be opened as a ZIP archive/
	);
	await page.getByRole('button', { name: 'Close' }).click();
	await importFile(page, epubFile('zip.epub', zipSync({ 'readme.txt': strToU8('hi') })));
	await expect(page.getByTestId('import-error')).toHaveText(/not an EPUB/);
});

test('a 150,000-word EPUB imports within 10 s, with progress and a responsive page', async ({
	page
}) => {
	test.slow();
	const started = Date.now();
	await importFile(page, epubFile('big.epub', bigEpub()));
	await expect(page.getByRole('progressbar', { name: /Importing big.epub/ })).toBeVisible();
	// The main thread stays free while the worker processes: a timer keeps firing on time.
	const ticks = await page.evaluate(
		() =>
			new Promise<number>((resolve) => {
				let n = 0;
				const timer = setInterval(() => n++, 50);
				setTimeout(() => {
					clearInterval(timer);
					resolve(n);
				}, 1000);
			})
	);
	expect(ticks).toBeGreaterThan(10);
	await expect(page.getByTestId('import-summary')).toHaveText(/30 chapters, 150,000 words/, {
		timeout: 20_000
	});
	expect(Date.now() - started).toBeLessThan(10_000);
});

test('the browser’s WordIds match Node’s exactly (D-026, OPEN-14)', async ({ page }) => {
	// The dev panel imports the status-window fixture in this browser; its stored files must be
	// byte-identical to the golden files Node's text-pipeline wrote.
	await openDevPanel(page);
	await page.getByRole('button', { name: 'Import the status-window fixture' }).click();
	await expect(page.getByTestId('import-summary')).toBeVisible({ timeout: 20_000 });
	const golden = (path: string) =>
		readFileSync(
			new URL(`../../../packages/text-pipeline/golden/status-window/${path}`, import.meta.url),
			'utf8'
		);
	for (const path of [
		'index/text/chapter-1.xhtml.words.json',
		'index/text/chapter-2.xhtml.words.json',
		'content/text/chapter-1.xhtml',
		'content/text/chapter-2.xhtml',
		'manifest.json'
	]) {
		const stored = await page.evaluate(async (file) => {
			const dbs = await indexedDB.databases();
			const name = dbs.map((d) => d.name).find((n) => n?.startsWith('book-reader:'))!;
			return new Promise<string>((resolve, reject) => {
				const open = indexedDB.open(name);
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const db = open.result;
					const all = db.transaction('libraryFiles').objectStore('libraryFiles').getAll();
					all.onsuccess = async () => {
						const record = (all.result as { path: string; bytes: ArrayBuffer }[]).find(
							(r) => r.path === file
						);
						db.close();
						resolve(record ? new TextDecoder().decode(record.bytes) : '');
					};
				};
			});
		}, path);
		// An import takes its Book ID from dc:identifier; the golden run named it explicitly.
		const sameBook = (text: string) => text.replace(/^\{"version":1,"bookId":"[^"]+"/, '');
		expect(sameBook(stored), path).toBe(sameBook(golden(path)));
	}
});
