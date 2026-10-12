/**
 * An independent check on Word timings, from the audio itself. There is no ground truth for a
 * narration, but a Word that follows a clear pause should start where the speech energy rises
 * again, and the Word before it should end where it fell. `findPauses` finds those moments in
 * mono PCM; `timingAccuracy` measures how far aligned Words land from them; `startBias` is the
 * median signed error, which `shiftStarts` can remove (whisper's DTW onsets run late, ADR-003).
 */
import type { WordTiming } from './align';

export interface Pause {
	/** Where speech stopped (ms). */
	fromMs: number;
	/** Where speech started again: the onset of the next Word (ms). */
	toMs: number;
}

export interface PauseOptions {
	/** Shortest silence counted as a pause (default 300 ms). */
	minPauseMs?: number;
	/** Analysis frame (default 10 ms). */
	frameMs?: number;
}

const quantile = (sorted: readonly number[], q: number) =>
	sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

/**
 * Pauses in mono PCM samples (16-bit integers or floats). The silence threshold adapts to the
 * recording: it sits between its quietest and loudest frames, at least 10 dB above the floor.
 */
export function findPauses(
	samples: ArrayLike<number>,
	sampleRate: number,
	options: PauseOptions = {}
): Pause[] {
	const frameMs = options.frameMs ?? 10;
	const minFrames = Math.ceil((options.minPauseMs ?? 300) / frameMs);
	const size = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
	const db: number[] = [];
	for (let i = 0; i + size <= samples.length; i += size) {
		let sum = 0;
		for (let j = i; j < i + size; j++) sum += samples[j]! * samples[j]!;
		db.push(10 * Math.log10(sum / size + 1e-12));
	}
	if (!db.length) return [];
	const sorted = [...db].sort((a, b) => a - b);
	const floor = quantile(sorted, 0.1);
	const speech = quantile(sorted, 0.9);
	const threshold = floor + Math.max(10, 0.35 * (speech - floor));

	const pauses: Pause[] = [];
	let start = -1;
	for (let f = 0; f < db.length; f++) {
		const quiet = db[f]! < threshold;
		if (quiet) {
			if (start < 0) start = f;
			continue;
		}
		if (start > 0 && f - start >= minFrames) {
			// Count it only if speech is sustained (4 of the next 5 frames), so a click isn't an onset.
			const loud = db.slice(f, f + 5).filter((v) => v >= threshold).length;
			if (loud >= 4) pauses.push({ fromMs: start * frameMs, toMs: f * frameMs });
		}
		start = -1;
	}
	return pauses;
}

export interface ErrorSummary {
	n: number;
	medianAbsMs: number;
	p90AbsMs: number;
	/** Positive: the Words' times are later than the audio. */
	medianSignedMs: number;
	/** Share of errors within ±100 ms. */
	within100ms: number;
}

function summarise(errors: number[]): ErrorSummary {
	if (!errors.length)
		return { n: 0, medianAbsMs: 0, p90AbsMs: 0, medianSignedMs: 0, within100ms: 0 };
	const abs = errors.map(Math.abs).sort((a, b) => a - b);
	const signed = [...errors].sort((a, b) => a - b);
	return {
		n: errors.length,
		medianAbsMs: Math.round(quantile(abs, 0.5)),
		p90AbsMs: Math.round(quantile(abs, 0.9)),
		medianSignedMs: Math.round(quantile(signed, 0.5)),
		within100ms: Math.round((abs.filter((e) => e <= 100).length / abs.length) * 1000) / 1000
	};
}

/** Index of the value nearest `target` in an ascending list, within `window`, or -1. */
function nearest(sorted: readonly number[], target: number, window: number): number {
	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid]! < target) lo = mid + 1;
		else hi = mid;
	}
	let best = -1;
	for (const i of [lo - 1, lo]) {
		if (i < 0 || i >= sorted.length) continue;
		const d = Math.abs(sorted[i]! - target);
		if (d <= window && (best < 0 || d < Math.abs(sorted[best]! - target))) best = i;
	}
	return best;
}

export interface TimingAccuracy {
	pauses: number;
	/** Matched Words' starts against the onsets after pauses. */
	start: ErrorSummary;
	/** Matched Words' ends against the starts of pauses. */
	end: ErrorSummary;
}

/** How far matched Words' starts and ends land from the pauses' edges (nearest within ±1 s). */
export function timingAccuracy(
	timings: readonly WordTiming[],
	pauses: readonly Pause[],
	windowMs = 1000
): TimingAccuracy {
	const matched = timings.filter((t) => t.matched);
	const starts = matched.map((t) => t.startMs).sort((a, b) => a - b);
	const ends = matched.map((t) => t.endMs).sort((a, b) => a - b);
	const startErrors: number[] = [];
	const endErrors: number[] = [];
	for (const pause of pauses) {
		const s = nearest(starts, pause.toMs, windowMs);
		if (s >= 0) startErrors.push(starts[s]! - pause.toMs);
		const e = nearest(ends, pause.fromMs, windowMs);
		if (e >= 0) endErrors.push(ends[e]! - pause.fromMs);
	}
	return { pauses: pauses.length, start: summarise(startErrors), end: summarise(endErrors) };
}

/** The median amount by which matched Words start late (positive) or early after pauses. */
export function startBias(timings: readonly WordTiming[], pauses: readonly Pause[]): number {
	return timingAccuracy(timings, pauses).start.medianSignedMs;
}

/**
 * Moves every Word earlier by `offsetMs` (or later, if negative), never before 0 and keeping
 * starts in order. Durations are kept.
 */
export function shiftStarts(timings: readonly WordTiming[], offsetMs: number): WordTiming[] {
	let previous = 0;
	return timings.map((t) => {
		const startMs = Math.max(previous, t.startMs - offsetMs, 0);
		previous = startMs;
		return { ...t, startMs, endMs: Math.max(startMs, t.endMs - offsetMs) };
	});
}
