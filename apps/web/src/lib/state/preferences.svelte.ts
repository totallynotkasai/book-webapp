import {
	mergePreferencesPatch,
	resolvePreferences,
	type ReaderPreferences,
	type ReaderPreferencesPatch
} from '@book/core';
import { getStores } from '$lib/services';

/**
 * Reactive Reader Preferences (docs/DESIGN.md §9.4), persisted through `Stores`: global ones, and
 * per-Book overrides for the Book open in the reader ("This book only", P1-RDR-04). Writes are
 * local-first: the UI changes at once and the save never blocks it (plan §8).
 */
class PreferencesState {
	#stored = $state<ReaderPreferencesPatch>({});
	#bookId = $state<string | null>(null);
	#bookPatch = $state<ReaderPreferencesPatch | undefined>(undefined);
	/** The global preferences (the app's theme, and every Book without overrides). */
	current = $derived<ReaderPreferences>(resolvePreferences(this.#stored));
	/** The open Book's effective preferences: global, then its overrides. */
	forBook = $derived<ReaderPreferences>(resolvePreferences(this.#stored, this.#bookPatch));
	/** True when the open Book has overrides of its own. */
	bookHasOverrides = $derived(
		this.#bookPatch !== undefined && Object.keys(this.#bookPatch).length > 0
	);
	loaded = $state(false);
	#loading: Promise<void> | undefined;

	load(): Promise<void> {
		this.#loading ??= (async () => {
			const stores = await getStores();
			this.#stored = (await stores.preferences.get()) ?? {};
			this.loaded = true;
		})();
		return this.#loading;
	}

	/** Loads the overrides of the Book being opened. */
	async openBook(bookId: string) {
		await this.load();
		const stores = await getStores();
		this.#bookId = bookId;
		this.#bookPatch = await stores.preferences.get(bookId);
	}

	closeBook() {
		this.#bookId = null;
		this.#bookPatch = undefined;
	}

	/**
	 * Applies immediately; the write never blocks the UI (local-first, plan §8). A change made
	 * before the stored preferences have loaded waits for them, so the load can't undo it and the
	 * save can't drop what was stored.
	 */
	async update(changes: ReaderPreferencesPatch) {
		if (!this.loaded) await this.load();
		this.#stored = mergePreferencesPatch($state.snapshot(this.#stored), changes);
		const stores = await getStores();
		await stores.preferences.save($state.snapshot(this.#stored));
	}

	/** Changes the open Book only (a per-Book override). */
	async updateBook(changes: ReaderPreferencesPatch) {
		const bookId = this.#bookId;
		if (!bookId) return;
		this.#bookPatch = mergePreferencesPatch($state.snapshot(this.#bookPatch), changes);
		const stores = await getStores();
		await stores.preferences.save($state.snapshot(this.#bookPatch)!, bookId);
	}

	/** "Reset to my defaults" for the open Book. */
	async resetBook() {
		const bookId = this.#bookId;
		if (!bookId) return;
		this.#bookPatch = undefined;
		const stores = await getStores();
		await stores.preferences.clear(bookId);
	}
}

export const preferences = new PreferencesState();
