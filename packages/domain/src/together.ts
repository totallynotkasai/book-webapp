/**
 * Readers together (P1-COM-03, P1-COM-04; DESIGN.md §4.8), shared by `backend-local` now and
 * Phase 6's server: who sees a comment, the order a Chapter's comments are in, and which passages
 * count as popular highlights.
 */

/**
 * SIMULATION: a placeholder until Phase 6 has real readers to count. A passage needs this many
 * different readers' highlights before anyone is shown it, so a count can't point at one reader.
 */
export const POPULAR_HIGHLIGHT_MIN_READERS = 5;

export interface CommentShape {
	id: string;
	userId: string;
	/**
	 * `hidden`: a moderator hid it after a report (§10.6). `deleted`: its writer deleted it, but it
	 * has replies, so it stays as a placeholder above them.
	 */
	state: 'visible' | 'hidden' | 'deleted';
	createdAt: string;
	/** The order they were written in, for ones written in the same instant. */
	seq: number;
}

/**
 * Everyone sees a comment (or a deleted one's place above its replies) until a moderator hides
 * it; then only the reader who wrote it does.
 */
export function commentVisibleTo(comment: CommentShape, userId: string | null): boolean {
	return comment.state !== 'hidden' || comment.userId === userId;
}

/** Reading order: where the passage starts, then the oldest first. */
export function commentOrder(
	a: CommentShape & { startOrdinal: number },
	b: CommentShape & { startOrdinal: number }
): number {
	return a.startOrdinal - b.startOrdinal || oldestFirst(a, b);
}

/** Replies, and anything else in a thread: the oldest first, then in the order written. */
export function oldestFirst(a: CommentShape, b: CommentShape): number {
	return a.createdAt.localeCompare(b.createdAt) || a.seq - b.seq || a.id.localeCompare(b.id);
}

/** One reader's highlight, by Ordinal on one Revision; who it is matters only for counting. */
export interface ReaderHighlight {
	readerId: string;
	chapterId: string;
	startOrdinal: number;
	endOrdinal: number;
}

export interface PopularPassage {
	chapterId: string;
	startOrdinal: number;
	endOrdinal: number;
	/** Different readers whose highlights touch the passage. */
	readers: number;
}

interface Span {
	start: number;
	end: number;
}

/** A reader's own highlights as spans that don't overlap or touch, so they count once a Word. */
function mergeSpans(spans: Span[]): Span[] {
	const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
	const merged: Span[] = [];
	for (const span of sorted) {
		const last = merged.at(-1);
		if (last && span.start <= last.end + 1) last.end = Math.max(last.end, span.end);
		else merged.push({ ...span });
	}
	return merged;
}

/**
 * Popular highlights (P1-COM-04): the runs of Words at least `minReaders` different readers'
 * highlights cover, within a Chapter, in reading order. Each counts every reader whose highlight
 * touches it, so a sentence 9 readers highlighted and 4 more highlighted part of is one passage
 * of 13 readers. Who they are never leaves this function.
 */
export function popularPassages(
	highlights: readonly ReaderHighlight[],
	minReaders = POPULAR_HIGHLIGHT_MIN_READERS
): PopularPassage[] {
	const least = Math.max(1, Math.floor(minReaders));
	const byChapter = new Map<string, Map<string, Span[]>>();
	for (const h of highlights) {
		if (h.endOrdinal < h.startOrdinal) continue;
		const readers = byChapter.get(h.chapterId) ?? new Map<string, Span[]>();
		byChapter.set(h.chapterId, readers);
		const spans = readers.get(h.readerId) ?? [];
		readers.set(h.readerId, spans);
		spans.push({ start: h.startOrdinal, end: h.endOrdinal });
	}
	const passages: PopularPassage[] = [];
	for (const [chapterId, readers] of byChapter) {
		const spansOf = new Map([...readers].map(([reader, spans]) => [reader, mergeSpans(spans)]));
		// How many readers cover each Word: +1 where a span starts, -1 after it ends.
		const changes = new Map<number, number>();
		for (const spans of spansOf.values()) {
			for (const { start, end } of spans) {
				changes.set(start, (changes.get(start) ?? 0) + 1);
				changes.set(end + 1, (changes.get(end + 1) ?? 0) - 1);
			}
		}
		const points = [...changes.keys()].sort((a, b) => a - b);
		const runs: Span[] = [];
		let covered = 0;
		for (let i = 0; i < points.length; i++) {
			const at = points[i]!;
			covered += changes.get(at)!;
			const next = points[i + 1];
			if (covered < least || next === undefined) continue;
			const last = runs.at(-1);
			if (last && last.end + 1 === at) last.end = next - 1;
			else runs.push({ start: at, end: next - 1 });
		}
		for (const run of runs) {
			let count = 0;
			for (const spans of spansOf.values()) {
				if (spans.some((s) => s.start <= run.end && s.end >= run.start)) count++;
			}
			passages.push({ chapterId, startOrdinal: run.start, endOrdinal: run.end, readers: count });
		}
	}
	return passages.sort((a, b) => a.startOrdinal - b.startOrdinal);
}
