/**
 * Token matching for WordId carry-forward (DESIGN.md §6.2): a Myers diff over normalised tokens,
 * after trimming the common prefix and suffix. Pure and deterministic.
 *
 * Short matched runs inside changed text are dropped (\`minRun\`): when a paragraph is rewritten,
 * a lone "the" that happens to line up is a different Word, and giving it the old WordId would let
 * a note on the old text "survive" in the wrong place. Runs at either end of the sequence are kept,
 * since nothing before or after them changed.
 */

/** Case and compatibility forms don't make a different Word ("The" at a sentence start). */
export function normaliseToken(text: string): string {
	return text.normalize('NFKC').toLowerCase();
}

export interface MatchOptions {
	/** Matched runs shorter than this, away from the ends, are treated as changed. Default 3. */
	minRun?: number;
	/** Above this many edits the middle is treated as rewritten (bounds time and memory). */
	maxEdits?: number;
}

/** Pairs `[i, j]` with `a[i] === b[j]`, increasing in both, from a shortest edit script. */
export function matchTokens(
	a: readonly string[],
	b: readonly string[],
	options: MatchOptions = {}
): [number, number][] {
	const minRun = options.minRun ?? 3;
	const maxEdits = options.maxEdits ?? 1000;
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < a.length - prefix &&
		suffix < b.length - prefix &&
		a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
	) {
		suffix++;
	}
	const pairs: [number, number][] = [];
	for (let i = 0; i < prefix; i++) pairs.push([i, i]);
	const middle = myers(
		a.slice(prefix, a.length - suffix),
		b.slice(prefix, b.length - suffix),
		maxEdits
	);
	for (const [i, j] of middle ?? []) pairs.push([i + prefix, j + prefix]);
	for (let s = suffix; s > 0; s--) pairs.push([a.length - s, b.length - s]);
	return dropShortRuns(pairs, a.length, b.length, minRun);
}

function dropShortRuns(
	pairs: [number, number][],
	aLength: number,
	bLength: number,
	minRun: number
): [number, number][] {
	if (minRun <= 1) return pairs;
	const kept: [number, number][] = [];
	let start = 0;
	while (start < pairs.length) {
		let end = start + 1;
		while (
			end < pairs.length &&
			pairs[end]![0] === pairs[end - 1]![0] + 1 &&
			pairs[end]![1] === pairs[end - 1]![1] + 1
		) {
			end++;
		}
		const first = pairs[start]!;
		const last = pairs[end - 1]!;
		const anchored =
			(first[0] === 0 && first[1] === 0) || (last[0] === aLength - 1 && last[1] === bLength - 1);
		if (anchored || end - start >= minRun) kept.push(...pairs.slice(start, end));
		start = end;
	}
	return kept;
}

/**
 * Myers' O(ND) diff (1986). Returns matched index pairs, or null when more than `maxEdits` edits
 * would be needed.
 */
function myers(a: readonly string[], b: readonly string[], maxEdits: number) {
	const n = a.length;
	const m = b.length;
	if (n === 0 || m === 0) return [];
	const limit = Math.min(n + m, maxEdits);
	const offset = limit + 1;
	const v = new Int32Array(2 * limit + 3);
	const trace: Int32Array[] = [];
	for (let d = 0; d <= limit; d++) {
		trace.push(v.slice());
		for (let k = -d; k <= d; k += 2) {
			let x =
				k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)
					? v[k + 1 + offset]!
					: v[k - 1 + offset]! + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v[k + offset] = x;
			if (x >= n && y >= m) return backtrack(trace, d, n, m, offset);
		}
	}
	return null;
}

function backtrack(trace: Int32Array[], depth: number, n: number, m: number, offset: number) {
	const pairs: [number, number][] = [];
	let x = n;
	let y = m;
	for (let d = depth; d > 0; d--) {
		const v = trace[d]!;
		const k = x - y;
		const previousK =
			k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!) ? k + 1 : k - 1;
		const previousX = v[previousK + offset]!;
		const previousY = previousX - previousK;
		while (x > previousX && y > previousY) {
			x--;
			y--;
			pairs.push([x, y]);
		}
		x = previousX;
		y = previousY;
	}
	while (x > 0 && y > 0) {
		x--;
		y--;
		pairs.push([x, y]);
	}
	return pairs.reverse();
}
