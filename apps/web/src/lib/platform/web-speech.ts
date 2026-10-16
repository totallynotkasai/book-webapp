import type {
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
 */
export function webSpeech(): SpeechAdapter {
	const synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;
	let queue: SpeechUtterance[] = [];
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

	function say() {
		if (!synth) return;
		const run = ++generation;
		synth.cancel();
		const item = queue[index];
		if (!item) {
			playing = false;
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
			say();
		};
		utterance.onerror = (event) => {
			if (run !== generation) return;
			// A cancel from our own pause or seek, not a failure.
			if (event.error === 'interrupted' || event.error === 'canceled') return;
			playing = false;
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
			index = 0;
			from = 0;
			error = null;
			if (start) position(start);
			playing = true;
			emit('play');
			say();
		},
		enqueue(utterances) {
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
			playing = false;
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
			playing = true;
			emit('play');
			say();
		},
		stop() {
			generation++;
			synth?.cancel();
			queue = [];
			index = 0;
			from = 0;
			current = null;
			if (playing) {
				playing = false;
				emit('pause');
			}
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
