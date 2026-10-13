// P1-MOB-01: DESIGN.md's Phase 1 exit flow, run inside the installed Android app (the tester
// APK by default) through its WebView. It checks what can be checked from inside the app; the
// rest (locking the screen, the system's media controls, rotating, TalkBack) is by hand, in
// docs/device-checklist.md.
//
//   node scripts/android-smoke.mjs [--fresh] [--dev]
//
//   --fresh   clears the app's data first, so it starts at the welcome. This DELETES everything
//             the app keeps on that device: use it on a test device.
//   --dev     the debug app (…bookpoc.dev, the owner build) instead of the tester app, with the
//             simulated areas too: a store purchase, the Studio and the review queue.
//
// The device is ANDROID_SERIAL, or the first one adb lists. Media volume is the device's: mute it
// first if the narration shouldn't be heard.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { _android as android } from '@playwright/test';

const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const dev = args.includes('--dev');
const appId = `io.github.totallynotkasai.bookpoc${dev ? '.dev' : ''}`;

const sdk = [
	process.env.ANDROID_HOME,
	process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
	join(homedir(), 'Library', 'Android', 'sdk'),
	join(homedir(), 'Android', 'Sdk')
].find((dir) => dir && existsSync(join(dir, 'platform-tools')));
if (!sdk) throw new Error('No Android SDK found. Set ANDROID_HOME.');
const adbPath = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const serial = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
const adb = (...a) => execFileSync(adbPath, [...serial, ...a], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const devices = await android.devices();
const device = process.env.ANDROID_SERIAL
	? devices.find((d) => d.serial() === process.env.ANDROID_SERIAL)
	: devices[0];
if (!device) throw new Error('No Android device found.');

async function launch() {
	adb('shell', 'am', 'force-stop', appId);
	adb(
		'shell',
		'am',
		'start',
		'-W',
		'-n',
		`${appId}/io.github.totallynotkasai.bookpoc.MainActivity`
	);
	await sleep(2500);
	return (await device.webView({ pkg: appId })).page();
}

if (fresh) adb('shell', 'pm', 'clear', appId);
let page = await launch();
const results = [];
async function step(name, run) {
	try {
		const note = await run();
		results.push(['ok', name, note ?? '']);
		console.log(`ok    ${name}${note ? ` (${note})` : ''}`);
	} catch (error) {
		results.push(['FAIL', name, String(error).split('\n')[0]]);
		const shot = join(tmpdir(), `android-smoke-${results.length}.png`);
		writeFileSync(shot, await device.screenshot());
		console.log(`FAIL  ${name}: ${String(error).split('\n')[0]}\n      screen: ${shot}`);
	}
}

const reader = () => page.locator('[data-testid="reader"]');
const visible = () =>
	reader().evaluate((el) => ({
		first: Number(el.dataset.first),
		last: Number(el.dataset.last),
		word: el.dataset.firstWord ?? ''
	}));
async function settle() {
	let before = await visible();
	for (let i = 0; i < 20; i++) {
		await sleep(250);
		const now = await visible();
		if (now.first === before.first && now.last === before.last) return now;
		before = now;
	}
	return before;
}
/** Turns a page and waits until the new one has settled (a turn takes a moment to start). */
async function nextPage() {
	const from = (await visible()).first;
	await press('ArrowRight');
	for (let i = 0; i < 30 && (await visible()).first === from; i++) await sleep(100);
	return settle();
}
/** Presses keys for the reader: a focused player or sheet button would keep them otherwise. */
async function press(...keys) {
	await page.evaluate(
		() => document.activeElement instanceof HTMLElement && document.activeElement.blur()
	);
	for (const key of keys) await page.keyboard.press(key);
}
async function chrome() {
	// A page turn's last "relocated" can hide them again just after they show, so check twice.
	for (let attempt = 0; attempt < 3; attempt++) {
		if (!(await reader().evaluate((el) => el.classList.contains('chrome-hidden')))) {
			await sleep(400);
			if (!(await reader().evaluate((el) => el.classList.contains('chrome-hidden')))) return;
		}
		await press('Escape');
		await sleep(500);
	}
}
const ready = () => page.locator('[data-testid="reader"][data-ready="true"][data-first]').waitFor();

/** The app's own address for a path, as Capacitor serves it. */
const at = (path) => new URL(path, page.url()).href;

if (dev) {
	// The owner build's Reader starts with Alice's text only: the Complete edition adds its
	// Illustrations and narration (P1-STO-02), which the reading steps need.
	await step('the store: the Complete edition, bought (simulated)', async () => {
		const later = page.getByRole('button', { name: 'Look around first' });
		if (await later.isVisible().catch(() => false)) await later.click();
		await page.goto(at('/book/alices-adventures-in-wonderland'));
		await page.getByRole('button', { name: /Get the complete edition/ }).click();
		await page
			.getByRole('dialog')
			.getByRole('button', { name: /^(Pay .* \(simulated\)|Add to library)$/ })
			.click();
		await page.getByRole('dialog').getByText('is in your library').waitFor();
		await page.goto(at('/library'));
	});
}

await step('the welcome opens Alice at Chapter I', async () => {
	const start = page.getByRole('button', { name: 'Start reading' });
	if (await start.isVisible().catch(() => false)) await start.click();
	// Already past the welcome: open Alice where the welcome would, at Chapter I.
	else await page.goto(at('/read/book-alice?chapter=8761230412384829988_11-h-1.htm.xhtml'));
	await ready();
	return await page.getByTestId('chapter-title').textContent();
});

await step('a larger text size keeps the first visible Word on screen', async () => {
	const before = await settle();
	await press('Control+Equal');
	const after = await settle();
	await press('Control+0');
	await settle();
	if (!(after.first <= before.first && before.first <= after.last)) {
		throw new Error(
			`"${before.word}" (${before.first}) left the page (${after.first}–${after.last})`
		);
	}
	return `"${before.word}" kept`;
});

await step('wide margins keep it too', async () => {
	const before = await settle();
	await chrome();
	await page.getByRole('button', { name: 'Reading preferences' }).click();
	await page.getByRole('tab', { name: 'Page' }).click();
	const margins = page.getByRole('radiogroup', { name: 'Margins' });
	await margins.getByRole('radio', { name: 'Wide' }).click();
	const after = await settle();
	await margins
		.getByRole('radio', { name: 'Normal' })
		.click()
		.catch(() => {});
	await press('Escape');
	if (!(after.first <= before.first && before.first <= after.last)) throw new Error('moved');
});

await step('the pop-up picture, and the per-page panel', async () => {
	await nextPage();
	await nextPage();
	await page.getByRole('button', { name: /Show the (new )?picture/ }).click();
	await page.getByTestId('illustration-card').waitFor();
	await press('Escape');
	await chrome();
	await page.getByRole('button', { name: 'Illustrations' }).click();
	const modes = page.getByRole('radiogroup', { name: 'Show pictures' });
	await modes.getByRole('radio', { name: 'Per page' }).click();
	await press('Escape');
	await settle();
	await chrome();
	await page.getByRole('button', { name: 'Illustrations' }).click();
	await modes.getByRole('radio', { name: 'Pop-up' }).click();
	await press('Escape');
	await settle();
});

await step('narration plays natively and the highlight follows it', async () => {
	await chrome();
	await page.getByRole('button', { name: 'Listen to the narration' }).click();
	await page.waitForFunction(
		() => document.querySelector('[data-testid="reader"]')?.hasAttribute('data-narrated'),
		undefined,
		{ timeout: 20_000 }
	);
	const first = await reader().getAttribute('data-narrated');
	await sleep(4000);
	const later = await reader().getAttribute('data-narrated');
	await chrome();
	await page.getByRole('button', { name: 'Pause narration' }).first().click();
	if (later === null || Number(later) <= Number(first ?? -1))
		throw new Error('the highlight didn’t move');
	return `Word ${first} → ${later} in 4 s`;
});

await step('a highlight with a note', async () => {
	await press('Escape');
	for (let i = 0; i < 4; i++) await press('Shift+ArrowRight');
	await page
		.getByRole('toolbar', { name: 'Selection' })
		.getByRole('button', { name: 'Add note' })
		.click();
	const dialog = page.getByRole('dialog', { name: 'Add note' });
	await dialog.getByRole('textbox', { name: 'Note' }).fill('Checked on Android');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await chrome();
	await page.getByRole('button', { name: 'Contents and notes' }).click();
	await page.getByRole('tab', { name: 'Notes' }).click();
	await page.getByText('Checked on Android').first().waitFor();
	await press('Escape');
});

await step('three bookmarks', async () => {
	for (let i = 0; i < 3; i++) {
		await nextPage();
		await press('b');
		await page.waitForFunction(
			() =>
				document
					.querySelector('button[aria-label="Bookmark this page"]')
					?.getAttribute('aria-pressed') === 'true'
		);
	}
	// N opens Contents and notes on its Notes tab, without needing the controls on screen.
	await press('n');
	await page.getByRole('tab', { name: 'Bookmarks' }).click();
	const items = page.getByRole('dialog').getByRole('listitem');
	for (let wait = 0; wait < 20 && (await items.count()) < 3; wait++) await sleep(150);
	const count = await items.count();
	await press('Escape');
	await settle();
	if (count < 3) throw new Error(`${count} bookmarks listed`);
	return `${count} listed`;
});

await step('closing the app and opening it again resumes at the same Word', async () => {
	const before = await settle();
	// As a reader closes it: to the background (where the app saves its place), then gone.
	adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
	await sleep(1500);
	page = await launch();
	await page
		.getByRole('link', { name: /Alice's Adventures in Wonderland/ })
		.first()
		.click();
	await ready();
	const after = await settle();
	// The saved Word is on screen. Page breaks can differ from before: the narration player, for
	// one, takes room from the page while it's open.
	if (!(after.first <= before.first && before.first <= after.last)) {
		throw new Error(`was at ${before.first}, opened at ${after.first}–${after.last}`);
	}
	return `Word ${before.first} on the page (${after.first}–${after.last})`;
});

if (dev) {
	/** Signs in as another Persona from the dev panel; the app reloads to switch. */
	async function persona(name) {
		await page.goto(at('/dev'));
		await page.getByRole('radio', { name: new RegExp(`^${name} `) }).click();
		await sleep(3000);
		page = await (await device.webView({ pkg: appId })).page();
	}
	await step('the Studio, as the Author', async () => {
		await persona('Author');
		await page.goto(at('/studio'));
		await page.getByRole('heading', { name: 'Creator Studio' }).waitFor();
	});
	await step('the review queue, as the Moderator', async () => {
		await persona('Moderator');
		await page.goto(at('/admin'));
		await page.getByText('Reader report').first().waitFor();
	});
}

await device.close();
const failed = results.filter(([state]) => state === 'FAIL').length;
console.log(`\n${results.length - failed} of ${results.length} passed.`);
process.exit(failed ? 1 : 0);
