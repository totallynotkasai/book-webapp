/**
 * WordId carry-forward (DESIGN.md §6.2): a new Revision's Words keep the WordIds of the previous
 * Revision's Words they match, and inserted Words get new IDs from the Book's counter.
 *
 * Chapters are diffed in pairs with the same `chapterId`. A Chapter with no partner (renamed or
 * moved to a new file) is diffed against the unpaired old Chapter whose vocabulary it shares
 * most, if they share enough (the whole-Book fallback). Text moved between two paired Chapters
 * gets new WordIds; `migrateAnchors` still re-finds notes on it by their quote.
 */
import { matchTokens, normaliseToken } from './diff';
import type { RevisionWords } from './revision';

export interface DraftChapter {
	chapterId: string;
	texts: readonly string[];
}

export interface AssignedWordIds {
	/** WordIds per Chapter, in reading order. */
	ids: number[][];
	nextWordId: number;
	/** The previous Revision's WordIds that this one doesn't have, ascending. */
	deleted: number[];
}

/** Below this share of common vocabulary an unpaired Chapter is treated as new. */
const MOVED_CHAPTER_SIMILARITY = 0.5;

export function assignWordIds(
	chapters: readonly DraftChapter[],
	previous?: RevisionWords,
	firstWordId = 1
): AssignedWordIds {
	let next = Math.max(firstWordId, previous?.nextWordId ?? 1);
	const matched: (number | undefined)[][] = chapters.map((c) => new Array(c.texts.length));
	if (previous) {
		const oldById = new Map(previous.chapters.map((c) => [c.chapterId, c]));
		const usedOld = new Set<string>();
		const unpaired: number[] = [];
		const norm = (texts: readonly string[]) => texts.map(normaliseToken);

		chapters.forEach((chapter, c) => {
			const old = oldById.get(chapter.chapterId);
			if (!old) return unpaired.push(c);
			usedOld.add(old.chapterId);
			for (const [i, j] of matchTokens(norm(old.texts), norm(chapter.texts))) {
				matched[c]![j] = old.wordIds[i];
			}
		});

		for (const c of unpaired) {
			const tokens = norm(chapters[c]!.texts);
			const vocabulary = new Set(tokens);
			let best: { chapterId: string; score: number } | null = null;
			for (const old of previous.chapters) {
				if (usedOld.has(old.chapterId)) continue;
				const oldVocabulary = new Set(norm(old.texts));
				let shared = 0;
				for (const t of vocabulary) if (oldVocabulary.has(t)) shared++;
				const score = shared / Math.max(1, new Set([...vocabulary, ...oldVocabulary]).size);
				if (score >= MOVED_CHAPTER_SIMILARITY && (!best || score > best.score)) {
					best = { chapterId: old.chapterId, score };
				}
			}
			if (!best) continue;
			usedOld.add(best.chapterId);
			const old = oldById.get(best.chapterId)!;
			for (const [i, j] of matchTokens(norm(old.texts), tokens)) {
				matched[c]![j] = old.wordIds[i];
			}
		}
	}

	const ids = matched.map((chapter) => {
		const out = new Array<number>(chapter.length);
		for (let i = 0; i < chapter.length; i++) out[i] = chapter[i] ?? next++;
		return out;
	});
	const kept = new Set(ids.flat());
	const deleted = previous
		? previous.chapters
				.flatMap((c) => c.wordIds)
				.filter((id) => !kept.has(id))
				.sort((a, b) => a - b)
		: [];
	return { ids, nextWordId: next, deleted };
}
