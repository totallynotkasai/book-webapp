/**
 * `Backend.comments` in the browser (P1-COM-03; plan §6 Phase 1.20; Phase 6 serves it for real):
 * readers' comments on passages, with one level of replies. Anyone who can open a Chapter reads
 * its comments; writing needs the Book, a free one included (Invariant 15 decides), and the
 * author can turn comments off for it (D-044). Comments move to each new Revision as they're read
 * (`placements.ts`). Reports go through `community.report`; a moderator can hide or remove a
 * comment or a reply (§10.6), and a hidden one is seen only by its writer (`commentVisibleTo`).
 */
import {
	BackendError,
	commentInputSchema,
	replyInputSchema,
	type Clock,
	type CommentDto,
	type CommentReplyDto,
	type CommentsApi,
	type UserDto
} from '@book/core';
import { commentOrder, commentVisibleTo, oldestFirst } from '@book/domain';
import { newId } from './checkout';
import type { ContentModule } from './content';
import type { BackendDatabase, CommentRecord, Placement } from './db';
import { chapterAt, type Placements } from './placements';
import type { BookRecord } from './seed';

type Placed = CommentRecord & { place: Placement };

export interface CommentsModule extends CommentsApi {
	/** A comment or reply, for the moderator's Flag detail. */
	get(commentId: string): Promise<CommentRecord | undefined>;
	/** A moderator's decision (§10.6): shown again, hidden, or removed for good. */
	moderate(commentId: string, outcome: 'visible' | 'hidden' | 'removed'): Promise<void>;
}

export function createCommentsApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requireUser: () => UserDto;
	content: Pick<ContentModule, 'reading'>;
	placements: Placements;
	changed: () => void;
}): CommentsModule {
	const { db, clock, placements } = deps;

	const off = () =>
		new BackendError('FORBIDDEN', 'The author has turned comments off for this book.');

	/** A Book's comments and replies, its comments placed on `revisionId` (and saved if moved). */
	function threadsOf(bookId: string, revisionId: string): Promise<CommentRecord[]> {
		return placements.serially(bookId, async () => {
			const all = await db.getAllFromIndex('comments', 'bookId', bookId);
			const comments = all.filter((c): c is Placed => c.parentId === null && c.place !== null);
			const placed = await placements.onRevision(comments, revisionId);
			const moved = placed.filter((c, i) => c !== comments[i]);
			if (moved.length) {
				const tx = db.transaction('comments', 'readwrite');
				for (const c of moved) await tx.store.put(c);
				await tx.done;
			}
			const byId = new Map(placed.map((c) => [c.id, c]));
			return all.map((c) => byId.get(c.id) ?? c);
		});
	}

	/** The Personas who are Creators, by user: a comment by the Book's author says so. */
	async function creatorsByUser(): Promise<Map<string, string | null>> {
		return new Map((await db.getAll('personas')).map((p) => [p.user.id, p.user.creatorId]));
	}

	function replyDto(
		record: CommentRecord,
		userId: string,
		book: BookRecord,
		creators: Map<string, string | null>
	): CommentReplyDto {
		const deleted = record.state === 'deleted';
		return {
			id: record.id,
			authorName: deleted ? '' : record.authorName,
			byAuthor: !deleted && creators.get(record.userId) === book.creatorId,
			mine: !deleted && record.userId === userId,
			text: deleted ? '' : record.text,
			spoilers: deleted ? false : record.spoilers,
			createdAt: record.createdAt,
			hidden: record.state === 'hidden'
		};
	}

	/** A comment with the replies `userId` can see, or null when there's nothing of it to show. */
	function threadDto(
		comment: Placed,
		all: CommentRecord[],
		userId: string,
		book: BookRecord,
		creators: Map<string, string | null>
	): CommentDto | null {
		if (!comment.place.anchor || !commentVisibleTo(comment, userId)) return null;
		const replies = all
			.filter((r) => r.parentId === comment.id && commentVisibleTo(r, userId))
			.sort(oldestFirst);
		// A deleted comment stays only for its replies.
		if (comment.state === 'deleted' && !replies.length) return null;
		return {
			...replyDto(comment, userId, book, creators),
			bookId: comment.bookId,
			anchor: comment.place.anchor,
			chapterId: comment.place.chapterId,
			deleted: comment.state === 'deleted',
			replies: replies.map((r) => replyDto(r, userId, book, creators))
		};
	}

	/** May the signed-in reader write here? Owners only (D-044), while the author allows it. */
	async function mayWrite(bookId: string) {
		const user = deps.requireUser();
		const reading = await deps.content.reading(bookId);
		if (!reading.owns) throw new BackendError('ENTITLEMENT_REQUIRED', 'Get the book to comment.');
		if (!reading.book.readerComments) throw off();
		return { user, ...reading };
	}

	/** The next in the Book's order of writing. */
	async function nextSeq(bookId: string): Promise<number> {
		const all = await db.getAllFromIndex('comments', 'bookId', bookId);
		return all.reduce((most, c) => Math.max(most, c.seq), -1) + 1;
	}

	/** Deletes a record, and a deleted comment left with no replies. */
	async function drop(record: CommentRecord) {
		await db.delete('comments', record.id);
		if (record.parentId === null) {
			// A comment removed for good takes its replies with it.
			for (const reply of await db.getAllFromIndex('comments', 'bookId', record.bookId)) {
				if (reply.parentId === record.id) await db.delete('comments', reply.id);
			}
			return;
		}
		const parent = await db.get('comments', record.parentId);
		if (parent?.state !== 'deleted') return;
		const left = (await db.getAllFromIndex('comments', 'bookId', record.bookId)).some(
			(r) => r.parentId === parent.id
		);
		if (!left) await db.delete('comments', parent.id);
	}

	return {
		async list(bookId, chapterId) {
			const user = deps.requireUser();
			const { book, owns, revisionId, manifest, readable } = await deps.content.reading(bookId);
			if (!manifest.chapters.some((c) => c.chapterId === chapterId)) {
				throw new BackendError('NOT_FOUND', 'That chapter isn’t in this book.');
			}
			if (!readable(chapterId)) {
				throw new BackendError('ENTITLEMENT_REQUIRED', 'That chapter isn’t open to you yet.');
			}
			const base = { bookId, revisionId, chapterId, canComment: owns && book.readerComments };
			if (!book.readerComments) return { ...base, allowed: false, comments: [] };
			const all = await threadsOf(bookId, revisionId);
			const creators = await creatorsByUser();
			const comments = all
				.filter(
					(c): c is Placed =>
						c.parentId === null &&
						c.place?.chapterId === chapterId &&
						c.place.revisionId === revisionId &&
						c.place.status !== 'orphaned'
				)
				.sort((a, b) =>
					commentOrder(
						{ ...a, startOrdinal: a.place.anchor?.startOrdinal ?? 0 },
						{ ...b, startOrdinal: b.place.anchor?.startOrdinal ?? 0 }
					)
				)
				.flatMap((c) => threadDto(c, all, user.id, book, creators) ?? []);
			return { ...base, allowed: true, comments };
		},

		async add(bookId, raw) {
			const { user, book, revisionId, readable } = await mayWrite(bookId);
			const input = commentInputSchema.parse(raw);
			const { anchor } = input;
			if (anchor.bookId !== bookId) {
				throw new BackendError('VALIDATION_FAILED', 'That passage isn’t in this book.');
			}
			if (anchor.revisionId !== revisionId) {
				throw new BackendError(
					'CONFLICT',
					'This book has a new version. Open it again to comment on it.'
				);
			}
			// The passage as the text has it: its Words, its Chapter, and a quote for later Revisions.
			const text = await placements.textOf(revisionId);
			const at = text.words.between(anchor.startOrdinal, anchor.endOrdinal);
			const chapter = chapterAt(text.manifest, anchor.startOrdinal);
			if (
				!at ||
				!chapter ||
				at.anchor.startWordId !== anchor.startWordId ||
				at.anchor.endWordId !== anchor.endWordId
			) {
				throw new BackendError('VALIDATION_FAILED', 'That passage isn’t in this book.');
			}
			if (!readable(chapter.chapterId)) {
				throw new BackendError('ENTITLEMENT_REQUIRED', 'That chapter isn’t open to you yet.');
			}
			const record: Placed = {
				id: newId('comment'),
				bookId,
				parentId: null,
				userId: user.id,
				authorName: user.displayName,
				text: input.text,
				spoilers: input.spoilers,
				state: 'visible',
				createdAt: clock.now().toISOString(),
				seq: await nextSeq(bookId),
				place: {
					revisionId,
					chapterId: chapter.chapterId,
					anchor: at.anchor,
					status: 'ok',
					passage: null
				}
			};
			await db.put('comments', record);
			deps.changed();
			return threadDto(record, [], user.id, book, await creatorsByUser())!;
		},

		async reply(commentId, raw) {
			const found = await db.get('comments', commentId);
			// A reply to a reply joins its comment's thread: replies are one level.
			const parent = found?.parentId ? await db.get('comments', found.parentId) : found;
			if (!parent) throw new BackendError('NOT_FOUND', 'That comment has gone.');
			const { user, book, revisionId, readable } = await mayWrite(parent.bookId);
			const all = await threadsOf(parent.bookId, revisionId);
			const thread = all.find((c): c is Placed => c.id === parent.id && c.place !== null);
			if (
				!thread ||
				thread.place.status === 'orphaned' ||
				!readable(thread.place.chapterId) ||
				!commentVisibleTo(thread, user.id)
			) {
				throw new BackendError('NOT_FOUND', 'That comment has gone.');
			}
			const input = replyInputSchema.parse(raw);
			const record: CommentRecord = {
				id: newId('reply'),
				bookId: thread.bookId,
				parentId: thread.id,
				userId: user.id,
				authorName: user.displayName,
				text: input.text,
				spoilers: input.spoilers,
				state: 'visible',
				createdAt: clock.now().toISOString(),
				seq: await nextSeq(thread.bookId),
				place: null
			};
			await db.put('comments', record);
			deps.changed();
			return threadDto(thread, [...all, record], user.id, book, await creatorsByUser())!;
		},

		async remove(commentId) {
			const user = deps.requireUser();
			const record = await db.get('comments', commentId);
			if (!record || record.state === 'deleted') return;
			if (record.userId !== user.id) {
				throw new BackendError('FORBIDDEN', 'You can delete only your own comments.');
			}
			const replies = (await db.getAllFromIndex('comments', 'bookId', record.bookId)).filter(
				(r) => r.parentId === record.id
			);
			if (record.parentId === null && replies.length) {
				// Its replies stay, under "Comment deleted"; its words go.
				await db.put('comments', { ...record, state: 'deleted', text: '', spoilers: false });
			} else {
				await drop(record);
			}
			deps.changed();
		},

		get: (commentId) => db.get('comments', commentId),

		async moderate(commentId, outcome) {
			const record = await db.get('comments', commentId);
			if (!record) return;
			if (outcome === 'removed') await drop(record);
			else if (record.state !== 'deleted') await db.put('comments', { ...record, state: outcome });
			deps.changed();
		}
	};
}
