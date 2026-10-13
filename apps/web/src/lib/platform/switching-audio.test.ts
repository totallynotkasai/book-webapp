import { describe, expect, it, vi } from 'vitest';
import { switchingAudio } from './switching-audio';
import type { AudioAdapter, AudioEvent } from './types';

function fake(name: string) {
	const listeners = new Map<AudioEvent, () => void>();
	const adapter = {
		name,
		load: vi.fn(async () => {}),
		play: vi.fn(async () => {}),
		pause: vi.fn(),
		seek: vi.fn(),
		setRate: vi.fn(),
		unload: vi.fn(),
		index: 0,
		positionMs: name === 'native' ? 100 : 200,
		durationMs: 0,
		playing: false,
		error: null,
		on: (event: AudioEvent, callback: () => void) => {
			listeners.set(event, callback);
			return () => listeners.delete(event);
		},
		emit: (event: AudioEvent) => listeners.get(event)?.()
	};
	return adapter as typeof adapter & AudioAdapter;
}

const info = { title: 'Book', artist: 'Author' } as never;
const start = { index: 0, positionMs: 0 };

describe('Android narration: native or WebView audio (P1-STU-03)', () => {
	it('plays packaged audio natively and Studio uploads (blob: URLs) in the WebView', async () => {
		const native = fake('native');
		const web = fake('web');
		const audio = switchingAudio(native, web);
		const played = vi.fn();
		audio.on('play', played);

		await audio.load([{ src: '/demo/audio/ch1.m4a', title: '1' }], info, start);
		expect(native.load).toHaveBeenCalled();
		expect(audio.positionMs).toBe(100);
		native.emit('play');
		web.emit('play');
		expect(played).toHaveBeenCalledTimes(1);

		await audio.load([{ src: 'blob:http://localhost/abc', title: '1' }], info, start);
		expect(native.unload).toHaveBeenCalled();
		expect(web.load).toHaveBeenCalled();
		expect(audio.positionMs).toBe(200);
		web.emit('play');
		expect(played).toHaveBeenCalledTimes(2);
	});
});
