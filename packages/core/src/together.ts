/**
 * Readers together (P1-COM-03, P1-COM-04; DESIGN.md §4.8; simulated until Phase 6): paragraph
 * comments and popular highlights, both off until a reader turns them on for a Book (D-044).
 *
 * A comment is on a passage: a RangeAnchor on the Book's current Revision (Invariant 2), so it
 * moves with the text when the author publishes a new one (§6.2). The reader sees comments grouped
 * by the paragraph the passage starts in, behind a count. Popular highlights are passages that at
 * least a minimum number of other readers highlighted, with how many, and never who.
 */
import { z } from 'zod';
import { rangeAnchorSchema } from './layers';

const id = z.string().min(1);
const timestamp = z.iso.datetime();

/** The most a comment or reply can say. */
export const COMMENT_MAX_LENGTH = 2000;

const commentText = z.string().trim().min(1).max(COMMENT_MAX_LENGTH);

/** A new comment on a passage. */
export const commentInputSchema = z.object({
	/** The passage: a selection, or a whole paragraph, on the Book's current Revision. */
	anchor: rangeAnchorSchema,
	text: commentText,
	/** It gives away what's later in the story: other readers see it only when they choose to (D-044). */
	spoilers: z.boolean()
});
export type CommentInput = z.input<typeof commentInputSchema>;

export const replyInputSchema = z.object({ text: commentText, spoilers: z.boolean() });
export type ReplyInput = z.input<typeof replyInputSchema>;

const commentFields = {
	id,
	/** Who wrote it; empty once its writer deleted a comment that has replies. */
	authorName: z.string(),
	/** Written by the Book's author. */
	byAuthor: z.boolean(),
	/** Written by the signed-in reader. */
	mine: z.boolean(),
	text: z.string(),
	spoilers: z.boolean(),
	createdAt: timestamp,
	/** A moderator hid it after a report: only its writer still sees it (§10.6). */
	hidden: z.boolean()
};

export const commentReplySchema = z.object(commentFields);
export type CommentReplyDto = z.infer<typeof commentReplySchema>;

/** A comment on a passage, with its replies, oldest first. */
export const commentSchema = z.object({
	...commentFields,
	bookId: id,
	/** On the Revision `comments.list` names: the Book's current one. */
	anchor: rangeAnchorSchema,
	chapterId: id,
	/** Its writer deleted it, but it has replies: shown as "Comment deleted", with them. */
	deleted: z.boolean(),
	replies: z.array(commentReplySchema)
});
export type CommentDto = z.infer<typeof commentSchema>;

/** A Chapter's comments, in reading order (by where their passage starts, then oldest first). */
export const chapterCommentsSchema = z.object({
	bookId: id,
	revisionId: id,
	chapterId: id,
	/** The author lets readers comment on this Book (D-044); when they don't, `comments` is empty. */
	allowed: z.boolean(),
	/** The reader owns the Book, so they can comment and reply (D-044). */
	canComment: z.boolean(),
	comments: z.array(commentSchema)
});
export type ChapterCommentsDto = z.infer<typeof chapterCommentsSchema>;

/** A passage other readers highlighted, and how many of them: never who (P1-COM-04). */
export const popularHighlightSchema = z.object({
	anchor: rangeAnchorSchema,
	chapterId: id,
	readers: z.number().int().positive()
});
export type PopularHighlightDto = z.infer<typeof popularHighlightSchema>;

/** A Book's popular highlights on its current Revision, in reading order. */
export const popularHighlightsSchema = z.object({
	bookId: id,
	revisionId: id,
	/** The fewest readers a passage needs before it's shown. */
	minReaders: z.number().int().positive(),
	passages: z.array(popularHighlightSchema)
});
export type PopularHighlightsDto = z.infer<typeof popularHighlightsSchema>;
