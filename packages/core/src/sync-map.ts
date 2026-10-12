/**
 * Sync Maps (docs/DESIGN.md §2, §7.2): per-Chapter timings that link a narration Audio Track to
 * Words. Written once per Revision by `@book/alignment`, read by the narration player (§8.3).
 * Words are referenced by WordId only (Invariant 2); the list is in audio order, not WordId order.
 */
import { z } from 'zod';
import type { WordId } from './anchor';

/** `flags & 1`: the Word wasn't heard in the transcript; its times are interpolated. */
export const SYNC_MAP_INTERPOLATED = 1;

export const SYNC_MAP_VERSION = 1;

const ms = z.number().int().nonnegative();

export const syncMapWordSchema = z
	.tuple([z.number().int().positive(), ms, ms, z.number().int().nonnegative()])
	.refine(([, start, end]) => end >= start, { message: 'endMs must not be before startMs' });
/** `[wordId, startMs, endMs, flags]`. */
export type SyncMapWord = [wordId: WordId, startMs: number, endMs: number, flags: number];

export const syncMapSchema = z
	.object({
		version: z.literal(SYNC_MAP_VERSION),
		trackId: z.string().min(1),
		revisionId: z.string().min(1),
		chapterId: z.string().min(1),
		/** Object-storage key of the Chapter's `.m4a` (§6.7). */
		audioKey: z.string().min(1),
		durationMs: ms,
		/** Matched Words / all Words in the Chapter (§7.2 step 6). */
		coverage: z.number().min(0).max(1),
		words: z.array(syncMapWordSchema)
	})
	.refine((map) => map.words.every((w, i) => i === 0 || w[1] >= map.words[i - 1]![1]), {
		message: 'words must be sorted by startMs',
		path: ['words']
	})
	.refine((map) => new Set(map.words.map((w) => w[0])).size === map.words.length, {
		message: 'each WordId appears once',
		path: ['words']
	});

export type SyncMap = Omit<z.infer<typeof syncMapSchema>, 'words'> & { words: SyncMapWord[] };

/** Parses untrusted JSON into a Sync Map, throwing a ZodError if it doesn't match §7.2. */
export function parseSyncMap(json: unknown): SyncMap {
	return syncMapSchema.parse(json) as SyncMap;
}

export function isInterpolated(word: SyncMapWord): boolean {
	return (word[3] & SYNC_MAP_INTERPOLATED) !== 0;
}
