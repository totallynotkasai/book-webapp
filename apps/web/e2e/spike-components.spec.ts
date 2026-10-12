import { expect, test, type Locator, type Page } from '@playwright/test';

// SPIKE P0-10 (OPEN-02): keyboard, screen-reader semantics, reduced motion, touch targets and
// theming for the same four components built with m3-svelte and with Bits UI. The expectations
// that differ between the sets are the ADR-005 findings; measurements are attached as
// annotations. Deleted with the spike code.

type SetId = 'm3' | 'bits';
const SETS: { id: SetId; name: string }[] = [
	{ id: 'm3', name: 'm3-svelte' },
	{ id: 'bits', name: 'Bits UI + our tokens' }
];

/** What each library gives a screen reader (ADR-005 findings). */
const SEMANTICS = {
	// m3-svelte's Menu and MenuItem render a plain div of buttons and accept no ARIA attributes.
	m3: { itemRole: 'button', menuRole: false, sheetName: '' },
	bits: { itemRole: 'menuitem', menuRole: true, sheetName: 'Reading options' }
} as const;

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function openSpike(page: Page) {
	await page.goto('/spike/components');
	for (const { name } of SETS) {
		await expect(region(page, name).getByRole('button', { name: 'Filled' })).toBeVisible();
	}
}

function note(type: string, description: string) {
	test.info().annotations.push({ type, description });
}

const focusIsInside = (locator: Locator) =>
	locator.evaluate((el) => el.contains(document.activeElement));

/** Running animations and transitions, by the set whose DOM they belong to. */
const runningBySet = (page: Page) =>
	page.evaluate(() => {
		const out: Record<'m3' | 'bits', string[]> = { m3: [], bits: [] };
		for (const a of document.getAnimations()) {
			if (a.playState !== 'running') continue;
			const target = (a.effect as KeyframeEffect | null)?.target;
			// m3-svelte renders in place; Bits UI portals its sheet and menu to <body>. m3-svelte's
			// global stylesheet also gives *every* :focus-visible element on the page its
			// focus-outward/focus-inward keyframes, so those count as m3-svelte's wherever they run.
			const m3Keyframes = a instanceof CSSAnimation && a.animationName.startsWith('focus-');
			const owner = m3Keyframes || target?.closest('[data-testid=set-m3]') ? 'm3' : 'bits';
			out[owner].push(
				a instanceof CSSAnimation
					? a.animationName
					: a instanceof CSSTransition
						? `transition:${a.transitionProperty}`
						: 'script'
			);
		}
		return out;
	});

/** Waits until nothing on the page is still animating (finished fill-forwards ones don't count). */
const settled = (page: Page) =>
	expect
		.poll(() =>
			page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
		)
		.toBe(0);

for (const { id, name } of SETS) {
	test.describe(name, () => {
		test('Tab reaches every control, in order, with accessible names', async ({ page }) => {
			await openSpike(page);
			const set = region(page, name);
			await set.getByRole('button', { name: 'Filled', exact: true }).focus();
			const order: [role: 'button' | 'slider', label: string | RegExp][] = [
				['button', 'Tonal'],
				['button', 'Outlined'],
				['button', 'Text'],
				['slider', /^Text size/],
				['button', 'Sort books'],
				['button', 'Reading options']
			];
			for (const [role, label] of order) {
				await page.keyboard.press('Tab');
				await expect(set.getByRole(role, { name: label, exact: true })).toBeFocused();
			}
		});

		test('the slider works from the keyboard', async ({ page }) => {
			await openSpike(page);
			const set = region(page, name);
			const slider = set.getByRole('slider');
			const value = set.getByTestId(`${id}-slider-value`);
			await slider.focus();
			await page.keyboard.press('ArrowRight');
			await expect(value).toHaveText('41');
			await page.keyboard.press('Home');
			await expect(value).toHaveText('0');
			await page.keyboard.press('End');
			await expect(value).toHaveText('100');
			// A native range input exposes its value directly; Bits UI's thumb uses aria-valuenow.
			if (id === 'm3') await expect(slider).toHaveValue('100');
			else await expect(slider).toHaveAttribute('aria-valuenow', '100');
		});

		test('the menu opens, moves, selects and closes from the keyboard', async ({ page }) => {
			await openSpike(page);
			const set = region(page, name);
			const trigger = set.getByRole('button', { name: 'Sort books', exact: true });
			const item = (label: string) =>
				page.getByRole(SEMANTICS[id].itemRole, { name: label, exact: true });

			await trigger.focus();
			await page.keyboard.press('Enter');
			await expect(item('Title')).toBeFocused();
			await expect(trigger).toHaveAttribute('aria-expanded', 'true');
			await page.keyboard.press('ArrowDown');
			await expect(item('Author')).toBeFocused();
			await page.keyboard.press('Enter');
			await expect(item('Author')).toHaveCount(0);
			await expect(trigger).toBeFocused();
			await expect(set.getByTestId(`${id}-last`)).toHaveText('Author');

			// Escape closes and returns focus to the trigger.
			await page.keyboard.press('Enter');
			await expect(item('Title')).toBeFocused();
			await page.keyboard.press('Escape');
			await expect(item('Title')).toHaveCount(0);
			await expect(trigger).toBeFocused();
			await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		});

		test('the menu exposes menu semantics to screen readers', async ({ page }) => {
			await openSpike(page);
			const set = region(page, name);
			await set.getByRole('button', { name: 'Sort books', exact: true }).click();
			await expect(
				page.getByRole(SEMANTICS[id].itemRole, { name: 'Title', exact: true })
			).toBeVisible();
			await expect(page.getByRole('menu')).toHaveCount(SEMANTICS[id].menuRole ? 1 : 0);
			await expect(page.getByRole('menuitem')).toHaveCount(SEMANTICS[id].menuRole ? 3 : 0);
		});

		test('the bottom sheet traps focus, closes on Escape and returns focus', async ({ page }) => {
			await openSpike(page);
			const set = region(page, name);
			const trigger = set.getByRole('button', { name: 'Reading options', exact: true });
			const sheet = page.getByRole('dialog');

			await trigger.focus();
			await page.keyboard.press('Enter');
			await expect(sheet).toBeVisible();
			await expect(sheet).toHaveAccessibleName(SEMANTICS[id].sheetName);
			await expect.poll(() => focusIsInside(sheet)).toBe(true);

			// Tab never reaches anything behind the sheet. (A native modal <dialog> lets focus pass
			// through the document itself, i.e. <body>, between its last and first controls.)
			const outside: string[] = [];
			for (let i = 1; i <= 4; i++) {
				await page.keyboard.press('Tab');
				if (!(await focusIsInside(sheet))) {
					outside.push(`${i}:${await page.evaluate(() => document.activeElement?.tagName)}`);
				}
			}
			note(`${id}: Tab presses that left the sheet (of 4)`, outside.join(', ') || 'none');
			for (const stop of outside) expect(stop).toMatch(/:BODY$/);

			await page.keyboard.press('Escape');
			await expect(sheet).toHaveCount(0);
			await expect(trigger).toBeFocused();

			// The sheet's own Done button closes it and returns focus too.
			await page.keyboard.press('Enter');
			await expect(sheet).toBeVisible();
			await sheet.getByRole('button', { name: 'Done' }).click();
			await expect(sheet).toHaveCount(0);
			await expect(trigger).toBeFocused();
		});

		test('the bottom sheet fills the bottom edge on a narrow viewport', async ({ page }) => {
			await page.setViewportSize({ width: 360, height: 780 });
			await openSpike(page);
			await region(page, name).getByRole('button', { name: 'Reading options' }).click();
			const sheet = page.getByRole('dialog');
			await expect(sheet).toBeVisible();
			await settled(page); // let the opening animation finish before measuring
			const box = await sheet.boundingBox();
			expect(box).not.toBeNull();
			expect(box!.x).toBeCloseTo(0, 0);
			expect(box!.width).toBeCloseTo(360, 0);
			expect(box!.y + box!.height).toBeCloseTo(780, 0);
		});
	});
}

test('reduced motion: which animations still run', async ({ page }) => {
	/** Opens a set's sheet from the keyboard and returns what that set is animating. */
	const openSheet = async (id: SetId, setName: string) => {
		await settled(page);
		await region(page, setName).getByRole('button', { name: 'Reading options' }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('dialog')).toBeVisible();
		const list = (await runningBySet(page))[id];
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);
		return list;
	};
	/** Moves keyboard focus onto the set's Filled button and returns what that set is animating. */
	const keyboardFocus = async (id: SetId, setName: string) => {
		await region(page, setName).getByRole('button', { name: 'Tonal' }).focus();
		await settled(page);
		await page.keyboard.press('Shift+Tab');
		return (await runningBySet(page))[id];
	};

	const results: Record<string, Record<string, string[]>> = {};
	for (const reducedMotion of ['no-preference', 'reduce'] as const) {
		await page.emulateMedia({ reducedMotion });
		await openSpike(page);
		for (const { id, name } of SETS) {
			results[`${id} ${reducedMotion}`] = {
				sheet: await openSheet(id, name),
				focus: await keyboardFocus(id, name)
			};
		}
	}
	for (const [key, value] of Object.entries(results)) note(`motion: ${key}`, JSON.stringify(value));

	// Bits UI: with reduced motion our CSS runs no animations at all (Invariant 12).
	expect(results['bits reduce'].sheet).toEqual([]);
	expect(results['bits reduce'].focus).toEqual([]);
	// Whether an animation is caught *running* depends on timing, so the presence findings (our
	// sheet animates normally; m3-svelte's sheet and focus ring ignore reduced motion, ADR-005) are
	// recorded as notes rather than asserted, to keep CI deterministic under load.
	note(
		'bits sheet animates without reduce',
		String(results['bits no-preference'].sheet.length > 0)
	);
	note('m3 sheet animates under reduce', String(results['m3 reduce'].sheet.length > 0));
	note('m3 focus ring under reduce', String(results['m3 reduce'].focus.includes('focus-outward')));
});

test('touch targets: measured heights', async ({ page }) => {
	await openSpike(page);
	const heights: Record<string, number[]> = {};
	const measure = async (label: string, locator: Locator) => {
		const boxes = await Promise.all((await locator.all()).map((l) => l.boundingBox()));
		heights[label] = boxes.map((b) => Math.round(b?.height ?? 0));
	};
	for (const { id, name } of SETS) {
		const set = region(page, name);
		await measure(`${id} buttons`, set.getByRole('button'));
		await measure(
			`${id} slider hit area`,
			id === 'm3' ? set.getByRole('slider') : set.locator('.b-slider')
		);
		await set.getByRole('button', { name: 'Sort books' }).click();
		await settled(page); // the menu's open animation scales it
		await measure(
			`${id} menu items`,
			page.getByRole(SEMANTICS[id].itemRole, { name: /^(Title|Author|Recently read)$/ })
		);
		await page.keyboard.press('Escape');
	}
	for (const [key, value] of Object.entries(heights)) note(`height: ${key}`, value.join(', '));

	for (const key of ['bits buttons', 'bits slider hit area', 'bits menu items']) {
		for (const h of heights[key]) expect(h, key).toBeGreaterThanOrEqual(48);
	}
	// m3-svelte's default button (size "s") is 40 px with no larger hit area; slider 44 px.
	expect(Math.max(...heights['m3 buttons'])).toBeLessThan(48);
	expect(heights['m3 slider hit area'][0]).toBeLessThan(48);
	expect(Math.min(...heights['m3 menu items'])).toBeGreaterThanOrEqual(48);
});

test('both sets follow a live switch of seed, mode and contrast', async ({ page }) => {
	await openSpike(page);
	const toRgb = (hex: string) => {
		const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
		return `rgb(${r}, ${g}, ${b})`;
	};
	const filled = (setName: string) =>
		region(page, setName).getByRole('button', { name: 'Filled', exact: true });
	const background = (l: Locator) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
	const expectBothFollow = async () => {
		const primary = (await page.getByTestId('token-primary').textContent()) ?? '';
		for (const { name } of SETS) {
			await expect.poll(() => background(filled(name))).toBe(toRgb(primary));
		}
		return primary;
	};

	const seen = new Set([await expectBothFollow()]);
	await page.getByRole('radio', { name: 'Dark' }).check();
	seen.add(await expectBothFollow());
	await page.getByRole('radio', { name: 'High' }).check();
	seen.add(await expectBothFollow());
	await page.getByLabel(/^Seed colour/).fill('#8a3b12');
	await expect(page.getByTestId('seed')).toHaveText('#8a3b12');
	seen.add(await expectBothFollow());
	expect(seen.size).toBe(4);

	// The UI font stack from tokens.css reaches both sets (Arial Rounded MT is never bundled).
	for (const { name } of SETS) {
		expect(await filled(name).evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
			'Arial Rounded MT'
		);
	}
});
