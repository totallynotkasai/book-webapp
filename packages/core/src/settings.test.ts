import { describe, expect, it } from 'vitest';
import { defaultReaderSettings, resolveSettings } from './settings';

describe('resolveSettings', () => {
	it('falls back to defaults when nothing is stored', () => {
		expect(resolveSettings(undefined)).toEqual(defaultReaderSettings);
		expect(resolveSettings(null)).toEqual(defaultReaderSettings);
	});

	it('keeps stored values and fills in the rest', () => {
		const resolved = resolveSettings({ theme: 'dark', fontScale: 1.2 });
		expect(resolved.theme).toBe('dark');
		expect(resolved.fontScale).toBe(1.2);
		expect(resolved.font).toBe(defaultReaderSettings.font);
	});
});
