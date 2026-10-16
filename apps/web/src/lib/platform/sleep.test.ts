import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEvent, SpeechEvent } from './types';
import { webAudio } from './web-audio';
import { webSpeech } from './web-speech';

// The sleep timer in the web adapters (P1-LAY-09): it counts only playing time, a recording fades
// out over its last 6 s, "End of chapter" stops ready at the next one, and the device voice
// finishes its sentence. The Android plugins do the same natively (SleepTimer.kt).

beforeEach(() => {
	vi.useFakeTimers({
		toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance']
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

/** Enough of an `<audio>` element for `webAudio`: metadata at once, 10 minutes long. */
class FakeAudio extends EventTarget {
	static last: FakeAudio;
	preload = '';
	paused = true;
	currentTime = 0;
	duration = Number.NaN;
	volume = 1;
	playbackRate = 1;
	defaultPlaybackRate = 1;
	preservesPitch = true;
	readyState = 0;
	error = null;
	#src = '';
	constructor() {
		super();
		FakeAudio.last = this;
	}
	set src(value: string) {
		this.#src = value;
	}
	get src() {
		return this.#src;
	}
	getAttribute(name: string) {
		return name === 'src' ? this.#src || null : null;
	}
	removeAttribute() {
		this.#src = '';
	}
	load() {
		if (!this.#src) return;
		this.duration = 600;
		this.readyState = 1;
		this.dispatchEvent(new Event('loadedmetadata'));
	}
	async play() {
		this.paused = false;
		this.dispatchEvent(new Event('play'));
	}
	pause() {
		if (this.paused) return;
		this.paused = true;
		this.dispatchEvent(new Event('pause'));
	}
	/** The item plays to its end. */
	end() {
		this.currentTime = this.duration;
		this.paused = true;
		this.dispatchEvent(new Event('pause'));
		this.dispatchEvent(new Event('ended'));
	}
}

async function narration() {
	vi.stubGlobal('Audio', FakeAudio);
	const audio = webAudio();
	const events: AudioEvent[] = [];
	for (const e of ['play', 'pause', 'item', 'ended', 'sleep'] as AudioEvent[]) {
		audio.on(e, () => events.push(e));
	}
	await audio.load(
		[
			{ src: '/one.m4a', title: 'Chapter I' },
			{ src: '/two.m4a', title: 'Chapter II' }
		],
		{},
		{ index: 0, positionMs: 0 }
	);
	return { audio, element: FakeAudio.last, events };
}

describe('narration in a browser', () => {
	it('counts only playing time, fades out over its last 6 s, then pauses', async () => {
		const { audio, element, events } = await narration();
		await audio.play();
		audio.setSleep({ kind: 'time', ms: 10_000 });
		vi.advanceTimersByTime(3000);
		expect(audio.sleep).toEqual({ kind: 'time', leftMs: 7000 });
		expect(element.volume).toBe(1);
		vi.advanceTimersByTime(4000);
		expect(element.volume).toBeCloseTo(0.5, 1);

		// Paused, nothing counts.
		audio.pause();
		vi.advanceTimersByTime(60_000);
		expect(audio.sleep?.leftMs).toBe(3000);

		await audio.play();
		vi.advanceTimersByTime(3250);
		expect(element.paused).toBe(true);
		expect(audio.sleep).toBeNull();
		expect(element.volume).toBe(1);
		expect(events.at(-1)).toBe('sleep');
	});

	it('at "End of chapter" fades the end and stops ready at the next Chapter', async () => {
		const { audio, element, events } = await narration();
		await audio.play();
		audio.setSleep({ kind: 'item' });
		element.currentTime = 597;
		vi.advanceTimersByTime(250);
		expect(audio.sleep).toEqual({ kind: 'item', leftMs: 3000 });
		expect(element.volume).toBeCloseTo(0.5, 2);
		element.end();
		expect(audio.index).toBe(1);
		expect(element.paused).toBe(true);
		expect(audio.sleep).toBeNull();
		expect(element.volume).toBe(1);
		expect(events.slice(-2)).toEqual(['item', 'sleep']);
		expect(events).not.toContain('ended');
	});

	it('goes on to the next Chapter when no timer is set', async () => {
		const { audio, element, events } = await narration();
		await audio.play();
		element.end();
		expect(audio.index).toBe(1);
		expect(element.paused).toBe(false);
		expect(events).not.toContain('sleep');
	});

	it('turning the timer off, or closing the player, puts the volume back', async () => {
		const { audio, element } = await narration();
		await audio.play();
		audio.setSleep({ kind: 'time', ms: 3000 });
		vi.advanceTimersByTime(250);
		expect(element.volume).toBeLessThan(1);
		audio.setSleep(null);
		expect(element.volume).toBe(1);
		expect(audio.sleep).toBeNull();
		audio.setSleep({ kind: 'time', ms: 3000 });
		vi.advanceTimersByTime(250);
		audio.unload();
		expect(element.volume).toBe(1);
		expect(audio.sleep).toBeNull();
	});
});

// ---- the device voice ----

class FakeUtterance {
	voice: unknown = null;
	lang = '';
	rate = 1;
	onboundary: ((e: { name: string; charIndex: number }) => void) | null = null;
	onend: (() => void) | null = null;
	onerror: ((e: { error: string }) => void) | null = null;
	constructor(public text: string) {}
}

function fakeSynth() {
	const synth = {
		said: [] as string[],
		current: null as FakeUtterance | null,
		getVoices: () => [
			{ voiceURI: 'v', name: 'Voice', lang: 'en-GB', localService: true, default: true }
		],
		addEventListener() {},
		speak(u: FakeUtterance) {
			synth.said.push(u.text);
			synth.current = u;
		},
		cancel() {
			const u = synth.current;
			synth.current = null;
			u?.onerror?.({ error: 'interrupted' });
		},
		/** The sentence being said comes to its end. */
		finish() {
			const u = synth.current;
			synth.current = null;
			u?.onend?.();
		}
	};
	vi.stubGlobal('speechSynthesis', synth);
	vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
	return synth;
}

async function voice() {
	const synth = fakeSynth();
	const speech = webSpeech();
	const events: SpeechEvent[] = [];
	for (const e of ['play', 'pause', 'end', 'sleep'] as SpeechEvent[]) {
		speech.on(e, () => events.push(e));
	}
	await speech.speak(
		[
			{ id: 1, text: 'One.' },
			{ id: 2, text: 'Two.' }
		],
		{ lang: 'en', rate: 1 },
		{ title: 'Chapter IV' }
	);
	speech.enqueue(
		[
			{ id: 3, text: 'Chapter V.' },
			{ id: 4, text: 'Three.' }
		],
		'Chapter V'
	);
	return { synth, speech, events };
}

describe('the device voice in a browser', () => {
	it('at "End of chapter" stops before the next Chapter’s first sentence', async () => {
		const { synth, speech, events } = await voice();
		speech.setSleep({ kind: 'item' });
		expect(speech.sleep).toEqual({ kind: 'item', leftMs: null });
		synth.finish();
		synth.finish();
		expect(synth.said).toEqual(['One.', 'Two.']);
		expect(speech.playing).toBe(false);
		expect(speech.current).toEqual({ id: 3, charIndex: 0 });
		expect(speech.sleep).toBeNull();
		expect(events.slice(-2)).toEqual(['pause', 'sleep']);
		// Play goes on with the next Chapter.
		await speech.resume();
		expect(synth.said.at(-1)).toBe('Chapter V.');
	});

	it('when the time is up, finishes the sentence it is saying, then stops', async () => {
		const { synth, speech, events } = await voice();
		speech.setSleep({ kind: 'time', ms: 1000 });
		vi.advanceTimersByTime(5000);
		expect(speech.sleep).toEqual({ kind: 'time', leftMs: 0 });
		// Still saying "One." to its end.
		expect(speech.playing).toBe(true);
		synth.finish();
		expect(synth.said).toEqual(['One.']);
		expect(speech.playing).toBe(false);
		expect(speech.current).toEqual({ id: 2, charIndex: 0 });
		expect(events.at(-1)).toBe('sleep');
	});

	it('counts only speaking time, and a pause in its last sentence ends it', async () => {
		const { synth, speech } = await voice();
		speech.setSleep({ kind: 'time', ms: 1000 });
		speech.pause();
		vi.advanceTimersByTime(60_000);
		expect(speech.sleep?.leftMs).toBe(1000);
		await speech.resume();
		vi.advanceTimersByTime(2000);
		speech.pause();
		expect(speech.sleep).toBeNull();
		await speech.resume();
		synth.finish();
		expect(speech.playing).toBe(true);
	});
});
