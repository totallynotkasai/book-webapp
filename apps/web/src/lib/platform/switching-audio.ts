/**
 * Android narration (P1-LAY-04, P1-STU-03): the native player for audio it can open, the app's
 * own packaged files and (Phase 2) signed URLs, which keeps background playback and the lock
 * screen; the WebView's audio element for narration uploaded in the Studio, which exists only as
 * `blob:` URLs in this PoC that a native player can't read. That plays while the app is open.
 */
import type { AudioAdapter, AudioEvent } from './types';

export function switchingAudio(native: AudioAdapter, web: AudioAdapter): AudioAdapter {
	let current = native;
	const listeners = new Map<AudioEvent, Set<() => void>>();
	// Each adapter reports to the same listeners, but only while it's the one playing.
	for (const adapter of [native, web]) {
		for (const event of ['item', 'play', 'pause', 'ended', 'error', 'sleep'] as AudioEvent[]) {
			adapter.on(event, () => {
				if (adapter !== current) return;
				for (const callback of listeners.get(event) ?? []) callback();
			});
		}
	}

	return {
		async load(items, info, start) {
			const next = items.some((item) => item.src.startsWith('blob:')) ? web : native;
			if (next !== current) current.unload();
			current = next;
			await current.load(items, info, start);
		},
		play: () => current.play(),
		pause: () => current.pause(),
		seek: (positionMs, index) => current.seek(positionMs, index),
		setRate(rate) {
			native.setRate(rate);
			web.setRate(rate);
		},
		unload: () => current.unload(),
		setSleep: (timer) => current.setSleep(timer),
		get sleep() {
			return current.sleep;
		},
		get index() {
			return current.index;
		},
		get positionMs() {
			return current.positionMs;
		},
		get durationMs() {
			return current.durationMs;
		},
		get playing() {
			return current.playing;
		},
		get error() {
			return current.error;
		},
		on(event, callback) {
			const set = listeners.get(event) ?? new Set();
			set.add(callback);
			listeners.set(event, set);
			return () => set.delete(callback);
		}
	};
}
