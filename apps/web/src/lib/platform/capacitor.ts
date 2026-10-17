import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { nativeAudio } from './native-audio';
import { nativeSpeech } from './native-speech';
import { switchingAudio } from './switching-audio';
import type {
	DeepLinksAdapter,
	FilesAdapter,
	LifecycleAdapter,
	Platform,
	ShareAdapter,
	SystemBarsAdapter
} from './types';
import {
	webAudio,
	webFiles,
	webHaptics,
	webLifecycle,
	webShare,
	webSpeech,
	webSystemBars
} from './web';

/**
 * Saving a file inside the WebView: a download link does nothing there, so the file is written to
 * the app's cache and offered through the Android share sheet (save to Files or Drive, or send).
 * Official Capacitor plugins, MIT.
 */
const capacitorFiles: FilesAdapter = {
	pickFiles: webFiles.pickFiles,
	async saveFile({ name, data }) {
		const text = typeof data === 'string';
		const written = await Filesystem.writeFile({
			path: name,
			directory: Directory.Cache,
			data: text ? data : await blobToBase64(data),
			...(text ? { encoding: Encoding.UTF8 } : {})
		});
		try {
			await Share.share({ title: name, files: [written.uri], dialogTitle: `Save ${name}` });
			return 'saved';
		} catch {
			return 'cancelled';
		}
	}
};

/**
 * Android's share sheet (P1-RDR-16): the WebView has no Web Share API, so through the Share
 * plugin, with a picture written to the app's cache first, as `saveFile` does.
 */
const capacitorShare: ShareAdapter = {
	supported: true,
	canShare: () => true,
	async share({ title, text, url, file }) {
		let files: string[] | undefined;
		if (file) {
			const written = await Filesystem.writeFile({
				path: file.name,
				directory: Directory.Cache,
				data: await blobToBase64(file)
			});
			files = [written.uri];
		}
		try {
			await Share.share({ title, text, url, files, dialogTitle: title });
			return 'shared';
		} catch {
			return 'cancelled';
		}
	}
};

/**
 * Links that open the app (`bookpoc://…`, D-031), through the official App plugin (MIT): the
 * link that launched it, then any that arrive while it runs.
 */
const capacitorDeepLinks: DeepLinksAdapter = {
	onOpen(callback) {
		const open = (url: string | undefined) => {
			try {
				if (url) callback(new URL(url));
			} catch {
				// Not a URL this app understands.
			}
		};
		void App.getLaunchUrl().then((launch) => open(launch?.url));
		const listener = App.addListener('appUrlOpen', (event) => open(event.url));
		return () => void listener.then((handle) => handle.remove());
	}
};

/**
 * Android's strips behind the status and navigation bars, painted by our `AppWindow` plugin
 * (`android/app/src/main/java/.../window/`; P1-MOB-01, ADR-004 check 1).
 */
const AppWindow = registerPlugin<{
	setColors(colors: { top: string; bottom: string }): Promise<void>;
}>('AppWindow');

const androidSystemBars: SystemBarsAdapter = {
	setColors(colors) {
		void AppWindow.setColors(colors).catch(() => {
			// An older app build without the plugin keeps the window's own colours.
		});
	}
};

/**
 * The app leaving the screen. Capacitor keeps its WebView running in the background, so the page
 * gets no visibilitychange or pagehide when the user goes home or switches app (seen on the
 * emulator, P1-MOB-01); the App plugin's `pause` is the activity pausing.
 */
const capacitorLifecycle: LifecycleAdapter = {
	onHide(callback) {
		const offWeb = webLifecycle.onHide(callback);
		const listener = App.addListener('pause', callback);
		return () => {
			offWeb();
			void listener.then((handle) => handle.remove());
		};
	}
};

async function blobToBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

/**
 * Capacitor (Android now, iOS from the backlog). File import uses the web file input (ADR-004
 * check 3); saving goes through the share sheet; narration plays natively (ADR-004 check 4,
 * P1-LAY-04). iOS keeps web audio until backlog item IOS-04, and the web's theme-colour bars
 * until IOS-09.
 */
/** What Escape closes: dialogs, sheets and menus, the selection toolbar and the pop-up picture. */
const CLOSABLE = [
	'[role="dialog"]',
	'[role="alertdialog"]',
	'[role="menu"]',
	'[data-testid="selection-toolbar"]',
	'[data-testid="illustration-card"]'
].join(', ');

/**
 * Android's Back (P1-MOB-01): first closes whatever is open on top, as Escape does; otherwise goes
 * back a screen; on a top-level screen (Library, Store, Studio, You), puts the app in the
 * background rather than closing it. Without this, Back left the reader with a sheet still open
 * on it, and on the Library went "back" to `/`, which opens the Library again.
 */
function handleBackButton() {
	void App.addListener('backButton', ({ canGoBack }) => {
		const topLevel = location.pathname.split('/').filter(Boolean).length <= 1;
		if (document.querySelector(CLOSABLE)) {
			const target = document.activeElement ?? document.body;
			target.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
			);
		} else if (canGoBack && !topLevel) {
			history.back();
		} else {
			void App.minimizeApp();
		}
	});
}

export function capacitorPlatform(): Platform {
	const ios = Capacitor.getPlatform() === 'ios';
	if (!ios) handleBackButton();
	return {
		kind: ios ? 'ios' : 'android',
		// Studio uploads are blob: URLs the native player can't open, so they play in the WebView.
		audio: ios ? webAudio() : switchingAudio(nativeAudio(), webAudio()),
		// The Android WebView has no Web Speech API (ADR-006); WKWebView does.
		speech: ios ? webSpeech() : nativeSpeech(),
		files: capacitorFiles,
		// WKWebView has the Web Share API (files from iOS 15); the Android WebView has none.
		share: ios ? webShare : capacitorShare,
		haptics: webHaptics,
		deepLinks: capacitorDeepLinks,
		systemBars: ios ? webSystemBars : androidSystemBars,
		lifecycle: capacitorLifecycle
	};
}
