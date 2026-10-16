import { SleepClock } from './sleep-clock';
import type {
	SleepState,
	SleepTimer,
	SpeechAdapter,
	SpeechEvent,
	SpeechOptions,
	SpeechPosition,
	SpeechUtterance,
	SpeechVoice
} from './types';

/**
 * The device voice on the web (P1-LAY-08, ADR-006): the Web Speech API, one utterance at a time,
 * the next started when one ends. Only on-device voices (`localService`) are offered (D-036):
 * Chrome's "Google …" and Edge's "Online (Natural)" voices send the text to a server, and they
 * mostly don't report Word boundaries either.
 *
 * Pausing cancels and remembers the Word reached; resuming speaks the rest of the sentence from
 * that Word. `speechSynthesis.pause()` isn't used: it's unreliable across browsers (on Android
 * Chrome it ends the utterance rather than pausing it).
 *
 * The sleep timer (P1-LAY-09) is checked as each sentence ends: speaking stops there once the
 * time is up, or before the next Chapter's first sentence.
 */
export function webSpeech(): SpeechAdapter {
	const synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;
	let queue: SpeechUtterance[] = [];
	/** Where each Chapter (each `speak` or `enqueue`) starts in the queue. */
	let chapterStarts = new Set<number>();
	let sleep: { kind: 'time'; clock: SleepClock } | { kind: 'item' } | null = null;
	let index = 0;
	/** Where the sentence being spoken was cut from (resuming mid-sentence). */
	let from = 0;
	let current: SpeechPosition | null = null;
	let options: SpeechOptions = { lang: 'en', rate: 1 };
	let playing = false;
	let error: string | null = null;
	/** Bumped on every (re)start, so a cancelled utterance's late events are ignored. */
	let generation = 0;
	const listeners = new Map<SpeechEvent, Set<() => void>>();

	function emit(event: SpeechEvent) {
		for (const callback of listeners.get(event) ?? []) callback();
	}

	let loaded: Promise<SpeechSynthesisVoice[]> | null = null;
	/** Chromium fills the list asynchronously, after `voiceschanged`. */
	function allVoices(): Promise<SpeechSynthesisVoice[]> {
		if (!synth) return Promise.resolve([]);
		loaded ??= new Promise((resolve) => {
			const now = synth.getVoices();
			if (now.length) return resolve(now);
			const done = () => resolve(synth.getVoices());
			synth.addEventListener?.('voiceschanged', done, { once: true });
			setTimeout(done, 1500);
		});
		return loaded;
	}

	const local = (v: SpeechSynthesisVoice) => v.localService;

	async function voiceFor(o: SpeechOptions): Promise<SpeechSynthesisVoice | null> {
		const voices = (await allVoices()).filter(local);
		const primary = o.lang.split('-')[0]!.toLowerCase();
		const sameLanguage = voices.filter((v) => v.lang.toLowerCase().split(/[-_]/)[0] === primary);
		return (
			voices.find((v) => v.voiceURI === o.voiceId) ??
			sameLanguage.find((v) => v.default) ??
			sameLanguage[0] ??
			voices.find((v) => v.default) ??
			voices[0] ??
			null
		);
	}

	let voice: SpeechSynthesisVoice | null = null;

	/** Whether the sleep timer stops speech before the sentence at `i`. */
	function sleepsBefore(i: number): boolean {
		if (!sleep || i >= queue.length) return false;
		return sleep.kind === 'item' ? chapterStarts.has(i) : sleep.clock.leftMs <= 0;
	}

	/** Playing started or stopped: the sleep timer counts only playing time. */
	function setPlaying(on: boolean) {
		playing = on;
		if (sleep?.kind === 'time') sleep.clock.playing(on);
	}

	function say() {
		if (!synth) return;
		const run = ++generation;
		synth.cancel();
		const item = queue[index];
		if (!item) {
			setPlaying(false);
			sleep = null;
			emit('end');
			return;
		}
		const text = item.text.slice(from);
		const utterance = new SpeechSynthesisUtterance(text);
		if (voice) utterance.voice = voice;
		utterance.lang = voice?.lang ?? options.lang;
		utterance.rate = options.rate;
		const offset = from;
		current = { id: item.id, charIndex: offset };
		emit('progress');
		utterance.onboundary = (event) => {
			if (run !== generation || event.name !== 'word') return;
			current = { id: item.id, charIndex: offset + event.charIndex };
			emit('progress');
		};
		utterance.onend = () => {
			if (run !== generation) return;
			index++;
			from = 0;
			if (sleepsBefore(index)) {
				// The sleep timer: stop here, ready to go on from this sentence.
				setPlaying(false);
				sleep = null;
				if (queue[index]) current = { id: queue[index]!.id, charIndex: 0 };
				emit('progress');
				emit('pause');
				emit('sleep');
				return;
			}
			say();
		};
		utterance.onerror = (event) => {
			if (run !== generation) return;
			// A cancel from our own pause or seek, not a failure.
			if (event.error === 'interrupted' || event.error === 'canceled') return;
			setPlaying(false);
			error =
				event.error === 'not-allowed'
					? 'Your browser blocked the device voice. Press play again.'
					: 'The device voice stopped. Press play to try again.';
			emit('error');
			emit('pause');
		};
		synth.speak(utterance);
	}

	function position(target: SpeechPosition) {
		const i = queue.findIndex((u) => u.id === target.id);
		if (i < 0) return false;
		index = i;
		from = Math.max(0, Math.min(target.charIndex, queue[i]!.text.length));
		current = { id: target.id, charIndex: from };
		return true;
	}

	return {
		async available() {
			return !!synth && (await allVoices()).some(local);
		},
		async voices(): Promise<SpeechVoice[]> {
			return (await allVoices()).filter(local).map((v) => ({
				id: v.voiceURI,
				name: v.name,
				lang: v.lang,
				default: v.default
			}));
		},
		async speak(utterances, next, _info, start) {
			options = next;
			voice = await voiceFor(next);
			queue = utterances;
			chapterStarts = new Set([0]);
			index = 0;
			from = 0;
			error = null;
			if (start) position(start);
			setPlaying(true);
			emit('play');
			say();
		},
		enqueue(utterances) {
			chapterStarts.add(queue.length);
			queue = [...queue, ...utterances];
		},
		seek(target) {
			if (!position(target)) return;
			if (playing) say();
			else {
				generation++;
				emit('progress');
			}
		},
		pause() {
			if (!playing) return;
			setPlaying(false);
			// Paused while finishing its last sentence: the timer has done its job.
			if (sleep?.kind === 'time' && sleep.clock.leftMs <= 0) sleep = null;
			generation++;
			synth?.cancel();
			if (current) position(current);
			emit('pause');
		},
		async resume() {
			if (playing || !queue.length) return;
			if (index >= queue.length) {
				index = 0;
				from = 0;
			}
			error = null;
			setPlaying(true);
			emit('play');
			say();
		},
		stop() {
			generation++;
			synth?.cancel();
			queue = [];
			chapterStarts = new Set();
			sleep = null;
			index = 0;
			from = 0;
			current = null;
			if (playing) {
				setPlaying(false);
				emit('pause');
			}
		},
		setSleep(timer: SleepTimer | null) {
			sleep =
				timer?.kind === 'time'
					? { kind: 'time', clock: new SleepClock(timer.ms, playing) }
					: timer?.kind === 'item'
						? { kind: 'item' }
						: null;
		},
		get sleep(): SleepState | null {
			if (!sleep) return null;
			return sleep.kind === 'time'
				? { kind: 'time', leftMs: sleep.clock.leftMs }
				: { kind: 'item', leftMs: null };
		},
		setRate(rate) {
			options = { ...options, rate };
			if (playing && current && position(current)) say();
		},
		setVoice(voiceId) {
			options = { ...options, voiceId };
			void voiceFor(options).then((v) => {
				voice = v;
				if (playing && current && position(current)) say();
			});
		},
		get playing() {
			return playing;
		},
		get current() {
			return current;
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
