import {
	mergePreferencesPatch,
	resolvePreferences,
	type ReaderPreferences,
	type ReaderPreferencesPatch
} from '@book/core';
import { getStores } from './services';

/**
 * Reactive global Reader Preferences (docs/DESIGN.md §9.4), persisted through `Stores`.
 * Per-Book overrides arrive with the preferences UI (P1-RDR-04).
 */
class PreferencesState {
	#stored = $state<ReaderPreferencesPatch>({});
	current = $derived<ReaderPreferences>(resolvePreferences(this.#stored));
	loaded = $state(false);

	async load() {
		const stores = await getStores();
		this.#stored = (await stores.preferences.get()) ?? {};
		this.loaded = true;
	}

	/** Applies immediately; the write never blocks the UI (local-first, plan §8). */
	async update(changes: ReaderPreferencesPatch) {
		this.#stored = mergePreferencesPatch($state.snapshot(this.#stored), changes);
		const stores = await getStores();
		await stores.preferences.save($state.snapshot(this.#stored));
	}
}

export const preferences = new PreferencesState();
