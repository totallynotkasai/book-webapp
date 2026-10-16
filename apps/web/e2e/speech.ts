import type { Page } from '@playwright/test';

// The device voice (P1-LAY-08) in E2E: every spec starts with no Web Speech API (fixtures.ts),
// since headless Chromium has the system's voices on Windows and none on CI's Linux, and
// Playwright's WebKit on Windows has no API at all (ADR-006). Specs that read aloud install this
// stand-in for `speechSynthesis`. It "says" each utterance a Word at a time on a timer,
// with the Web Speech API's events, and records what it was asked to say.

export interface SpokenUtterance {
	text: string;
	voice: string | null;
	rate: number;
	lang: string;
}

interface SpeechStandIn {
	spoken: SpokenUtterance[];
	/** Milliseconds per Word at rate 1. */
	wordMs: number;
	/** False for a voice that reports no Word boundaries, only start and end. */
	boundaries: boolean;
}

declare global {
	var __speech: SpeechStandIn;
}

/** Installs the stand-in before the app loads. `wordMs` sets its pace. */
export async function fakeSpeech(page: Page, options: { wordMs?: number } = {}) {
	await page.addInitScript((wordMs) => {
		const state: SpeechStandIn = { spoken: [], wordMs, boundaries: true };
		globalThis.__speech = state;
		const voices = [
			{
				voiceURI: 'test-george',
				name: 'Test George',
				lang: 'en-GB',
				localService: true,
				default: true
			},
			{
				voiceURI: 'test-hazel',
				name: 'Test Hazel',
				lang: 'en-GB',
				localService: true,
				default: false
			},
			// An online voice (D-036: never offered, since it would send the text to a server).
			{
				voiceURI: 'online-natural',
				name: 'Online Natural',
				lang: 'en-US',
				localService: false,
				default: false
			},
			{
				voiceURI: 'test-amelie',
				name: 'Test Amélie',
				lang: 'fr-FR',
				localService: true,
				default: false
			}
		];

		class Utterance extends EventTarget {
			text: string;
			voice: { name: string } | null = null;
			lang = '';
			rate = 1;
			pitch = 1;
			volume = 1;
			constructor(text: string) {
				super();
				this.text = text;
			}
		}

		const queue: Utterance[] = [];
		let current: Utterance | null = null;
		let timers: ReturnType<typeof setTimeout>[] = [];

		function fire(u: Utterance, type: string, init: Record<string, unknown> = {}) {
			const event = Object.assign(new Event(type), init, { utterance: u });
			const handler = (u as unknown as Record<string, ((e: Event) => void) | undefined>)[
				`on${type}`
			];
			handler?.(event);
			u.dispatchEvent(event);
		}

		function next() {
			const u = queue.shift();
			synth.speaking = !!u;
			if (!u) return;
			current = u;
			state.spoken.push({ text: u.text, voice: u.voice?.name ?? null, rate: u.rate, lang: u.lang });
			const starts = [...u.text.matchAll(/\S+/g)].map((m) => m.index!);
			const step = state.wordMs / (u.rate || 1);
			timers.push(
				setTimeout(() => {
					if (current !== u) return;
					fire(u, 'start');
					starts.forEach((charIndex, i) =>
						timers.push(
							setTimeout(() => {
								if (current === u && state.boundaries) {
									fire(u, 'boundary', { name: 'word', charIndex, charLength: 0 });
								}
							}, i * step)
						)
					);
					timers.push(
						setTimeout(
							() => {
								if (current !== u) return;
								current = null;
								fire(u, 'end');
								next();
							},
							starts.length * step + 5
						)
					);
				}, 5)
			);
		}

		const synth = Object.assign(new EventTarget(), {
			speaking: false,
			paused: false,
			pending: false,
			getVoices: () => voices,
			speak(u: Utterance) {
				queue.push(u);
				if (!current) next();
			},
			cancel() {
				const was = current;
				queue.length = 0;
				for (const t of timers) clearTimeout(t);
				timers = [];
				current = null;
				synth.speaking = false;
				if (was) fire(was, 'error', { error: 'interrupted' });
			},
			pause() {},
			resume() {}
		});

		Object.defineProperty(globalThis, 'speechSynthesis', { value: synth, configurable: true });
		Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
			value: Utterance,
			configurable: true
		});
	}, options.wordMs ?? 120);
}

export function spoken(page: Page): Promise<SpokenUtterance[]> {
	return page.evaluate(() => globalThis.__speech.spoken);
}
