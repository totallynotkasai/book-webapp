import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { FilesAdapter, Platform } from './types';
import { webAudio, webDeepLinks, webFiles, webHaptics, webShare } from './web';

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
 * check 3); saving goes through the share sheet. Audio and deep links still use the web
 * implementations until their phases (P1-LAY-04 for narration).
 */
export function capacitorPlatform(): Platform {
	return {
		kind: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
		audio: webAudio(),
		files: capacitorFiles,
		share: webShare,
		haptics: webHaptics,
		deepLinks: webDeepLinks
	};
}
