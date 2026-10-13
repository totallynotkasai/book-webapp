/**
 * Moving a reader's own records to a Book's new Revision (DESIGN.md §6.2): Annotations, Placed
 * Bookmarks and Reading Progress. Imports migrate in the import worker (P1-ING-03); catalogue
 * Books migrate through `Backend.content.migrateAnchors` when the reader next opens them after
 * their author publishes a new Revision (P1-STU-01). Either way the results are written here.
 * Orphaned records keep their old Anchor so the reader can still see what they said.
 */
import type { Anchor, AnchorStatus, Backend, PointAnchor, Stores } from '@book/core';

export interface Migrated<A extends Anchor> {
	anchor: A;
	status: AnchorStatus;
}

export interface MigrationSummary {
	moved: number;
	orphaned: number;
}

/** The records on one Revision, in the order their Anchors were sent to be migrated. */
export interface Attached {
	bookId: string;
	annotationIds: string[];
	bookmarkIds: string[];
	/** Reading Progress was sent too (current, then furthest). */
	progress: boolean;
}

/** Writes migrated Anchors back; orphaned records keep their old Anchor (§6.2 step 3). */
export async function writeMigration(
	stores: Stores,
	attached: Attached,
	migration: { anchors: Migrated<Anchor>[]; progress: (Migrated<PointAnchor> | null)[] },
	wordCount: number
): Promise<MigrationSummary> {
	let moved = 0;
	let orphaned = 0;
	for (const [k, migrated] of migration.anchors.entries()) {
		const anchorStatus = migrated.status === 'orphaned' ? 'orphaned' : 'migrated';
		if (anchorStatus === 'orphaned') orphaned++;
		else moved++;
		if (k < attached.annotationIds.length) {
			await stores.annotations.update(attached.annotationIds[k]!, {
				anchorStatus,
				...(anchorStatus === 'migrated' && migrated.anchor.kind === 'range'
					? { anchor: migrated.anchor }
					: {})
			});
		} else {
			await stores.placedBookmarks.update(
				attached.bookmarkIds[k - attached.annotationIds.length]!,
				{
					anchorStatus,
					...(anchorStatus === 'migrated' && migrated.anchor.kind === 'point'
						? { anchor: migrated.anchor }
						: {})
				}
			);
		}
	}
	const [current, furthest] = migration.progress;
	if (attached.progress && current && furthest) {
		const total = Math.max(1, wordCount - 1);
		await stores.progress.save({
			bookId: attached.bookId,
			current: current.anchor,
			progression: Math.min(1, current.anchor.ordinal / total),
			furthest: furthest.anchor,
			furthestProgression: Math.min(1, furthest.anchor.ordinal / total)
		});
	}
	return { moved, orphaned };
}

/**
 * A catalogue Book's records still on an older Revision, moved to `revisionId`, the one now
 * open. Usually there's one older Revision; a reader who skipped several has them all moved.
 */
export async function migrateToCurrent(
	stores: Stores,
	backend: Backend,
	bookId: string,
	revisionId: string,
	wordCount: number
): Promise<MigrationSummary> {
	const annotations = (await stores.annotations.list(bookId)).filter(
		(a) => a.anchorStatus !== 'orphaned' && a.anchor.revisionId !== revisionId
	);
	const bookmarks = (await stores.placedBookmarks.list(bookId)).filter(
		(b) => b.anchorStatus !== 'orphaned' && b.anchor.revisionId !== revisionId
	);
	const reading = await stores.progress.get(bookId);
	const from = new Set([
		...annotations.map((a) => a.anchor.revisionId),
		...bookmarks.map((b) => b.anchor.revisionId),
		...(reading && reading.current.revisionId !== revisionId ? [reading.current.revisionId] : [])
	]);
	const total: MigrationSummary = { moved: 0, orphaned: 0 };
	for (const fromRevisionId of from) {
		const on = <T extends { anchor: Anchor }>(records: T[]) =>
			records.filter((r) => r.anchor.revisionId === fromRevisionId);
		const notes = on(annotations);
		const marks = on(bookmarks);
		const progress: PointAnchor[] =
			reading?.current.revisionId === fromRevisionId ? [reading.current, reading.furthest] : [];
		const result = await backend.content.migrateAnchors(bookId, {
			fromRevisionId,
			anchors: [...notes.map((a) => a.anchor), ...marks.map((b) => b.anchor)],
			progress
		});
		const summary = await writeMigration(
			stores,
			{
				bookId,
				annotationIds: notes.map((a) => a.id),
				bookmarkIds: marks.map((b) => b.id),
				progress: progress.length > 0
			},
			result,
			wordCount
		);
		total.moved += summary.moved;
		total.orphaned += summary.orphaned;
	}
	return total;
}

/** What a new version did to the reader's notes, in plain words. */
export function migrationText(migration: MigrationSummary | undefined): string {
	const base = 'This is a new version of a book you already had.';
	if (!migration || migration.moved + migration.orphaned === 0) return base;
	const items = (n: number) => `${n} ${n === 1 ? 'note or bookmark' : 'notes and bookmarks'}`;
	if (migration.orphaned === 0) return `${base} Your ${items(migration.moved)} moved to it.`;
	return `${base} ${items(migration.moved)} moved to it. ${items(migration.orphaned)} couldn’t be placed because their text changed; they’re listed under “Orphaned” in the book’s notes.`;
}
