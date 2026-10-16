/**
 * The sleep timer's countdown for the web adapters (P1-LAY-09): playing time only, on the
 * performance clock, so it's right however seldom a background tab's timers run.
 */
export class SleepClock {
	#leftMs: number;
	#at = performance.now();
	#counting: boolean;

	constructor(ms: number, playing: boolean) {
		this.#leftMs = ms;
		this.#counting = playing;
	}

	/** Call whenever playing starts or stops. */
	playing(on: boolean) {
		const now = performance.now();
		if (this.#counting) this.#leftMs -= now - this.#at;
		this.#at = now;
		this.#counting = on;
	}

	get leftMs(): number {
		const running = this.#counting ? performance.now() - this.#at : 0;
		return Math.max(0, this.#leftMs - running);
	}
}
