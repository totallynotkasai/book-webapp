/**
 * Re-anchoring after a new Revision (`migrate-anchors`, DESIGN.md §6.2). Pure: the reader's
 * re-import (P1-ING-03), the Studio's publish (P1-STU-01) and the Phase 2 worker all call it.
 *
 * For each Anchor on the previous Revision:
 * 1. Its WordIds still exist: same Words, new Ordinals and a fresh quote.
 * 2. Otherwise its quote is searched for: exact, then fuzzy; its old Chapter first, then the Book.
 *    A short quote (one or two Words) must also match its surrounding text, so a bookmark on
 *    "the" doesn't land on any other "the".
 * 3. Otherwise it's orphaned and keeps its old data, so the reader can still see what it said.
 * Reading Progress instead falls back to the nearest surviving Word before it.
 */
import type { Anchor, PointAnchor, RangeAnchor, TextQuote } from '@book/core';
import { matchTokens, normaliseToken } from './diff';
import type { RevisionWords } from './revision';
import { tokenise } from './tokenise';

/** Same as reader-core's quotes (W3C TextQuoteSelector context). */
const QUOTE_CONTEXT = 32;
/** A fuzzy match must keep this share of the quote's Words, in order. */
const FUZZY_MIN = 0.75;
/** A one- or two-Word quote also needs this many Words of matching context around it. */
const SHORT_QUOTE_CONTEXT = 4;
/** At most this many fuzzy candidates get a full comparison. */
const FUZZY_CANDIDATES = 40;

export type MigrationStatus = 'ok' | 'migrated' | 'orphaned';

export interface Migrated<A extends Anchor> {
	anchor: A;
	/** `ok`: already on that Revision; `orphaned`: the old Anchor, unchanged. */
	status: MigrationStatus;
	/** How it was re-found, for reports and tests. */
	via?: 'word-ids' | 'quote' | 'fuzzy-quote' | 'nearest-word';
}

/** A Revision's Words by Ordinal, with lookups (built once per migration run). */
export class RevisionIndex {
	readonly revisionId: string;
	readonly bookId: string;
	readonly wordCount: number;
	/** Normalised text of every Word, in reading order. */
	readonly tokens: string[] = [];
	readonly #ordinalOf = new Map<number, number>();
	readonly #chapterOf: number[] = [];
	readonly #revision: RevisionWords;

	constructor(revision: RevisionWords) {
		this.#revision = revision;
		this.revisionId = revision.revisionId;
		this.bookId = revision.bookId;
		this.wordCount = revision.wordCount;
		revision.chapters.forEach((chapter, c) => {
			chapter.wordIds.forEach((id, i) => {
				const ordinal = chapter.firstOrdinal + i;
				this.#ordinalOf.set(id, ordinal);
				this.#chapterOf[ordinal] = c;
				this.tokens[ordinal] = normaliseToken(chapter.texts[i]!);
			});
		});
	}

	ordinalOf(wordId: number): number | undefined {
		return this.#ordinalOf.get(wordId);
	}

	#locate(ordinal: number) {
		const c = this.#chapterOf[ordinal];
		if (c === undefined) throw new RangeError(`No Word at Ordinal ${ordinal}.`);
		const chapter = this.#revision.chapters[c]!;
		return { chapter, i: ordinal - chapter.firstOrdinal };
	}

	chapterIdAt(ordinal: number): string | undefined {
		const c = this.#chapterOf[ordinal];
		return c === undefined ? undefined : this.#revision.chapters[c]!.chapterId;
	}

	/** First and last Ordinal of a Chapter, or null if this Revision has no Words there. */
	chapterSpan(chapterId: string): [number, number] | null {
		const chapter = this.#revision.chapters.find((c) => c.chapterId === chapterId);
		if (!chapter || chapter.wordIds.length === 0) return null;
		return [chapter.firstOrdinal, chapter.firstOrdinal + chapter.wordIds.length - 1];
	}

	wordIdAt(ordinal: number): number {
		const { chapter, i } = this.#locate(ordinal);
		return chapter.wordIds[i]!;
	}

	/** Words as on the page, within one Chapter, as reader-core builds quotes. */
	quote(first: number, last: number): TextQuote {
		const { chapter, i: a } = this.#locate(first);
		const b = last - chapter.firstOrdinal;
		const pieces: string[] = [];
		let block = -1;
		let from = 0;
		let to = 0;
		const flush = () => {
			if (block >= 0) pieces.push(chapter.blockTexts[block]!.slice(from, to));
		};
		for (let i = a; i <= b; i++) {
			const [, wb, start, end] = chapter.entries[i]!;
			if (wb !== block) {
				flush();
				block = wb;
				from = start;
			}
			to = end;
		}
		flush();
		const exact = pieces.join(' ').replace(/\s+/g, ' ').trim();
		let prefix = '';
		for (let i = a - 1; i >= 0 && prefix.length < QUOTE_CONTEXT; i--) {
			prefix = `${chapter.texts[i]} ${prefix}`;
		}
		let suffix = '';
		for (let i = b + 1; i < chapter.texts.length && suffix.length < QUOTE_CONTEXT; i++) {
			suffix = `${suffix} ${chapter.texts[i]}`;
		}
		return {
			exact,
			prefix: prefix.trimEnd().slice(-QUOTE_CONTEXT),
			suffix: suffix.trimStart().slice(0, QUOTE_CONTEXT)
		};
	}

	pointAnchor(ordinal: number): PointAnchor {
		return {
			kind: 'point',
			bookId: this.bookId,
			revisionId: this.revisionId,
			wordId: this.wordIdAt(ordinal),
			ordinal,
			quote: this.quote(ordinal, ordinal)
		};
	}

	rangeAnchor(first: number, last: number): RangeAnchor {
		return {
			kind: 'range',
			bookId: this.bookId,
			revisionId: this.revisionId,
			startWordId: this.wordIdAt(first),
			endWordId: this.wordIdAt(last),
			startOrdinal: first,
			endOrdinal: last,
			quote: this.quote(first, last)
		};
	}
}

const tokensOf = (text: string) =>
	tokenise(text).map((t) => normaliseToken(text.slice(t.start, t.end)));

/** How many Words of context around a match agree with the quote's prefix and suffix. */
function contextScore(to: RevisionIndex, first: number, last: number, quote: TextQuote): number {
	const prefix = tokensOf(quote.prefix);
	const suffix = tokensOf(quote.suffix);
	let score = 0;
	for (let k = 0; k < prefix.length; k++) {
		if (to.tokens[first - 1 - k] !== prefix[prefix.length - 1 - k]) break;
		score++;
	}
	for (let k = 0; k < suffix.length; k++) {
		if (to.tokens[last + 1 + k] !== suffix[k]) break;
		score++;
	}
	return score;
}

function findExact(to: RevisionIndex, q: string[], span: [number, number], quote: TextQuote) {
	let best: { first: number; last: number; score: number } | null = null;
	for (let s = span[0]; s + q.length - 1 <= span[1]; s++) {
		let k = 0;
		while (k < q.length && to.tokens[s + k] === q[k]) k++;
		if (k < q.length) continue;
		const last = s + q.length - 1;
		const score = contextScore(to, s, last, quote);
		if (!best || score > best.score) best = { first: s, last, score };
	}
	// One or two Words are everywhere: only a match in the same surroundings counts.
	if (best && q.length < 3 && best.score < SHORT_QUOTE_CONTEXT) return null;
	return best;
}

function findFuzzy(to: RevisionIndex, q: string[], span: [number, number], quote: TextQuote) {
	const n = q.length;
	if (n < 4 || span[1] - span[0] + 1 < n) return null;
	const want = new Map<string, number>();
	for (const t of q) want.set(t, (want.get(t) ?? 0) + 1);
	const have = new Map<string, number>();
	let overlap = 0;
	const add = (t: string) => {
		const c = have.get(t) ?? 0;
		if (c < (want.get(t) ?? 0)) overlap++;
		have.set(t, c + 1);
	};
	const remove = (t: string) => {
		const c = have.get(t)! - 1;
		have.set(t, c);
		if (c < (want.get(t) ?? 0)) overlap--;
	};
	const candidates: { start: number; overlap: number }[] = [];
	for (let i = span[0]; i <= span[1]; i++) {
		add(to.tokens[i]!);
		if (i - span[0] >= n) remove(to.tokens[i - n]!);
		const start = i - n + 1;
		if (start >= span[0] && overlap >= FUZZY_MIN * n) candidates.push({ start, overlap });
	}
	candidates.sort((a, b) => b.overlap - a.overlap || a.start - b.start);
	let best: { first: number; last: number; ratio: number; score: number } | null = null;
	for (const { start } of candidates.slice(0, FUZZY_CANDIDATES)) {
		// A little slack either side, so an inserted Word doesn't push the match out.
		const lo = Math.max(span[0], start - 2);
		const hi = Math.min(span[1], start + n + 1);
		const window = to.tokens.slice(lo, hi + 1);
		const pairs = matchTokens(q, window, { minRun: 1 });
		const ratio = pairs.length / n;
		if (ratio < FUZZY_MIN) continue;
		const first = lo + pairs[0]![1];
		const last = lo + pairs.at(-1)![1];
		const score = contextScore(to, first, last, quote);
		if (!best || ratio > best.ratio || (ratio === best.ratio && score > best.score)) {
			best = { first, last, ratio, score };
		}
	}
	return best;
}

function search(anchor: Anchor, from: RevisionIndex, to: RevisionIndex) {
	const q = tokensOf(anchor.quote.exact);
	if (!q.length || to.wordCount === 0) return null;
	const startOrdinal = anchor.kind === 'point' ? anchor.ordinal : anchor.startOrdinal;
	const chapterId = from.chapterIdAt(startOrdinal);
	const chapter = chapterId ? to.chapterSpan(chapterId) : null;
	const book: [number, number] = [0, to.wordCount - 1];
	const spans = chapter ? [chapter, book] : [book];
	for (const span of spans) {
		const hit = findExact(to, q, span, anchor.quote);
		if (hit) return { ...hit, via: 'quote' as const };
	}
	for (const span of spans) {
		const hit = findFuzzy(to, q, span, anchor.quote);
		if (hit) return { ...hit, via: 'fuzzy-quote' as const };
	}
	return null;
}

export function migrateAnchor<A extends Anchor>(
	anchor: A,
	from: RevisionIndex,
	to: RevisionIndex
): Migrated<A> {
	if (anchor.revisionId === to.revisionId) return { anchor, status: 'ok' };
	if (anchor.kind === 'point') {
		const ordinal = to.ordinalOf(anchor.wordId);
		if (ordinal !== undefined) {
			return { anchor: to.pointAnchor(ordinal) as A, status: 'migrated', via: 'word-ids' };
		}
	} else {
		const first = to.ordinalOf(anchor.startWordId);
		const last = to.ordinalOf(anchor.endWordId);
		const before = anchor.endOrdinal - anchor.startOrdinal;
		// Both ends survive and still enclose about the same text (not a chapter inserted between).
		if (
			first !== undefined &&
			last !== undefined &&
			first <= last &&
			last - first <= 2 * before + 20
		) {
			return { anchor: to.rangeAnchor(first, last) as A, status: 'migrated', via: 'word-ids' };
		}
	}
	const hit = search(anchor, from, to);
	if (hit) {
		const migrated =
			anchor.kind === 'point' ? to.pointAnchor(hit.first) : to.rangeAnchor(hit.first, hit.last);
		return { anchor: migrated as A, status: 'migrated', via: hit.via };
	}
	return { anchor, status: 'orphaned' };
}

/** Migrates many Anchors between the same two Revisions. */
export function migrateAnchors<A extends Anchor>(
	anchors: readonly A[],
	from: RevisionWords,
	to: RevisionWords
): Migrated<A>[] {
	const fromIndex = new RevisionIndex(from);
	const toIndex = new RevisionIndex(to);
	return anchors.map((anchor) => migrateAnchor(anchor, fromIndex, toIndex));
}

/**
 * Reading Progress (§6.2 step 3): its Word, else the nearest surviving Word before it, else the
 * start of the Book. Never orphaned: a reader always has a place to resume.
 */
export function migrateProgress(
	point: PointAnchor,
	from: RevisionWords,
	to: RevisionWords
): Migrated<PointAnchor> | null {
	const fromIndex = new RevisionIndex(from);
	const toIndex = new RevisionIndex(to);
	if (point.revisionId === to.revisionId) return { anchor: point, status: 'ok' };
	if (toIndex.wordCount === 0) return null;
	const exact = toIndex.ordinalOf(point.wordId);
	if (exact !== undefined) {
		return { anchor: toIndex.pointAnchor(exact), status: 'migrated', via: 'word-ids' };
	}
	const start = Math.min(fromIndex.ordinalOf(point.wordId) ?? point.ordinal, from.wordCount - 1);
	for (let o = start - 1; o >= 0; o--) {
		const ordinal = toIndex.ordinalOf(fromIndex.wordIdAt(o));
		if (ordinal !== undefined) {
			return { anchor: toIndex.pointAnchor(ordinal), status: 'migrated', via: 'nearest-word' };
		}
	}
	return { anchor: toIndex.pointAnchor(0), status: 'migrated', via: 'nearest-word' };
}
