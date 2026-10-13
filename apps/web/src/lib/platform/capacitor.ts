import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { nativeAudio } from './native-audio';
import { switchingAudio } from './switching-audio';
import type { DeepLinksAdapter, FilesAdapter, Platform, SystemBarsAdapter } from './types';
import { webAudio, webFiles, webHaptics, webShare, webSystemBars } from './web';

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
export function capacitorPlatform(): Platform {
	const ios = Capacitor.getPlatform() === 'ios';
	return {
		kind: ios ? 'ios' : 'android',
		// Studio uploads are blob: URLs the native player can't open, so they play in the WebView.
		audio: ios ? webAudio() : switchingAudio(nativeAudio(), webAudio()),
		files: capacitorFiles,
		share: webShare,
		haptics: webHaptics,
		deepLinks: capacitorDeepLinks,
		systemBars: ios ? webSystemBars : androidSystemBars
	};
}
