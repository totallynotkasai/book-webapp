import { describe, expect, it } from 'vitest';
import type { WordTiming } from './align';
import { findPauses, shiftStarts, startBias, timingAccuracy } from './pauses';

const RATE = 16_000;

/** Synthetic "speech": a 200 Hz tone where `speech` says so, near-silence elsewhere. */
function signal(spans: [number, number][], totalMs: number): Float32Array {
	const out = new Float32Array((RATE * totalMs) / 1000);
	for (let i = 0; i < out.length; i++) out[i] = 0.0005 * Math.sin(i * 1.7); // noise floor
	for (const [from, to] of spans) {
		for (let i = (RATE * from) / 1000; i < (RATE * to) / 1000; i++)
			out[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / RATE);
	}
	return out;
}

const word = (startMs: number, endMs: number, matched = true): WordTiming => ({
	wordId: startMs,
	startMs,
	endMs,
	matched,
	interpolated: !matched
});

describe('findPauses', () => {
	it('finds silences between stretches of speech', () => {
		const pcm = signal(
			[
				[500, 1500],
				[2000, 3000],
				[3100, 4000]
			],
			4500
		);
		// 1500–2000 is a pause; 3000–3100 is too short to count.
		expect(findPauses(pcm, RATE)).toEqual([{ fromMs: 1500, toMs: 2000 }]);
		expect(findPauses(pcm, RATE, { minPauseMs: 50 })).toHaveLength(2);
	});

	it('returns nothing for empty audio', () => {
		expect(findPauses(new Float32Array(0), RATE)).toEqual([]);
	});
});

describe('timingAccuracy', () => {
	const pauses = [
		{ fromMs: 1500, toMs: 2000 },
		{ fromMs: 4000, toMs: 4600 }
	];

	it('measures starts against onsets and ends against pause starts', () => {
		const timings = [word(1200, 1450), word(2120, 2400), word(3700, 4050), word(4720, 5000)];
		const accuracy = timingAccuracy(timings, pauses);
		expect(accuracy.start).toMatchObject({ n: 2, medianSignedMs: 120, medianAbsMs: 120 });
		expect(accuracy.end.n).toBe(2);
		expect(startBias(timings, pauses)).toBe(120);
	});

	it('ignores interpolated Words and onsets with no Word nearby', () => {
		const timings = [word(2000, 2300, false), word(9000, 9300)];
		expect(timingAccuracy(timings, pauses).start.n).toBe(0);
	});

	it('removes a bias by shifting starts, keeping them ordered and non-negative', () => {
		const shifted = shiftStarts([word(50, 300), word(2120, 2400), word(2130, 2140)], 120);
		expect(shifted.map((t) => [t.startMs, t.endMs])).toEqual([
			[0, 180],
			[2000, 2280],
			[2010, 2020]
		]);
	});
});
