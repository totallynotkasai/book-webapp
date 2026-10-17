/**
 * The story so far (DESIGN.md §4.9, §7.4 without the AI drafts; P1-STU-05, P1-RDR-13): an author's
 * recap of each Chapter and a glossary of characters, places and things, written in the Studio
 * and published to readers, who see only what's at or before where they've reached (Invariant 6).
 *
 * A glossary entry has a name and, optionally, other names it's also called. Each name's first
 * appearance is found in the text and kept as a RangeAnchor on the Words of that occurrence; a
 * name the reader hasn't reached stays hidden, so a later alias can't give anything away.
 */
import { z } from 'zod';
import { aiUseSchema } from './backend/dto';
import { illustrationImageSchema, rangeAnchorSchema } from './layers';
import { imageUploadSchema } from './studio';

const id = z.string().min(1);
const int = z.number().int();
const timestamp = z.iso.datetime();

/** At most this many other names per glossary entry. */
export const MAX_GLOSSARY_ALIASES = 10;

/** A glossary entry's picture, as readers and the Studio show it. */
export const glossaryPictureSchema = z.object({
	/** Resolved by the app like a cover. Phase 2: a URL from object storage (§6.7). */
	url: z.string().min(1),
	alt: z.string().min(1),
	width: int.positive(),
	height: int.positive(),
	dominant: illustrationImageSchema.shape.dominant
});
export type GlossaryPictureDto = z.infer<typeof glossaryPictureSchema>;

// ---- What readers get (P1-RDR-13) ----

/** One name of a glossary entry and the Words where it first appears. */
export const glossaryNameSchema = z.object({
	name: z.string().min(1),
	firstAppearance: rangeAnchorSchema
});
export type GlossaryNameDto = z.infer<typeof glossaryNameSchema>;

export const storyGlossaryEntrySchema = z.object({
	id,
	/** Its own name first, then what it's also called: only names that are in the text. */
	names: z.array(glossaryNameSchema).min(1),
	description: z.string().min(1),
	picture: glossaryPictureSchema.nullable()
});
export type StoryGlossaryEntryDto = z.infer<typeof storyGlossaryEntrySchema>;

/**
 * A Book's published story so far, on its current Revision, for the reader to filter by how far
 * they've read (`storySoFarAt` in `@book/domain`). Only Chapters this reader can open are in it:
 * a sample's recaps stop where the sample does, and an entry first met in a locked Chapter is
 * left out.
 */
export const storySoFarSchema = z.object({
	bookId: id,
	/** The Revision its Anchors are on: the one `content.open` gives. */
	revisionId: id,
	/** "Was AI used to write these?" (§10.6), shown with them. */
	aiUse: aiUseSchema,
	publishedAt: timestamp,
	/** In reading order. */
	recaps: z.array(z.object({ chapterId: id, text: z.string().min(1) })),
	glossary: z.array(storyGlossaryEntrySchema)
});
export type StorySoFarDto = z.infer<typeof storySoFarSchema>;

// ---- The Studio (P1-STU-05) ----

/** A Chapter's recap as the author is writing it. */
export const studioRecapSchema = z.object({
	chapterId: id,
	title: z.string(),
	wordCount: int.nonnegative(),
	/** Empty while it has none. */
	text: z.string(),
	/** The Chapter's text changed in a newer version since this recap was saved. */
	changed: z.boolean()
});
export type StudioRecapDto = z.infer<typeof studioRecapSchema>;

/** One name of an entry being written, and where it first appears (or that it doesn't). */
export const studioGlossaryNameSchema = z.object({
	name: z.string().min(1),
	/** Null when the name isn't in the text. */
	firstAppearance: rangeAnchorSchema.nullable(),
	chapterId: id.nullable(),
	chapterTitle: z.string().nullable(),
	/** The Words around it, so the author can see it's the right place. */
	context: z.string()
});
export type StudioGlossaryNameDto = z.infer<typeof studioGlossaryNameSchema>;

export const studioGlossaryEntrySchema = z.object({
	id,
	name: z.string().min(1),
	aliases: z.array(z.string().min(1)),
	description: z.string(),
	picture: glossaryPictureSchema.nullable(),
	/** The name, then each alias, in that order. */
	names: z.array(studioGlossaryNameSchema).min(1)
});
export type StudioGlossaryEntryDto = z.infer<typeof studioGlossaryEntrySchema>;

export const studioStorySchema = z.object({
	bookId: id,
	/** The Revision the Chapters and first appearances are from: the one readers have. */
	revisionId: id,
	/** One per Chapter with Words, in reading order. */
	recaps: z.array(studioRecapSchema),
	/** In order of first appearance; entries not in the text last. */
	glossary: z.array(studioGlossaryEntrySchema),
	/** The answer published with it, or the last one given. */
	aiUse: aiUseSchema.nullable(),
	/** When readers last got it; null while they have none. */
	publishedAt: timestamp.nullable(),
	/** The draft differs from what readers have. */
	unpublishedChanges: z.boolean(),
	/** What stops it being published, in words the author can act on (the AI answer aside). */
	problems: z.array(z.string())
});
export type StudioStoryDto = z.infer<typeof studioStorySchema>;

const name = z.string().trim().min(1).max(80);

export const glossaryEntryInputSchema = z.object({
	name,
	aliases: z.array(name).max(MAX_GLOSSARY_ALIASES),
	description: z.string().trim().min(1).max(1000),
	/** A new picture (prepared on the device, §7.3), null to remove it, or absent to keep it. */
	picture: imageUploadSchema.nullable().optional(),
	/** The picture's text alternative (§11.7): needed whenever the entry has a picture. */
	pictureAlt: z.string().trim().max(300).optional()
});
export type GlossaryEntryInput = z.input<typeof glossaryEntryInputSchema>;

export const recapInputSchema = z.object({
	chapterId: id,
	/** Empty removes it. */
	text: z.string().trim().max(2000)
});
export type RecapInput = z.input<typeof recapInputSchema>;

export const publishStoryInputSchema = z.object({
	/** Required, as for every publish (§10.6). */
	aiUse: aiUseSchema
});
export type PublishStoryInput = z.infer<typeof publishStoryInputSchema>;
