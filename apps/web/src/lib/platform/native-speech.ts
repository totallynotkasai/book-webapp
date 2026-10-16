import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { SpeechAdapter, SpeechEvent, SpeechPosition, SpeechVoice } from './types';

/**
 * The device voice on Android (P1-LAY-08, ADR-006): our own Capacitor plugin, `Speech`, in
 * `android/app/src/main/java/.../speech/`, since the Android WebView has no Web Speech API. It
 * queues the sentences with Android's `TextToSpeech` and runs in a `mediaPlayback` foreground
 * service with a media session (as narration does, ADR-004), so it keeps speaking, Chapter after
 * Chapter, with the screen locked, and the lock screen can pause it or skip a sentence.
 *
 * The plugin reports its state on every change: each sentence it starts and each Word in it
 * (`onRangeStart`, Android 8 and later; older versions highlight by sentence).
 */
interface NativeState {
	id: number | null;
	charIndex: number;
	playing: boolean;
	ended: boolean;
	error: string | null;
}

interface SpeechPlugin {
	available(): Promise<{ available: boolean }>;
	voices(): Promise<{ voices: SpeechVoice[] }>;
	speak(options: {
		utterances: { id: number; text: string }[];
		voice?: string;
		lang: string;
		rate: number;
		title: string;
		artist?: string;
		album?: string;
		startId?: number;
		startChar?: number;
	}): Promise<void>;
	enqueue(options: { utterances: { id: number; text: string }[]; title: string }): Promise<void>;
	seek(options: { id: number; charIndex: number }): Promise<void>;
	pause(): Promise<void>;
	resume(): Promise<void>;
	stop(): Promise<void>;
	setRate(options: { rate: number }): Promise<void>;
	setVoice(options: { voice: string }): Promise<void>;
	getState(): Promise<NativeState>;
	addListener(
		event: 'state',
		callback: (state: NativeState) => void
	): Promise<PluginListenerHandle>;
}

const Speech = registerPlugin<SpeechPlugin>('Speech');

export function nativeSpeech(): SpeechAdapter {
	let state: NativeState = { id: null, charIndex: 0, playing: false, ended: false, error: null };
	let subscribed: Promise<PluginListenerHandle> | null = null;
	const listeners = new Map<SpeechEvent, Set<() => void>>();

	function emit(event: SpeechEvent) {
		for (const callback of listeners.get(event) ?? []) callback();
	}

	function receive(next: NativeState) {
		const before = state;
		state = next;
		if (next.id !== before.id || next.charIndex !== before.charIndex) emit('progress');
		if (next.playing !== before.playing) emit(next.playing ? 'play' : 'pause');
		if (next.ended && !before.ended) emit('end');
		if (next.error && next.error !== before.error) emit('error');
	}

	function subscribe() {
		if (!subscribed) {
			subscribed = Speech.addListener('state', receive);
			// After the WebView slept (screen locked), catch up with where speech has got to.
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'visible') void Speech.getState().then(receive);
			});
		}
		return subscribed;
	}

	return {
		async available() {
			try {
				return (await Speech.available()).available;
			} catch {
				// An older app build without the plugin.
				return false;
			}
		},
		async voices() {
			try {
				return (await Speech.voices()).voices;
			} catch {
				return [];
			}
		},
		async speak(utterances, options, info, start) {
			await subscribe();
			receive({ ...state, ended: false, error: null });
			await Speech.speak({
				utterances,
				voice: options.voiceId,
				lang: options.lang,
				rate: options.rate,
				title: info.title,
				artist: info.artist,
				album: info.album,
				startId: start?.id,
				startChar: start?.charIndex
			});
		},
		enqueue(utterances, title) {
			void Speech.enqueue({ utterances, title });
		},
		seek(position: SpeechPosition) {
			receive({ ...state, id: position.id, charIndex: position.charIndex, ended: false });
			void Speech.seek(position);
		},
		pause() {
			receive({ ...state, playing: false });
			void Speech.pause();
		},
		async resume() {
			await Speech.resume();
		},
		stop() {
			receive({ ...state, id: null, charIndex: 0, playing: false });
			void Speech.stop();
		},
		setRate(rate) {
			void Speech.setRate({ rate });
		},
		setVoice(voice) {
			void Speech.setVoice({ voice });
		},
		get playing() {
			return state.playing;
		},
		get current() {
			return state.id === null ? null : { id: state.id, charIndex: state.charIndex };
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
