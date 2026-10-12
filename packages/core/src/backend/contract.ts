/**
 * The input and output schema of every Backend method. Implementations validate against this
 * (`backend-local` in dev builds and tests; `backend-http` on every response), so drift from the
 * contract shows up immediately. Adding a method to `Backend` means adding it here too: the
 * `satisfies` clause makes TypeScript insist.
 */
import { z } from 'zod';
import type { Backend } from './backend';
import {
	bookDetailSchema,
	bookSummarySchema,
	creatorSchema,
	flagSchema,
	libraryEntrySchema,
	personaSchema,
	sessionSchema,
	studioBookSchema
} from './dto';
import { pageRequestSchema, pageSchema } from './paging';

const optionalPage = z.tuple([pageRequestSchema.optional()]);
const none = z.tuple([]);
const slug = z.tuple([z.string().min(1)]);

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
		getBook: { input: slug, output: bookDetailSchema },
		getCreator: { input: slug, output: creatorSchema },
		listCreatorBooks: {
			input: z.tuple([z.string().min(1), pageRequestSchema.optional()]),
			output: pageSchema(bookSummarySchema)
		}
	},
	library: {
		list: { input: optionalPage, output: pageSchema(libraryEntrySchema) }
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
