/**
 * Plain-language Studio summaries (DESIGN.md §11.6): what a new version changes, what a report
 * found, and what to do next.
 */
import type {
	IngestReport,
	StudioBookDetailDto,
	StudioBookDto,
	StudioRevisionDto
} from '@book/core';

const count = (n: number, one: string, many = `${one}s`) =>
	`${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "1 chapter changed, 1 added. Narration for “Chapter 2” will need re-aligning." */
export function changeSummary(revision: StudioRevisionDto, book: StudioBookDetailDto): string {
	const changes = revision.changes;
	if (!changes)
		return 'This is the book’s first version. Readers can find it in the store once it’s published.';
	const parts = [
		changes.changedChapterIds.length &&
			`${count(changes.changedChapterIds.length, 'chapter')} changed`,
		changes.addedChapterIds.length && `${count(changes.addedChapterIds.length, 'chapter')} added`,
		changes.removedChapterIds.length &&
			`${count(changes.removedChapterIds.length, 'chapter')} removed`
	].filter(Boolean);
	const what = parts.length ? `${parts.join(', ')}.` : 'No words changed.';
	const titleOf = (chapterId: string) =>
		book.revisions.flatMap((r) => r.chapters).find((c) => c.chapterId === chapterId)?.title ||
		'a chapter';
	const stale = [...new Set(changes.staleNarration.map((s) => titleOf(s.chapterId)))];
	const narration = stale.length
		? ` Narration for ${stale.map((t) => `“${t}”`).join(', ')} will need re-aligning.`
		: '';
	return `${what}${narration} Readers’ notes and bookmarks move with the text.`;
}

/** "6 chapters, 12,400 words, 2 pictures." */
export function reportLine(report: IngestReport): string {
	return [
		count(report.chapterCount, 'chapter'),
		count(report.wordCount, 'word'),
		report.imageCount ? count(report.imageCount, 'picture') : null
	]
		.filter(Boolean)
		.join(', ');
}

export const revisionStateLabels: Record<StudioRevisionDto['state'], string> = {
	processing: 'Processing…',
	ready: 'Ready to publish',
	failed: 'Couldn’t be processed',
	published: 'Published',
	superseded: 'Earlier version'
};

/** A Book's state in the Studio list. */
export function bookStateLabel(book: StudioBookDto): string {
	if (book.pendingRevision === 'processing') return 'Processing…';
	if (book.pendingRevision === 'failed') return 'Upload failed';
	if (book.pendingRevision === 'ready') {
		return book.listingState === 'draft' ? 'Ready to publish' : 'New version ready';
	}
	return book.listingState === 'listed'
		? 'Published'
		: book.listingState === 'delisted'
			? 'Delisted'
			: 'Draft';
}
