// SPIKE (P0-04): runs the ADR-001 measurements inside the Capacitor app's WebView on the owner's
// Android phone (criteria 6 and 7). Deleted with the spike.
//
// Install a debug build first (`npm run cap:android`), then from apps/web:
//   node scripts/spike-phone.ts [label]
// It forwards the WebView's DevTools socket over adb and drives the page with Playwright over CDP.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { openFixtures, runCriteria, waitOpened } from '../e2e/spike-reader-steps.ts';

const APP_ID = 'io.github.totallynotkasai.bookpoc';
const PORT = 9333;
const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const serial = process.env.ANDROID_SERIAL;
const adbArgs = (...args: string[]) => (serial ? ['-s', serial, ...args] : args);

const pid = execFileSync(adb, adbArgs('shell', 'pidof', APP_ID), { encoding: 'utf8' }).trim();
if (!pid) throw new Error(`${APP_ID} isn't running. Run npm run cap:android first.`);
execFileSync(
	adb,
	adbArgs('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`)
);

const label = process.argv[2] ?? 'android';
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
try {
	const page = browser.contexts()[0]?.pages()[0];
	if (!page) throw new Error('No page in the WebView.');
	const origin = new URL(page.url()).origin;
	console.log(`Connected to ${page.url()} (${await page.evaluate(() => navigator.userAgent)})`);
	await page.goto(`${origin}/spike/reader`);
	await waitOpened(page, ['foliate']);
	const viewport = await page.evaluate(() => `${innerWidth}×${innerHeight}@${devicePixelRatio}`);
	console.log(`Viewport ${viewport}`);
	for (const show of ['foliate', 'readium'] as const) {
		console.log(`Running the criteria with ${show}…`);
		await runCriteria(page, { label: `${label}-${show}`, show, settle: 800 });
	}
	await openFixtures(page, { label: `${label}-foliate`, show: 'foliate' });
	await openFixtures(page, { label: `${label}-readium`, show: 'readium' });
	console.log('Done: see spike-results/.');
} finally {
	await browser.close();
	execFileSync(adb, adbArgs('forward', '--remove', `tcp:${PORT}`));
}
