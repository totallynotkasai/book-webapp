/** Levenshtein edit distance, giving up (returning `limit + 1`) once it must exceed `limit`. */
export function editDistance(a: string, b: string, limit = Infinity): number {
	if (a === b) return 0;
	if (Math.abs(a.length - b.length) > limit) return limit + 1;
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	let current = new Array<number>(b.length + 1);
	for (let i = 1; i <= a.length; i++) {
		current[0] = i;
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
			current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
			rowMin = Math.min(rowMin, current[j]!);
		}
		if (rowMin > limit) return limit + 1;
		[previous, current] = [current, previous];
	}
	return previous[b.length]!;
}

/**
 * Whether two different tokens are close enough to count as the same Word misheard or spelled
 * differently ("alis" for "alice", "dinah" for "dina"). Short tokens must match exactly: "he" and
 * "she" are different Words, not a spelling variant.
 */
export function isFuzzyMatch(a: string, b: string, minSimilarity = 0.6): boolean {
	const longest = Math.max(a.length, b.length);
	if (longest < 4) return false;
	const limit = Math.floor(longest * (1 - minSimilarity) + 1e-9);
	return editDistance(a, b, limit) <= limit;
}
