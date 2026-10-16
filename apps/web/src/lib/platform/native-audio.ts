import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { AudioAdapter, AudioEvent, SleepState, SleepTimer } from './types';

/**
 * Narration on Android (ADR-004, D-027): our own Capacitor plugin, `Narration`, in
 * `android/app/src/main/java/.../narration/`. AndroidX Media3 plays the playlist in a
 * `mediaPlayback` foreground service with a media session, so it carries on, Chapter after
 * Chapter, with the lock-screen controls, while the WebView is in the background.
 *
 * The plugin reports its state on every change and about every 250 ms while playing; between
 * reports the position is extrapolated from the playback rate, so highlighting can read it every
 * frame without a bridge call (§8.3: within 100 ms of the audio).
 *
 * The sleep timer (P1-LAY-09) runs natively, beside the player, so it stops on time with the
 * WebView asleep; the plugin reports what's left, extrapolated here like the position.
 */
interface NativeState {
	index: number;
	positionMs: number;
	durationMs: number;
	playing: boolean;
	ended: boolean;
	error: string | null;
	/** The armed sleep timer's kind, or null. */
	sleepKind?: SleepTimer['kind'] | null;
	sleepLeftMs?: number | null;
	/** How many times the sleep timer has stopped playing: each rise is one. */
	slept?: number;
}

interface NarrationPlugin {
	load(options: {
		items: { url: string; title: string }[];
		artist?: string;
		album?: string;
		artworkUrl?: string;
		index: number;
		positionMs: number;
	}): Promise<void>;
	play(): Promise<void>;
	pause(): Promise<void>;
	seek(options: { positionMs: number; index?: number }): Promise<void>;
	setRate(options: { rate: number }): Promise<void>;
	setSleep(options: { kind: SleepTimer['kind'] | null; ms?: number }): Promise<void>;
	unload(): Promise<void>;
	addListener(
		event: 'state',
		callback: (state: NativeState) => void
	): Promise<PluginListenerHandle>;
}

const Narration = registerPlugin<NarrationPlugin>('Narration');

export function nativeAudio(): AudioAdapter {
	let state: NativeState = {
		index: 0,
		positionMs: 0,
		durationMs: 0,
		playing: false,
		ended: false,
		error: null
	};
	/** When `state` arrived, on the performance clock. */
	let at = 0;
	let rate = 1;
	let subscribed: Promise<PluginListenerHandle> | null = null;
	const listeners = new Map<AudioEvent, Set<() => void>>();

	function emit(event: AudioEvent) {
		for (const callback of listeners.get(event) ?? []) callback();
	}

	function receive(next: NativeState) {
		const before = state;
		state = next;
		at = performance.now();
		if (next.index !== before.index) emit('item');
		if (next.playing !== before.playing) emit(next.playing ? 'play' : 'pause');
		if (next.ended && !before.ended) emit('ended');
		if (next.error && next.error !== before.error) emit('error');
		if ((next.slept ?? 0) > (before.slept ?? 0)) emit('sleep');
	}

	/** Shows a change at once, before the plugin confirms it. */
	function assume(change: Partial<NativeState>) {
		receive({ ...state, positionMs: position(), ...change });
	}

	function position(): number {
		if (!state.playing) return state.positionMs;
		const ms = state.positionMs + (performance.now() - at) * rate;
		return state.durationMs ? Math.min(ms, state.durationMs) : ms;
	}

	return {
		async load(items, info, start) {
			subscribed ??= Narration.addListener('state', receive);
			await subscribed;
			assume({ index: start.index, positionMs: start.positionMs, ended: false, error: null });
			await Narration.load({
				// The app's own files are packaged with it; the plugin reads them from its assets.
				items: items.map((item) => ({
					url: new URL(item.src, location.href).href,
					title: item.title
				})),
				artist: info.artist,
				album: info.album,
				artworkUrl: info.artworkUrl,
				index: start.index,
				positionMs: start.positionMs
			});
		},
		async play() {
			await Narration.play();
		},
		pause() {
			assume({ playing: false });
			void Narration.pause();
		},
		seek(positionMs, index = state.index) {
			assume({ index, positionMs: Math.max(0, positionMs), ended: false });
			void Narration.seek({ positionMs: Math.max(0, positionMs), index });
		},
		setRate(next) {
			assume({});
			rate = next;
			void Narration.setRate({ rate: next });
		},
		unload() {
			assume({ playing: false, sleepKind: null, sleepLeftMs: null });
			void Narration.unload();
		},
		setSleep(timer) {
			assume({
				sleepKind: timer?.kind ?? null,
				sleepLeftMs: timer?.kind === 'time' ? timer.ms : null
			});
			void Narration.setSleep({
				kind: timer?.kind ?? null,
				ms: timer?.kind === 'time' ? timer.ms : undefined
			});
		},
		get sleep(): SleepState | null {
			if (!state.sleepKind) return null;
			// Both kinds are reported in real time (an item's end allows for the speed already).
			const left = state.sleepLeftMs ?? null;
			const running = state.playing ? performance.now() - at : 0;
			return { kind: state.sleepKind, leftMs: left === null ? null : Math.max(0, left - running) };
		},
		get index() {
			return state.index;
		},
		get positionMs() {
			return position();
		},
		get durationMs() {
			return state.durationMs;
		},
		get playing() {
			return state.playing;
		},
		get error() {
			return state.error;
		},
		on(event, callback) {
			let set = listeners.get(event);
			if (!set) listeners.set(event, (set = new Set()));
			set.add(callback);
			return () => set.delete(callback);
		}
	};
}
