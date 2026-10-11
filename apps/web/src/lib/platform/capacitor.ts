import { Capacitor } from '@capacitor/core';
import type { Platform } from './types';
import { webAudio, webDeepLinks, webFiles, webHaptics, webShare } from './web';

/**
 * Capacitor (Android now, iOS from the backlog). Stubs: every capability falls back to the web
 * implementation, which mostly works inside the WebView, until ADR-004 (P0-07) chooses native
 * plugins for background audio, file import and deep links.
 */
export function capacitorPlatform(): Platform {
	return {
		kind: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
		audio: webAudio(),
		files: webFiles,
		share: webShare,
		haptics: webHaptics,
		deepLinks: webDeepLinks
	};
}
