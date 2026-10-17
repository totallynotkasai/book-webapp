import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';

// E2E runs backend-local with no latency, no injected failures and a fixed clock (plan §9).
// Specs that need failures switch them on through the dev panel.
export const E2E_NOW = new Date('2026-10-11T09:00:00.000Z');

export const test = base.extend<{ welcomed: boolean; fixedClock: boolean }>({
	/** False shows the first-run welcome (P1-QA-03); every other spec starts past it. */
	welcomed: [true, { option: true }],
	/** False keeps the real clock: the performance spec times things in the page (P1-QA-01). */
	fixedClock: [true, { option: true }],
	page: async ({ page, welcomed, fixedClock }, use) => {
		await page.addInitScript((seen) => {
			if (seen) localStorage.setItem('book-welcome', 'seen');
			globalThis.__BOOK_E2E_SIMULATION__ = {
				latencyMs: { min: 0, max: 0 },
				failureRate: 0,
				offline: false,
				emptyLists: false,
				paymentOutcome: 'succeed',
				aiDetectorVerdict: 'clean',
				clockOffsetMs: 0
			};
			// No device voice unless a spec installs one (e2e/speech.ts): headless Chromium has
			// the system's voices on Windows and none on CI's Linux (ADR-006).
			Object.defineProperty(globalThis, 'speechSynthesis', {
				value: undefined,
				configurable: true
			});
		}, welcomed);
		if (fixedClock) await page.clock.setFixedTime(E2E_NOW);
		await use(page);
	}
});

export { expect };

/** Opens the dev panel and waits for it to finish loading its controls. */
export async function openDevPanel(page: Page) {
	await page.goto('/dev');
	await expect(page.getByRole('radio').first()).toBeVisible();
}

export async function switchPersona(page: Page, label: string) {
	await openDevPanel(page);
	const radio = page.getByRole('radio', { name: new RegExp(`^${label}\\b`) });
	// Choosing the Persona already signed in changes nothing, so there is no reload to wait for.
	if (await radio.isChecked()) return;
	await Promise.all([page.waitForEvent('load'), radio.check()]);
}

/** Waits until the dev panel's last simulation change has been written. */
export async function expectSaved(page: Page) {
	await expect(page.getByTestId('simulation-status')).toHaveText('Saved');
}

/**
 * The global Reader Preferences stored for a user, read straight from IndexedDB. Never creates
 * the database (that would block the app's own upgrade) and always closes its connection.
 */
export function storedPreferences(page: Page, userId: string) {
	return page.evaluate(
		(name) =>
			new Promise<unknown>((resolve) => {
				const open = indexedDB.open(name);
				open.onupgradeneeded = () => open.transaction?.abort();
				open.onerror = () => resolve(undefined);
				open.onsuccess = () => {
					const db = open.result;
					if (!db.objectStoreNames.contains('preferences')) {
						db.close();
						return resolve(undefined);
					}
					const get = db.transaction('preferences').objectStore('preferences').get('__global__');
					get.onsuccess = () => resolve(get.result);
					get.onerror = () => resolve(undefined);
					get.transaction.oncomplete = () => db.close();
				};
			}),
		`book-reader:${userId}`
	);
}

/** Every live record in one of a user's Stores object stores (soft-deleted ones left out). */
export function storedRecords<T = Record<string, unknown>>(
	page: Page,
	userId: string,
	store: string
): Promise<T[]> {
	return page.evaluate(
		([name, storeName]) =>
			new Promise<T[]>((resolve) => {
				const open = indexedDB.open(name!);
				open.onupgradeneeded = () => open.transaction?.abort();
				open.onerror = () => resolve([]);
				open.onsuccess = () => {
					const db = open.result;
					if (!db.objectStoreNames.contains(storeName!)) {
						db.close();
						return resolve([]);
					}
					const all = db.transaction(storeName!).objectStore(storeName!).getAll();
					all.onsuccess = () =>
						resolve(
							(all.result as { deletedAt?: string | null }[]).filter((r) => !r.deletedAt) as T[]
						);
					all.onerror = () => resolve([]);
					all.transaction.oncomplete = () => db.close();
				};
			}),
		[`book-reader:${userId}`, store]
	);
}

/** Waits until a font-scale change has been written, so navigating away can't lose it. */
export async function expectStoredFontScale(page: Page, userId: string, fontScale: number) {
	await expect.poll(() => storedPreferences(page, userId)).toMatchObject({ fontScale });
}

/** Opens a Book in the reader and waits until its first page is laid out. */
export async function openReader(page: Page, bookId: string) {
	await page.goto(`/read/${bookId}`);
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await expect(page.getByTestId('reader')).toHaveAttribute('data-first', /\d+/);
}

/** The visible Words' Ordinals and the first Word's text, as the reader reports them. */
export async function visibleWords(page: Page) {
	const reader = page.getByTestId('reader');
	return {
		first: Number(await reader.getAttribute('data-first')),
		last: Number(await reader.getAttribute('data-last')),
		word: (await reader.getAttribute('data-first-word')) ?? ''
	};
}

/** Whether some text of the book is on the page showing now, in any of the reader's frames. */
export async function textOnScreen(page: Page, text: string): Promise<boolean> {
	for (const frame of page.frames().filter((f) => f.url().startsWith('blob:'))) {
		const shown = await frame.evaluate((needle) => {
			const host = window.frameElement?.getBoundingClientRect();
			if (!host || !document.body) return false;
			const has = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').includes(needle);
			// The innermost elements holding the text, where it's laid out.
			const holders = [...document.body.querySelectorAll('*')].filter(
				(el) => has(el) && ![...el.children].some(has)
			);
			return holders.some((el) => {
				const r = el.getBoundingClientRect();
				const left = host.left + r.left;
				const top = host.top + r.top;
				return (
					r.width > 0 &&
					left + r.width > 0 &&
					left < window.top!.innerWidth &&
					top + r.height > 0 &&
					top < window.top!.innerHeight
				);
			});
		}, text);
		if (shown) return true;
	}
	return false;
}

/** Waits for the reader to settle on a new position after an action. */
export async function settled(page: Page) {
	await page.waitForTimeout(250);
	await expect
		.poll(async () => {
			const a = await visibleWords(page);
			await page.waitForTimeout(150);
			const b = await visibleWords(page);
			return a.first === b.first && a.last === b.last;
		})
		.toBe(true);
}

/** Opens the reading preferences sheet on a tab. */
export async function openPreferences(page: Page, tab: 'Text' | 'Page' | 'Theme') {
	await showChrome(page);
	await readerAction(page, 'Reading preferences');
	await page.getByRole('tab', { name: tab }).click();
}

/**
 * Presses one of the reader's top-bar buttons; on a phone (under 600 px) search, pictures and
 * reading preferences are in the "More reading options" menu (Phase 1.13).
 */
export async function readerAction(
	page: Page,
	name: 'Reading preferences' | 'Illustrations' | 'Search in this book'
) {
	const more = page.getByRole('button', { name: 'More reading options' });
	if (await more.isVisible()) {
		await more.click();
		await page.getByRole('menuitem', { name }).click();
	} else {
		await page.getByRole('button', { name, exact: true }).click();
	}
}

/** Makes sure the reading controls are showing (they fade after a page turn). */
export async function showChrome(page: Page) {
	const reader = page.getByTestId('reader');
	if (await reader.evaluate((el) => el.classList.contains('chrome-hidden'))) {
		await page.keyboard.press('Escape');
	}
	await expect(reader).not.toHaveClass(/chrome-hidden/);
	await page.waitForTimeout(300);
}

/** axe at WCAG 2.2 AA (IMPLEMENTATION-PLAN.md §9): no violations on what's on screen now. */
export async function expectNoViolations(page: Page, options: { exclude?: string[] } = {}) {
	// Contrast is measured on the settled page: a dialog fading in is half transparent. Endless
	// animations (progress indicators) don't count.
	await page.waitForFunction(
		() =>
			document
				.getAnimations()
				.every(
					(a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity
				),
		undefined,
		{ timeout: 5_000 }
	);
	let axe = new AxeBuilder({ page }).withTags([
		'wcag2a',
		'wcag2aa',
		'wcag21a',
		'wcag21aa',
		'wcag22aa'
	]);
	for (const selector of options.exclude ?? []) axe = axe.exclude(selector);
	const results = await axe.analyze();
	const summary = results.violations.map(
		(v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`
	);
	expect(summary).toEqual([]);
}

/** Drags across a phrase in a paragraph on screen, so the reader selects its Words. */
export async function selectPhrase(page: Page, phrase: string) {
	// A sheet or dialog still closing would take the drag.
	await expect(page.getByRole('dialog')).toHaveCount(0);
	const frame = page.frames().find((f) => f.url().startsWith('blob:'))!;
	const points = await frame.evaluate((text) => {
		const host = window.frameElement!.getBoundingClientRect();
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text) {
			const at = node.data.indexOf(text);
			if (at < 0) continue;
			const point = (offset: number) => {
				const range = document.createRange();
				range.setStart(node!, offset);
				range.setEnd(node!, offset + 1);
				const r = range.getBoundingClientRect();
				return { x: host.left + r.left + r.width / 2, y: host.top + r.top + r.height / 2 };
			};
			const a = point(at + 1);
			const b = point(at + text.length - 2);
			if (a.x < 0 || a.x > window.top!.innerWidth || a.y < 0) continue;
			return { a, b };
		}
		throw new Error(`“${text}” isn’t on screen`);
	}, phrase);
	await page.mouse.move(points.a.x, points.a.y);
	await page.mouse.down();
	await page.mouse.move(points.b.x, points.b.y, { steps: 4 });
	await page.mouse.up();
	await expect(page.getByRole('toolbar', { name: 'Selection' })).toBeVisible();
}
