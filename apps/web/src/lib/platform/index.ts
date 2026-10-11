import { Capacitor } from '@capacitor/core';
import { capacitorPlatform } from './capacitor';
import type { Platform } from './types';
import { webPlatform } from './web';

export type * from './types';

let platform: Platform | undefined;

/** The device adapters for wherever the app is running (DESIGN.md §9.7). */
export function getPlatform(): Platform {
	platform ??= Capacitor.isNativePlatform() ? capacitorPlatform() : webPlatform();
	return platform;
}
