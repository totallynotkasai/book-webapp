// SPIKE (P0-07): probes the Capacitor app's WebView on the owner's phone over adb + CDP and prints
// what the platform offers: storage persistence and quota, safe-area insets, Media Session,
// file input, selection APIs and the WebView version. Deleted with the spike.
// Usage, from apps/web with the app running: node scripts/probe-phone.ts
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const APP_ID = 'io.github.totallynotkasai.bookpoc';
const PORT = 9334;
const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const pid = execFileSync(adb, ['shell', 'pidof', APP_ID], { encoding: 'utf8' }).trim();
if (!pid) throw new Error(`${APP_ID} isn't running.`);
execFileSync(adb, ['forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
try {
	const page = browser.contexts()[0]!.pages()[0]!;
	const result = await page.evaluate(async () => {
		const probe = document.createElement('div');
		probe.style.cssText =
			'position:fixed;top:env(safe-area-inset-top,0px);left:env(safe-area-inset-left,0px);' +
			'right:env(safe-area-inset-right,0px);bottom:env(safe-area-inset-bottom,0px);';
		document.body.append(probe);
		const r = probe.getBoundingClientRect();
		probe.remove();
		const root = getComputedStyle(document.documentElement);
		const capacitor = (
			globalThis as unknown as {
				Capacitor?: { getPlatform(): string; PluginHeaders?: { name: string }[] };
			}
		).Capacitor;
		return {
			userAgent: navigator.userAgent,
			url: location.href,
			viewport: `${innerWidth}×${innerHeight}@${devicePixelRatio}`,
			storage: {
				persisted: await navigator.storage?.persisted?.(),
				persistRequest: await navigator.storage?.persist?.(),
				estimate: await navigator.storage?.estimate?.()
			},
			safeAreaEnv: {
				top: r.top,
				left: r.left,
				right: innerWidth - r.right,
				bottom: innerHeight - r.bottom
			},
			capacitorSafeAreaVars: ['top', 'right', 'bottom', 'left'].map((s) =>
				root.getPropertyValue(`--safe-area-inset-${s}`)
			),
			mediaSession: 'mediaSession' in navigator,
			customHighlights: 'highlights' in CSS,
			decompressionStream: typeof DecompressionStream === 'function',
			fileInput: (() => {
				const i = document.createElement('input');
				i.type = 'file';
				return i.type === 'file';
			})(),
			showOpenFilePicker: 'showOpenFilePicker' in globalThis,
			share: typeof navigator.share === 'function',
			vibrate: typeof navigator.vibrate === 'function',
			capacitorPlatform: capacitor?.getPlatform(),
			capacitorPlugins: capacitor?.PluginHeaders?.map((p) => p.name)
		};
	});
	console.log(JSON.stringify(result, null, 2));
} finally {
	await browser.close();
	execFileSync(adb, ['forward', '--remove', `tcp:${PORT}`]);
}
