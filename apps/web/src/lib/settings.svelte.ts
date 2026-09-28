import { resolveSettings, type ReaderSettings } from '@book/core';
import { getStores } from './services';

/** Reactive global reader settings, persisted through the settings store. */
class SettingsState {
	current = $state<ReaderSettings>(resolveSettings());
	loaded = $state(false);

	async load() {
		const stores = await getStores();
		this.current = resolveSettings(await stores.settings.get());
		this.loaded = true;
	}

	async update(changes: Partial<ReaderSettings>) {
		this.current = { ...this.current, ...changes };
		const stores = await getStores();
		await stores.settings.save($state.snapshot(this.current));
	}
}

export const settings = new SettingsState();
