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
	sessionSchema,
	studioBookSchema
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
import { pageRequestSchema, pageSchema } from './paging';

const optionalPage = z.tuple([pageRequestSchema.optional()]);
const none = z.tuple([]);
const slug = z.tuple([z.string().min(1)]);
const idempotent = z.tuple([z.string().min(1), z.string().min(8)]);

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
		}
	},
	layers: {
		list: { input: slug, output: z.array(layerSummarySchema) },
		openPack: { input: slug, output: openPackSchema },
		openTrack: { input: slug, output: openTrackSchema },
		previews: { input: slug, output: previewsSchema },
		narrationSample: { input: slug, output: narrationSampleSchema.nullable() }
	},
	studio: {
		listBooks: { input: optionalPage, output: pageSchema(studioBookSchema) }
	},
	moderation: {
		listQueue: { input: optionalPage, output: pageSchema(flagSchema) }
	}
} satisfies {
	[M in keyof ApiModules]: { [K in keyof ApiModules[M]]: MethodContract };
};

export type BackendModuleName = keyof typeof backendContract;
