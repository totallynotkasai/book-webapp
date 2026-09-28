import type { Stores } from '@book/core';
import { createLocalStores } from '@book/storage-local';

let stores: Promise<Stores> | undefined;

/**
 * The single place the app chooses its storage implementation.
 * Swap `createLocalStores` for a backend-backed version when hosting is decided.
 */
export function getStores(): Promise<Stores> {
	stores ??= createLocalStores();
	return stores;
}
