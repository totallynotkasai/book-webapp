import { SleepClock } from './sleep-clock';
import {
	SLEEP_FADE_MS,
	type AudioAdapter,
	type AudioEvent,
	type AudioItem,
	type AudioTrackInfo,
	type SleepState,
	type SleepTimer
} from './types';

/** What the lock screen's skip buttons move by when they don't say (§8.3: ±15 s). */
const SKIP_MS = 15_000;

/**
 * Narration in a browser: one `<audio>` element working through the playlist, with Media
 * Session metadata and actions (play, pause, ±15 s, previous and next Chapter, seek), so the
 * browser's and the OS's media controls work. Whether it keeps playing in the background is up
 * to the browser; on Android the app uses the native adapter instead (ADR-004).
 *
 * The sleep timer (P1-LAY-09) checks four times a second (once a second in a background tab),
 * turning the volume down over its last seconds.
 */
export function webAudio(): AudioAdapter {
	const element = new Audio();
	element.preload = 'auto';
	let items: AudioItem[] = [];
	let info: AudioTrackInfo = {};
	let index = 0;
	let error: string | null = null;
	/** A position asked for before the item's metadata arrived (WebKit ignores it until then). */
	let pending: number | null = null;
	const listeners = new Map<AudioEvent, Set<() => void>>();
	let sleep: { kind: 'time'; clock: SleepClock } | { kind: 'item' } | null = null;
	let sleepTimer: ReturnType<typeof setInterval> | undefined;

	function emit(event: AudioEvent) {
		for (const callback of listeners.get(event) ?? []) callback();
	}

	// ---- the sleep timer ----

	function sleepState(): SleepState | null {
		if (!sleep) return null;
		if (sleep.kind === 'time') return { kind: 'time', leftMs: sleep.clock.leftMs };
		const duration = element.duration;
		return {
			kind: 'item',
			leftMs: Number.isFinite(duration)
				? Math.max(0, ((duration - element.currentTime) * 1000) / (element.playbackRate || 1))
				: null
		};
	}

	function sleepTick() {
		const state = sleepState();
		if (!state) return;
		element.volume = state.leftMs === null ? 1 : Math.min(1, state.leftMs / SLEEP_FADE_MS);
		if (state.kind === 'time' && state.leftMs !== null && state.leftMs <= 0) {
			element.pause();
			sleepEnded();
		}
	}

	function setSleep(next: SleepTimer | null) {
		clearInterval(sleepTimer);
		sleepTimer = undefined;
		element.volume = 1;
		sleep =
			next?.kind === 'time'
				? { kind: 'time', clock: new SleepClock(next.ms, !element.paused) }
				: next?.kind === 'item'
					? { kind: 'item' }
					: null;
		if (sleep) sleepTimer = setInterval(sleepTick, 250);
	}

	/** The timer stopped playing: it's off again, at full volume for next time. */
	function sleepEnded() {
		setSleep(null);
		emit('sleep');
	}

	function open(i: number, positionMs: number) {
		index = i;
		error = null;
		pending = positionMs;
		element.src = new URL(items[i]!.src, location.href).href;
		element.load();
		describe();
	}

	element.addEventListener('loadedmetadata', () => {
		if (pending !== null) element.currentTime = pending / 1000;
		pending = null;
		positionState();
	});
	element.addEventListener('play', () => {
		if (sleep?.kind === 'time') sleep.clock.playing(true);
		emit('play');
	});
	element.addEventListener('pause', () => {
		if (sleep?.kind === 'time') sleep.clock.playing(false);
		emit('pause');
	});
	element.addEventListener('ratechange', positionState);
	element.addEventListener('seeked', () => {
		positionState();
		if (element.paused) emit('seek');
	});
	element.addEventListener('ended', () => {
		// "End of chapter": stop here, ready at the start of the next one.
		const asleep = sleep?.kind === 'item';
		if (index + 1 < items.length) {
			open(index + 1, 0);
			if (!asleep) void element.play().catch(() => {});
			emit('item');
		} else emit('ended');
		if (asleep) sleepEnded();
	});
	element.addEventListener('error', () => {
		if (!element.getAttribute('src')) return;
		error = element.error?.message || 'This narration couldn’t be played.';
		emit('error');
	});

	function seek(positionMs: number, to = index) {
		if (to !== index && items[to]) {
			const wasPlaying = !element.paused;
			open(to, positionMs);
			if (wasPlaying) void element.play().catch(() => {});
			emit('item');
			return;
		}
		const ms = Math.max(0, positionMs);
		if (element.readyState === 0) pending = ms;
		else element.currentTime = Math.min(ms / 1000, element.duration || ms / 1000);
	}

	// ---- Media Session: the browser's and the OS's media controls ----

	const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;

	function action(name: MediaSessionAction, handler: MediaSessionActionHandler | null) {
		try {
			session?.setActionHandler(name, handler);
		} catch {
			// This browser doesn't know the action.
		}
	}

	function describe() {
		if (!session) return;
		session.metadata = new MediaMetadata({
			title: items[index]?.title ?? '',
			artist: info.artist,
			album: info.album,
			artwork: info.artworkUrl ? [{ src: info.artworkUrl }] : []
		});
		action('previoustrack', index > 0 ? () => seek(0, index - 1) : null);
		action('nexttrack', index + 1 < items.length ? () => seek(0, index + 1) : null);
	}

	function positionState() {
		if (!session?.setPositionState || !Number.isFinite(element.duration)) return;
		try {
			session.setPositionState({
				duration: element.duration,
				playbackRate: element.playbackRate,
				position: Math.min(element.currentTime, element.duration)
			});
		} catch {
			// A position the browser won't take (mid-seek): the next update corrects it.
		}
	}

	function handlers(on: boolean) {
		const by = (sign: 1 | -1) => (details: MediaSessionActionDetails) =>
			seek(element.currentTime * 1000 + sign * (details.seekOffset ?? SKIP_MS / 1000) * 1000);
		action('play', on ? () => void element.play().catch(() => {}) : null);
		action('pause', on ? () => element.pause() : null);
		action('seekbackward', on ? by(-1) : null);
		action('seekforward', on ? by(1) : null);
		action(
			'seekto',
			on ? (details) => details.seekTime != null && seek(details.seekTime * 1000) : null
		);
	}

	return {
		async load(next, nextInfo, start) {
			items = next;
			info = nextInfo;
			handlers(true);
			open(Math.min(start.index, items.length - 1), start.positionMs);
		},
		async play() {
			await element.play();
		},
		pause() {
			element.pause();
		},
		seek,
		setRate(rate) {
			// A new src resets playbackRate to the default, so set both.
			element.defaultPlaybackRate = rate;
			element.playbackRate = rate;
			if ('preservesPitch' in element) element.preservesPitch = true;
		},
		unload() {
			setSleep(null);
			element.pause();
			element.removeAttribute('src');
			element.load();
			items = [];
			handlers(false);
			action('previoustrack', null);
			action('nexttrack', null);
			if (session) session.metadata = null;
		},
		setSleep,
		get sleep() {
			return sleepState();
		},
		get index() {
			return index;
		},
		get positionMs() {
			return pending ?? element.currentTime * 1000;
		},
		get durationMs() {
			return Number.isFinite(element.duration) ? element.duration * 1000 : 0;
		},
		get playing() {
			return !element.paused;
		},
		get error() {
			return error;
		},
		on(event, callback) {
			let set = listeners.get(event);
			if (!set) listeners.set(event, (set = new Set()));
			set.add(callback);
			return () => set.delete(callback);
		}
	};
}
