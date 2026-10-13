/**
 * Creator Studio rules (DESIGN.md §4.7, §6.2, P1-STU-01, P1-STU-02, P1-LAY-05), shared by
 * `backend-local` now and the API from Phase 2: what a new Revision changes, what stops a
 * Book or a pack being published, and store addresses for new Books.
 */
import type { AiUse } from '@book/core';

/** A Revision's Chapters by their Words' IDs, in reading order (from its word indexes). */
export interface ChapterWords {
	chapterId: string;
	wordIds: readonly number[];
}

export interface RevisionChanges {
	changedChapterIds: string[];
	addedChapterIds: string[];
	removedChapterIds: string[];
	wordsAdded: number;
	wordsRemoved: number;
}

/**
 * What a new Revision changed (§6.2): a Chapter in both whose Words differ in any way (new,
 * deleted or reordered WordIds) is changed. Unchanged Words keep their WordIds (carry-forward),
 * so comparing IDs is exact. Its narration needs re-aligning (§7.2).
 */
export function revisionChanges(
	before: readonly ChapterWords[],
	after: readonly ChapterWords[]
): RevisionChanges {
	const old = new Map(before.map((c) => [c.chapterId, c.wordIds]));
	const now = new Map(after.map((c) => [c.chapterId, c.wordIds]));
	const same = (a: readonly number[], b: readonly number[]) =>
		a.length === b.length && a.every((id, i) => id === b[i]);
	const oldIds = new Set(before.flatMap((c) => c.wordIds));
	const newIds = new Set(after.flatMap((c) => c.wordIds));
	return {
		changedChapterIds: after
			.filter((c) => old.has(c.chapterId) && !same(old.get(c.chapterId)!, c.wordIds))
			.map((c) => c.chapterId),
		addedChapterIds: after.filter((c) => !old.has(c.chapterId)).map((c) => c.chapterId),
		removedChapterIds: before.filter((c) => !now.has(c.chapterId)).map((c) => c.chapterId),
		wordsAdded: [...newIds].filter((id) => !oldIds.has(id)).length,
		wordsRemoved: [...oldIds].filter((id) => !newIds.has(id)).length
	};
}

/** Why a Revision can't be published yet; empty when it can (P1-STU-02 acceptance). */
export function publishProblems(revision: {
	state: string;
	aiUse: AiUse | null | undefined;
}): string[] {
	const problems: string[] = [];
	if (revision.state !== 'ready') problems.push('Only a processed version can be published.');
	if (!revision.aiUse) problems.push('Answer “Was AI used to make this?” first.');
	return problems;
}

/** Why a pack or track can't be listed yet; empty when it can (P1-LAY-05 acceptance, §10.6). */
export function layerPublishProblems(layer: {
	aiUse: AiUse | null;
	items: number;
	missingAlt?: number;
	itemName: { one: string; many: string };
}): string[] {
	const problems: string[] = [];
	if (!layer.aiUse) problems.push('Answer “Was AI used to make this?” first.');
	if (layer.items === 0) problems.push(`Add at least one ${layer.itemName.one} first.`);
	const missing = layer.missingAlt ?? 0;
	if (missing > 0) {
		problems.push(
			`${missing} ${missing === 1 ? layer.itemName.one + ' needs' : layer.itemName.many + ' need'} alt text, so readers using a screen reader know what ${missing === 1 ? 'it shows' : 'they show'}.`
		);
	}
	return problems;
}

/** A store address from a title, unique among `taken`: "My Book", "my-book-2", … */
export function slugFor(title: string, taken: (slug: string) => boolean): string {
	const base =
		title
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/['’]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60)
			.replace(/-+$/, '') || 'book';
	if (!taken(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`;
		if (!taken(candidate)) return candidate;
	}
}

/** SIMULATION (OPEN-10): a serial's early-access window after each publish. */
export const EARLY_ACCESS_DAYS = 30;

export function earlyAccessFreeAt(publishedAt: string, days = EARLY_ACCESS_DAYS): string {
	return new Date(Date.parse(publishedAt) + days * 24 * 60 * 60 * 1000).toISOString();
}
