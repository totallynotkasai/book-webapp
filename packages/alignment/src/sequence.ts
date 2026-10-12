/**
 * Global sequence alignment of two token sequences (docs/DESIGN.md §7.2 step 4): Needleman–Wunsch
 * with affine gaps (Gotoh), fuzzy matches by edit distance, and two merge moves so a compound
 * written as one word on one side and two on the other still matches ("today" ↔ "to day").
 *
 * `a` is the Chapter's text, `b` the transcript. Transcript tokens before the first and after the
 * last aligned pair are free, because a narration has spoken extras the text doesn't (a LibriVox
 * preamble, "End of chapter one"). Everything else is global.
 *
 * Memory is bounded by a band around the diagonal from (0, 0) to (n, m): only cells within
 * `band` columns of it are computed, so a Chapter costs O(n × band) time and bytes instead of
 * O(n × m). If the best path touches the band's edge the band was too narrow, so the alignment is
 * redone with a band twice as wide, up to the full matrix.
 */
import { isFuzzyMatch } from './similarity';

export interface AlignScores {
	match: number;
	fuzzy: number;
	mismatch: number;
	/** Cost of the first token of a gap (negative). */
	gapOpen: number;
	/** Cost of each further token of the same gap (negative). */
	gapExtend: number;
	/** Two tokens on one side spelling exactly the one token on the other. */
	merge: number;
}

export const DEFAULT_SCORES: AlignScores = {
	match: 2,
	fuzzy: 1,
	mismatch: -1,
	gapOpen: -2,
	gapExtend: -0.5,
	merge: 3
};

export type PairKind = 'exact' | 'fuzzy' | 'merge' | 'mismatch';

/** Tokens `a[aStart..aEnd)` aligned with `b[bStart..bEnd)`. Unaligned tokens appear in no pair. */
export interface AlignedPair {
	aStart: number;
	aEnd: number;
	bStart: number;
	bEnd: number;
	kind: PairKind;
}

export interface SequenceOptions {
	/** Initial half-width of the band, in tokens (default 200). */
	band?: number;
	scores?: Partial<AlignScores>;
	/** Minimum similarity (1 − distance / length) for a fuzzy match (default 0.6). */
	minSimilarity?: number;
}

export interface SequenceAlignment {
	pairs: AlignedPair[];
	score: number;
	/** The band half-width the final pass used. */
	band: number;
	/** Cells computed across all passes. */
	cells: number;
}

const M = 0;
const X = 1; // a token unaligned (gap in b)
const Y = 2; // b token unaligned (gap in a)
const DIAG = 0;
const MERGE_A = 1; // a[i-2] + a[i-1] = b[j-1]
const MERGE_B = 2; // a[i-1] = b[j-2] + b[j-1]

export function alignSequences(
	a: readonly string[],
	b: readonly string[],
	options: SequenceOptions = {}
): SequenceAlignment {
	const scores = { ...DEFAULT_SCORES, ...options.scores };
	const minSimilarity = options.minSimilarity ?? 0.6;
	const full = Math.max(a.length, b.length);
	let band = Math.max(1, Math.min(options.band ?? 200, full));
	let cells = 0;
	if (a.length === 0 || b.length === 0) return { pairs: [], score: 0, band: 0, cells: 0 };

	// Intern tokens so equality is an integer compare and fuzzy results can be cached per pair.
	const vocab = new Map<string, number>();
	const intern = (t: string) => {
		let id = vocab.get(t);
		if (id === undefined) vocab.set(t, (id = vocab.size));
		return id;
	};
	const ai = a.map(intern);
	const bi = b.map(intern);
	const words = [...vocab.keys()];
	const fuzzyCache = new Map<number, boolean>();
	const similarity = (x: number, y: number): number => {
		if (x === y) return scores.match;
		const key = x * vocab.size + y;
		let fuzzy = fuzzyCache.get(key);
		if (fuzzy === undefined) {
			fuzzy = isFuzzyMatch(words[x]!, words[y]!, minSimilarity);
			fuzzyCache.set(key, fuzzy);
		}
		return fuzzy ? scores.fuzzy : scores.mismatch;
	};
	const kindOf = (x: number, y: number): PairKind =>
		x === y ? 'exact' : similarity(x, y) === scores.fuzzy ? 'fuzzy' : 'mismatch';
	const concatEquals = (whole: string, first: string, second: string) =>
		whole.length === first.length + second.length &&
		whole.startsWith(first) &&
		whole.endsWith(second);

	for (;;) {
		const result = run(band);
		cells += result.cells;
		if (!result.touchedEdge || band >= full) return { ...result, band, cells };
		band = Math.min(full, band * 2);
	}

	function run(w: number) {
		const n = a.length;
		const m = b.length;
		const width = 2 * w + 1;
		const lo = (i: number) => Math.round((i * m) / n) - w;
		const trace = new Uint8Array((n + 1) * width);
		// Three rolling rows per state (the merge move looks two rows back).
		const rows = [0, 1, 2].map(() => [0, 1, 2].map(() => new Float64Array(width).fill(-Infinity)));
		const row = (i: number) => rows[i % 3]!;
		const get = (i: number, j: number, state: number) => {
			if (i < 0 || j < 0 || j > m) return -Infinity;
			const k = j - lo(i);
			return k < 0 || k >= width ? -Infinity : row(i)[state]![k]!;
		};
		const best = (i: number, j: number): [number, number] => {
			const sm = get(i, j, M);
			const sx = get(i, j, X);
			const sy = get(i, j, Y);
			if (sm >= sx && sm >= sy) return [sm, M];
			return sx >= sy ? [sx, X] : [sy, Y];
		};

		let computed = 0;
		for (let i = 0; i <= n; i++) {
			const [rm, rx, ry] = row(i) as [Float64Array, Float64Array, Float64Array];
			rm.fill(-Infinity);
			rx.fill(-Infinity);
			ry.fill(-Infinity);
			const start = lo(i);
			const last = i === n; // trailing transcript tokens are free
			for (let k = 0; k < width; k++) {
				const j = start + k;
				if (j < 0 || j > m) continue;
				computed++;
				let cell = 0;
				if (i === 0) {
					// Leading transcript tokens are free.
					if (j === 0) rm[k] = 0;
					else ry[k] = 0;
					continue;
				}
				// X: a[i-1] unaligned.
				{
					const fm = get(i - 1, j, M) + scores.gapOpen;
					const fx = get(i - 1, j, X) + scores.gapExtend;
					const fy = get(i - 1, j, Y) + scores.gapOpen;
					let v = fm;
					let from = M;
					if (fx > v) [v, from] = [fx, X];
					if (fy > v) [v, from] = [fy, Y];
					rx[k] = v;
					cell |= from << 4;
				}
				if (j > 0) {
					// M: a[i-1] aligned with b[j-1], or one of the merges.
					const [prev, diagFrom] = best(i - 1, j - 1);
					let from = diagFrom;
					let v = prev + similarity(ai[i - 1]!, bi[j - 1]!);
					let move = DIAG;
					if (i >= 2 && concatEquals(b[j - 1]!, a[i - 2]!, a[i - 1]!)) {
						const [p2, f2] = best(i - 2, j - 1);
						if (p2 + scores.merge > v) [v, from, move] = [p2 + scores.merge, f2, MERGE_A];
					}
					if (j >= 2 && concatEquals(a[i - 1]!, b[j - 2]!, b[j - 1]!)) {
						const [p2, f2] = best(i - 1, j - 2);
						if (p2 + scores.merge > v) [v, from, move] = [p2 + scores.merge, f2, MERGE_B];
					}
					rm[k] = v;
					cell |= from | (move << 2);
					// Y: b[j-1] unaligned (free on the last row).
					const open = last ? 0 : scores.gapOpen;
					const extend = last ? 0 : scores.gapExtend;
					const ym = k > 0 ? rm[k - 1]! + open : -Infinity;
					const yy = k > 0 ? ry[k - 1]! + extend : -Infinity;
					const yx = k > 0 ? rx[k - 1]! + open : -Infinity;
					let yv = ym;
					let yfrom = M;
					if (yy > yv) [yv, yfrom] = [yy, Y];
					if (yx > yv) [yv, yfrom] = [yx, X];
					ry[k] = yv;
					cell |= yfrom << 6;
				}
				trace[i * width + k] = cell;
			}
		}

		// Trace back from (n, m).
		const [score, endState] = best(n, m);
		const pairs: AlignedPair[] = [];
		let touchedEdge = false;
		let i = n;
		let j = m;
		let state = endState;
		while (i > 0 && j > 0) {
			const k = j - lo(i);
			if ((k === 0 && j > 0) || (k === width - 1 && j < m)) touchedEdge = true;
			const cell = trace[i * width + k]!;
			if (state === M) {
				const move = (cell >> 2) & 3;
				const from = cell & 3;
				if (move === MERGE_A) {
					pairs.push({ aStart: i - 2, aEnd: i, bStart: j - 1, bEnd: j, kind: 'merge' });
					i -= 2;
					j -= 1;
				} else if (move === MERGE_B) {
					pairs.push({ aStart: i - 1, aEnd: i, bStart: j - 2, bEnd: j, kind: 'merge' });
					i -= 1;
					j -= 2;
				} else {
					const kind = kindOf(ai[i - 1]!, bi[j - 1]!);
					pairs.push({ aStart: i - 1, aEnd: i, bStart: j - 1, bEnd: j, kind });
					i -= 1;
					j -= 1;
				}
				state = from;
			} else if (state === X) {
				state = (cell >> 4) & 3;
				i -= 1;
			} else {
				state = (cell >> 6) & 3;
				j -= 1;
			}
		}
		pairs.reverse();
		return { pairs, score, cells: computed, touchedEdge };
	}
}
