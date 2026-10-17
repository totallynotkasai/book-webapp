/**
 * The input and output schema of every Backend method. Implementations validate against this
 * (`backend-local` in dev builds and tests; `backend-http` on every response), so drift from the
 * contract shows up immediately. Adding a method to `Backend` means adding it here too: the
 * `satisfies` clause makes TypeScript insist.
 */
import { z } from 'zod';
import type { Backend } from './backend';
import {
	bookSummarySchema,
	creatorSchema,
	flagSchema,
	libraryEntrySchema,
	openBookSchema,
	personaSchema,
	sessionSchema
} from './dto';
import { layerSummarySchema, openPackSchema, openTrackSchema } from '../layers';
import {
	bookmarkDesignSchema,
	bookPageSchema,
	narrationSampleSchema,
	orderSchema,
	planSchema,
	previewsSchema,
	shelfSchema,
	subscriptionSchema,
	tipInputSchema,
	tipSchema
} from '../store';
import {
	bookSettingsInputSchema,
	chapterNarrationInputSchema,
	chapterReviewSchema,
	earningsSchema,
	illustrationChangesSchema,
	illustrationInputSchema,
	layerDetailsInputSchema,
	migrateAnchorsInputSchema,
	migrateAnchorsResultSchema,
	planInputSchema,
	publishRevisionInputSchema,
	scheduleChapterInputSchema,
	studioBookDetailSchema,
	studioBookSchema,
	studioPackSchema,
	studioRevisionSchema,
	studioTrackSchema,
	trackDetailsInputSchema
} from '../studio';
import {
	actInputSchema,
	communityHubSchema,
	creatorProfileSchema,
	curationSchema,
	flagDetailSchema,
	inboxMessageSchema,
	moderationActionLogSchema,
	reportInputSchema,
	studioLayerSchema
} from '../community';
import {
	glossaryEntryInputSchema,
	publishStoryInputSchema,
	recapInputSchema,
	storySoFarSchema,
	studioStorySchema
} from '../story';
import { pageRequestSchema, pageSchema } from './paging';

const optionalPage = z.tuple([pageRequestSchema.optional()]);
const none = z.tuple([]);
const slug = z.tuple([z.string().min(1)]);
const idempotent = z.tuple([z.string().min(1), z.string().min(8)]);
const id = z.string().min(1);

export interface MethodContract {
	input: z.ZodTuple;
	output: z.ZodType;
}

type ApiModules = Omit<Backend, 'events'>;

export const backendContract = {
	session: {
		current: { input: none, output: sessionSchema },
		listPersonas: { input: none, output: z.array(personaSchema) },
		signInAs: { input: slug, output: sessionSchema }
	},
	catalogue: {
		listBooks: { input: optionalPage, output: pageSchema(bookSummarySchema) },
		listShelves: { input: none, output: z.array(shelfSchema) },
		search: {
			input: z.tuple([z.string().max(200), pageRequestSchema.optional()]),
			output: pageSchema(bookSummarySchema)
		},
		getBook: { input: slug, output: bookPageSchema },
		getCreator: { input: slug, output: creatorSchema },
		listCreatorBooks: {
			input: z.tuple([z.string().min(1), pageRequestSchema.optional()]),
			output: pageSchema(bookSummarySchema)
		},
		listBookmarkDesigns: { input: none, output: z.array(bookmarkDesignSchema) }
	},
	library: {
		list: { input: optionalPage, output: pageSchema(libraryEntrySchema) }
	},
	checkout: {
		claim: { input: slug, output: orderSchema },
		purchase: { input: idempotent, output: orderSchema },
		listOrders: { input: optionalPage, output: pageSchema(orderSchema) }
	},
	support: {
		listPlans: { input: slug, output: z.array(planSchema) },
		subscribe: { input: idempotent, output: subscriptionSchema },
		cancel: { input: slug, output: subscriptionSchema },
		listSubscriptions: { input: none, output: z.array(subscriptionSchema) },
		tip: { input: z.tuple([tipInputSchema]), output: tipSchema },
		listTips: { input: none, output: z.array(tipSchema) }
	},
	content: {
		open: {
			input: z.tuple([z.string().min(1), z.object({ sample: z.boolean().optional() }).optional()]),
			output: openBookSchema
		},
		read: {
			input: z.tuple([z.string().min(1), z.string().min(1)]),
			output: z.instanceof(Blob)
		},
		migrateAnchors: {
			input: z.tuple([id, migrateAnchorsInputSchema]),
			output: migrateAnchorsResultSchema
		},
		storySoFar: { input: slug, output: storySoFarSchema.nullable() }
	},
	layers: {
		list: { input: slug, output: z.array(layerSummarySchema) },
		openPack: { input: slug, output: openPackSchema },
		openTrack: { input: slug, output: openTrackSchema },
		previews: { input: slug, output: previewsSchema },
		narrationSample: { input: slug, output: narrationSampleSchema.nullable() }
	},
	studio: {
		listBooks: { input: optionalPage, output: pageSchema(studioBookSchema) },
		getBook: { input: slug, output: studioBookDetailSchema },
		upload: {
			input: z.tuple([z.instanceof(Blob), z.object({ bookId: id.optional() }).optional()]),
			output: studioRevisionSchema
		},
		updateBook: { input: z.tuple([id, bookSettingsInputSchema]), output: studioBookDetailSchema },
		publishRevision: {
			input: z.tuple([id, publishRevisionInputSchema]),
			output: studioBookDetailSchema
		},
		scheduleChapter: {
			input: z.tuple([id, scheduleChapterInputSchema]),
			output: studioBookDetailSchema
		},
		previewRevision: { input: z.tuple([id, id.optional()]), output: openBookSchema },
		createPack: { input: z.tuple([id, layerDetailsInputSchema]), output: studioPackSchema },
		getPack: { input: slug, output: studioPackSchema },
		updatePack: { input: z.tuple([id, layerDetailsInputSchema]), output: studioPackSchema },
		addIllustration: { input: z.tuple([id, illustrationInputSchema]), output: studioPackSchema },
		updateIllustration: {
			input: z.tuple([id, id, illustrationChangesSchema]),
			output: studioPackSchema
		},
		removeIllustration: { input: z.tuple([id, id]), output: studioPackSchema },
		publishPack: { input: slug, output: studioPackSchema },
		createTrack: { input: z.tuple([id, trackDetailsInputSchema]), output: studioTrackSchema },
		getTrack: { input: slug, output: studioTrackSchema },
		updateTrack: { input: z.tuple([id, trackDetailsInputSchema]), output: studioTrackSchema },
		setChapterNarration: {
			input: z.tuple([id, chapterNarrationInputSchema]),
			output: studioTrackSchema
		},
		reviewChapter: { input: z.tuple([id, id]), output: chapterReviewSchema },
		markReviewed: {
			input: z.tuple([id, id, z.number().int().nonnegative(), z.boolean()]),
			output: chapterReviewSchema
		},
		publishTrack: { input: slug, output: studioTrackSchema },
		listPlans: { input: none, output: z.array(planSchema) },
		savePlan: { input: z.tuple([id.nullable(), planInputSchema]), output: planSchema },
		earnings: { input: none, output: earningsSchema },
		listLayers: { input: none, output: z.array(studioLayerSchema) },
		curation: { input: slug, output: curationSchema },
		decide: {
			input: z.tuple([id, z.enum(['approve', 'decline']), z.string().trim().max(1000)]),
			output: curationSchema
		},
		endorse: { input: z.tuple([id, z.boolean()]), output: curationSchema },
		setCommunityListing: { input: z.tuple([id, z.boolean()]), output: curationSchema },
		getStory: { input: slug, output: studioStorySchema },
		saveRecap: { input: z.tuple([id, recapInputSchema]), output: studioStorySchema },
		saveGlossaryEntry: {
			input: z.tuple([id, id.nullable(), glossaryEntryInputSchema]),
			output: studioStorySchema
		},
		removeGlossaryEntry: { input: z.tuple([id, id]), output: studioStorySchema },
		publishStory: { input: z.tuple([id, publishStoryInputSchema]), output: studioStorySchema }
	},
	community: {
		hub: { input: slug, output: communityHubSchema },
		rate: {
			input: z.tuple([id, z.number().int().min(1).max(5)]),
			output: layerSummarySchema
		},
		profile: { input: slug, output: creatorProfileSchema },
		follow: { input: z.tuple([id, z.boolean()]), output: creatorProfileSchema },
		report: { input: z.tuple([reportInputSchema]), output: z.undefined() }
	},
	inbox: {
		list: { input: none, output: z.array(inboxMessageSchema) },
		markRead: { input: slug, output: z.undefined() }
	},
	moderation: {
		listQueue: { input: optionalPage, output: pageSchema(flagSchema) },
		getFlag: { input: slug, output: flagDetailSchema },
		act: { input: z.tuple([id, actInputSchema]), output: flagDetailSchema },
		listActions: { input: optionalPage, output: pageSchema(moderationActionLogSchema) }
	}
} satisfies {
	[M in keyof ApiModules]: { [K in keyof ApiModules[M]]: MethodContract };
};

export type BackendModuleName = keyof typeof backendContract;
