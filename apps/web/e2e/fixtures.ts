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
	await Promise.all([
		page.waitForEvent('load'),
		page.getByRole('radio', { name: new RegExp(`^${label}\\b`) }).check()
	]);
}
