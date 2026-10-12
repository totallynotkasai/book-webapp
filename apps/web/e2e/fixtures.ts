import { test as base, expect, type Page } from '@playwright/test';

// E2E runs backend-local with no latency, no injected failures and a fixed clock (plan §9).
// Specs that need failures switch them on through the dev panel.
export const E2E_NOW = new Date('2026-10-11T09:00:00.000Z');

export const test = base.extend({
	page: async ({ page }, use) => {
		await page.addInitScript(() => {
			globalThis.__BOOK_E2E_SIMULATION__ = {
				latencyMs: { min: 0, max: 0 },
				failureRate: 0,
				offline: false,
				emptyLists: false,
				paymentOutcome: 'succeed',
				aiDetectorVerdict: 'clean',
				clockOffsetMs: 0
			};
		});
		await page.clock.setFixedTime(E2E_NOW);
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

/** Waits until a font-scale change has been written, so navigating away can't lose it. */
export async function expectStoredFontScale(page: Page, userId: string, fontScale: number) {
	await expect.poll(() => storedPreferences(page, userId)).toMatchObject({ fontScale });
}
