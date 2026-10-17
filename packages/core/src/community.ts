/**
 * Community and moderation DTOs (DESIGN.md §4.8, §6.6, §10.6; P1-COM-01, P1-COM-02, P1-ADM-01,
 * P1-ADM-02): a Book's community hub, ratings, follows, readers' reports, the admin review
 * queue's Flag detail and actions, the append-only action log, curation for an author's own
 * Books, and the in-app inbox where creators hear the outcome.
 */
import { z } from 'zod';
import {
	aiUseSchema,
	creatorSchema,
	flagRuleSchema,
	flagSchema,
	flagTargetTypeSchema
} from './backend/dto';
import { layerSummarySchema, ratingSummarySchema } from './layers';
import { communityAiSchema, communityPolicySchema, listingStateSchema } from './studio';

const id = z.string().min(1);
const timestamp = z.iso.datetime();

/** A Book's community hub (P1-COM-02): its community Layers, endorsed first, then top-rated. */
export const communityHubSchema = z.object({
	bookId: id,
	bookTitle: z.string(),
	policy: communityPolicySchema,
	communityAi: communityAiSchema,
	/** Whether the signed-in user may make a Layer for this Book, and why not if not. */
	canSubmit: z.boolean(),
	submitBlockedReason: z.string().nullable(),
	layers: z.array(layerSummarySchema)
});
export type CommunityHubDto = z.infer<typeof communityHubSchema>;

/** A Creator's profile (P1-COM-02): who they are, followers, and their portfolio of Layers. */
export const creatorProfileSchema = z.object({
	creator: creatorSchema,
	followers: z.number().int().nonnegative(),
	/** The signed-in user follows them. */
	following: z.boolean(),
	/** Listed Layers they made, for any Book. */
	layers: z.array(layerSummarySchema.and(z.object({ bookTitle: z.string(), bookSlug: z.string() })))
});
export type CreatorProfileDto = z.infer<typeof creatorProfileSchema>;

export const reportReasons = [
	'ai_unlabelled',
	'inappropriate',
	'copyright',
	'spam',
	'other'
] as const;
export const reportReasonSchema = z.enum(reportReasons);
export type ReportReason = z.infer<typeof reportReasonSchema>;

/** A reader's report (§10.6): a reason is required, details explain it. */
export const reportInputSchema = z.object({
	targetType: flagTargetTypeSchema.exclude(['creator']),
	targetId: id,
	reason: reportReasonSchema,
	details: z.string().trim().max(1000)
});
export type ReportInput = z.input<typeof reportInputSchema>;

/** The moderation actions (§10.6), each with a reason. */
export const moderationActions = [
	'approve',
	'require_relabel',
	'hide',
	'remove',
	'warn',
	'suspend'
] as const;
export const moderationActionSchema = z.enum(moderationActions);
export type ModerationAction = z.infer<typeof moderationActionSchema>;

export const actInputSchema = z.object({
	action: moderationActionSchema,
	reason: z.string().trim().min(3).max(1000)
});
export type ActInput = z.input<typeof actInputSchema>;

/** One entry in the append-only `moderation_actions` log (§10.6). */
export const moderationActionLogSchema = z.object({
	id,
	flagId: id.nullable(),
	action: moderationActionSchema,
	reason: z.string(),
	moderatorName: z.string(),
	targetType: flagTargetTypeSchema,
	targetId: id,
	targetTitle: z.string(),
	creatorName: z.string(),
	createdAt: timestamp
});
export type ModerationActionLogDto = z.infer<typeof moderationActionLogSchema>;

/** What a Flag points at, as the moderator sees it. */
export const flagTargetSchema = z.object({
	type: flagTargetTypeSchema,
	id,
	title: z.string(),
	creatorId: id.nullable(),
	creatorName: z.string(),
	/** The content's own AI answer, if it has one. */
	aiUse: aiUseSchema.nullable(),
	state: listingStateSchema.nullable(),
	/** The creator was asked to correct the AI label and hasn't yet. */
	relabelRequired: z.boolean(),
	/** For a Layer: the Book it's for. */
	bookTitle: z.string().nullable()
});

/** The Flag detail screen (§10.6): the content, the rule, the evidence and the creator's history. */
export const flagDetailSchema = z.object({
	flag: flagSchema,
	target: flagTargetSchema,
	/** The stub detector's score (0–1) on unlabelled content: evidence, never a verdict. */
	detectorScore: z.number().min(0).max(1).nullable(),
	reports: z.array(
		z.object({ reason: reportReasonSchema, details: z.string(), createdAt: timestamp })
	),
	/** The creator's other Flags and the actions taken on their content, newest first. */
	history: z.object({
		flags: z.array(flagSchema),
		actions: z.array(moderationActionLogSchema)
	})
});
export type FlagDetailDto = z.infer<typeof flagDetailSchema>;

/**
 * What an inbox message is about, for its link: something a Flag can be about, or a new Chapter
 * of a Book (P1-STU-06), where `id` is the Book's.
 */
export const inboxAboutSchema = z.object({
	type: z.enum([...flagTargetTypeSchema.options, 'chapter']),
	id,
	/** The Chapter, for `chapter`. */
	chapterId: id.optional()
});
export type InboxAboutDto = z.infer<typeof inboxAboutSchema>;

/** A message in a user's in-app inbox (plan §4.7: no email or push in the PoC). */
export const inboxMessageSchema = z.object({
	id,
	title: z.string(),
	body: z.string(),
	createdAt: timestamp,
	read: z.boolean(),
	/** What it's about, for a link. */
	about: inboxAboutSchema.nullable()
});
export type InboxMessageDto = z.infer<typeof inboxMessageSchema>;

/** A community Layer on an author's own Book, as the curation view shows it. */
export const curatedLayerSchema = z.object({
	id,
	kind: z.enum(['illustration_pack', 'audio_track']),
	name: z.string(),
	creatorName: z.string(),
	creatorHandle: z.string(),
	state: listingStateSchema,
	aiUse: aiUseSchema.nullable(),
	endorsed: z.boolean(),
	rating: ratingSummarySchema.nullable(),
	/** Pictures, or narrated Chapters. */
	items: z.number().int().nonnegative()
});
export type CuratedLayerDto = z.infer<typeof curatedLayerSchema>;

/** The author's curation view for one of their Books (§10.6, P1-ADM-02). */
export const curationSchema = z.object({
	bookId: id,
	policy: communityPolicySchema,
	communityAi: communityAiSchema,
	/** Waiting for the author's approval. */
	pending: z.array(curatedLayerSchema),
	/** Listed, delisted by the author, or held for review. */
	layers: z.array(curatedLayerSchema),
	/** Flags and reports on the Book and its Layers. */
	flags: z.array(
		z.object({
			rule: flagRuleSchema,
			targetTitle: z.string(),
			details: z.string(),
			createdAt: timestamp
		})
	)
});
export type CurationDto = z.infer<typeof curationSchema>;

/** One of the signed-in Creator's Layers, on any Book (their community work included). */
export const studioLayerSchema = z.object({
	id,
	kind: z.enum(['illustration_pack', 'audio_track']),
	name: z.string(),
	bookId: id,
	bookTitle: z.string(),
	/** It's for another author's Book. */
	community: z.boolean(),
	state: listingStateSchema,
	relabelRequired: z.boolean()
});
export type StudioLayerDto = z.infer<typeof studioLayerSchema>;
