/**
 * Persistent storage (P1-APP-04, DESIGN.md §18): until the PoC has a backend, notes live only on
 * this device, and a browser may clear "best effort" storage when space runs low. After the first
 * highlight, bookmark or import the app asks to keep it. Chromium decides without a prompt;
 * Firefox may ask the reader.
 */

export interface StorageStatus {
	/** False where the browser has no Storage API (the app still works; data may be cleared). */
	supported: boolean;
	persisted: boolean;
	/** Bytes used and available to this app, when the browser says. */
	usage?: number;
	quota?: number;
}

export async function storageStatus(): Promise<StorageStatus> {
	const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
	if (!storage?.persisted) return { supported: false, persisted: false };
	const [persisted, estimate] = await Promise.all([
		storage.persisted().catch(() => false),
		storage.estimate?.().catch(() => undefined)
	]);
	return { supported: true, persisted, usage: estimate?.usage, quota: estimate?.quota };
}

let asked: Promise<boolean> | undefined;

/** Asks once per session; resolves with whether storage is now persistent. */
export function requestPersistentStorage(): Promise<boolean> {
	asked ??= (async () => {
		const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
		if (!storage?.persist) return false;
		if (await storage.persisted().catch(() => false)) return true;
		return storage.persist().catch(() => false);
	})();
	return asked;
}

/** "Request again" on You → Data: a fresh request, even if one was refused this session. */
export function requestPersistentStorageAgain(): Promise<boolean> {
	asked = undefined;
	return requestPersistentStorage();
}
