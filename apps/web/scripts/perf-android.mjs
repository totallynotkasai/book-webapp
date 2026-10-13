// P1-QA-01 on a real Android WebView: the DESIGN.md §12.3 reader budgets measured inside the
// installed app over the DevTools protocol (the app's WebView is inspectable, capacitor.config.ts).
//
//   node scripts/perf-android.mjs [--fresh] [--cpu 4] [--dev]
//
//   --fresh   clears the app's data first, so the open is cold. This DELETES everything the app
//             keeps on that device (notes, bookmarks, imported books): use it on a test device.
//   --cpu N   slows the WebView's main thread N times, as the Playwright spec does on desktop.
//   --dev     measures the debug app (…bookpoc.dev) instead of the tester app.
//
// The device is ANDROID_SERIAL, or the only one connected. Measures the cold open of Alice (from
// the tap on its cover to its first page), opening a cached Chapter, page turns and re-layout.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { _android as android } from '@playwright/test';

const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const cpu = args.includes('--cpu') ? Number(args[args.indexOf('--cpu') + 1]) : 1;
const appId = `io.github.totallynotkasai.bookpoc${args.includes('--dev') ? '.dev' : ''}`;

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

adb('shell', 'am', 'force-stop', appId);
if (fresh) adb('shell', 'pm', 'clear', appId);
adb('shell', 'am', 'start', '-W', '-n', `${appId}/io.github.totallynotkasai.bookpoc.MainActivity`);
await sleep(3000);
// Playwright's Android support finds the app's WebView through adb (it needs the adb server).
const devices = await android.devices();
const device = process.env.ANDROID_SERIAL
	? devices.find((d) => d.serial() === process.env.ANDROID_SERIAL)
	: devices[0];
if (!device) throw new Error('No Android device found.');
const page = await (await device.webView({ pkg: appId })).page();
const model = device.model();
const webview =
	(await page.evaluate(() => /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1])) ?? '?';
console.log(`${model}, WebView ${webview}, CPU ${cpu}×${fresh ? ', fresh data' : ''}\n`);

if (cpu > 1) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
}

const reader = '[data-testid="reader"]';
const welcome = page.getByRole('button', { name: 'Look around first' });
if (await welcome.isVisible().catch(() => false)) await welcome.click();
await page.getByRole('heading', { name: 'Library' }).waitFor();

// Cold (with --fresh) or warm open, timed in the page from the tap to the first page's Words.
await page.evaluate(() => {
	window.__open = new Promise((done) => {
		let tapped = 0;
		addEventListener('click', () => (tapped ||= performance.now()), { capture: true });
		const observer = new MutationObserver(() => {
			const r = document.querySelector('[data-testid="reader"]');
			if (r?.dataset.ready && r.dataset.first) {
				observer.disconnect();
				requestAnimationFrame(() => done(performance.now() - tapped));
			}
		});
		observer.observe(document.body, { subtree: true, childList: true, attributes: true });
	});
});
await page
	.getByRole('link', { name: /Alice's Adventures in Wonderland/ })
	.first()
	.click();
const open = Math.round(await page.evaluate(() => window.__open));
const ingest = await page.evaluate(() =>
	Math.round(performance.getEntriesByName('pipeline:ingest').reduce((s, e) => s + e.duration, 0))
);
console.log(
	`${fresh ? 'Cold' : 'Warm'} open of Alice: ${open} ms (budget ${fresh ? 2000 : '—'})${ingest ? `, of which the EPUB's processing ${ingest} ms` : ''}`
);
await sleep(1500);

// Page turns: Event Timing, from the key to the next frame painted (16 ms or less isn't reported).
await page.evaluate(() => {
	window.__turns = [];
	new PerformanceObserver((list) => {
		for (const e of list.getEntries()) if (e.name === 'keydown') window.__turns.push(e.duration);
	}).observe({ type: 'event', durationThreshold: 16 });
});
for (let i = 0; i < 10; i++) {
	await page.keyboard.press('ArrowRight');
	await sleep(700);
}
const turns = await page.evaluate(() => window.__turns);
console.log(
	`Page turns over 16 ms: ${turns.length} of 10 (${turns.map(Math.round).join(', ') || 'none'}; budget 100 ms)`
);

// Re-layout after a text size change: to the last change of the visible range.
const relayouts = [];
for (const key of ['Control+Equal', 'Control+Minus']) {
	await page.evaluate(() => {
		const r = document.querySelector('[data-testid="reader"]');
		window.__relayout = new Promise((done) => {
			let pressed = 0;
			let changed = 0;
			addEventListener('keydown', () => (pressed = performance.now()), {
				capture: true,
				once: true
			});
			const o = new MutationObserver(() => (changed = performance.now()));
			o.observe(r, { attributeFilter: ['data-first', 'data-last', 'data-first-word'] });
			setTimeout(() => {
				o.disconnect();
				done(pressed && changed ? changed - pressed : -1);
			}, 2500);
		});
	});
	await page.keyboard.press(key);
	relayouts.push(Math.round(await page.evaluate(() => window.__relayout)));
}
console.log(`Re-layout after a text size change: ${relayouts.join(', ')} ms (budget 300 ms)`);

// A cached Chapter: from the Contents to the Chapter's first page.
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Contents and notes' }).click();
const started = Date.now();
await page.getByRole('button', { name: /The Pool of Tears/ }).click();
await page.locator(`${reader}[data-ready]`).waitFor();
await page.waitForFunction(() =>
	/Pool of Tears/i.test(document.querySelector('[data-testid="chapter-title"]')?.textContent ?? '')
);
console.log(
	`Open a cached Chapter (about 2,200 words): ${Date.now() - started} ms (budget 1000 ms, for 10,000 words)`
);

await device.close();
