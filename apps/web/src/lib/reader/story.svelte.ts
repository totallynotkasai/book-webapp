/**
 * The story so far in the reader (P1-RDR-13, DESIGN.md §4.9): a catalogue Book's published
 * recaps and glossary, fetched once as the Book opens, so the sheet still works if the reader goes
 * offline later. What shows is decided on the device from how far they've read (`storySoFarAt`
 * in `@book/domain`, Invariant 6), so it follows them page by page without asking again.
 */
import type { Backend, StorySoFarDto } from '@book/core';
import { describeError, type DescribedError } from '$lib/errors';

export class BookStory {
	/** Null when the Book's author hasn't published one. */
	story = $state.raw<StorySoFarDto | null>(null);
	status = $state<'loading' | 'ready' | 'error'>('loading');
	error = $state.raw<DescribedError | null>(null);

	readonly #backend: Backend;
	readonly #bookId: string;

	constructor(backend: Backend, bookId: string) {
		this.#backend = backend;
		this.#bookId = bookId;
	}

	load = async (): Promise<void> => {
		this.status = 'loading';
		this.error = null;
		try {
			this.story = await this.#backend.content.storySoFar(this.#bookId);
			this.status = 'ready';
		} catch (error) {
			this.error = describeError(error);
			this.status = 'error';
		}
	};
}

/** How long away from a Book before opening it offers the story so far (owner decision). */
export const STORY_NUDGE_DAYS = 7;

/** Whether the reader last read this Book long enough ago to be offered a catch-up. */
export function storyNudgeDue(lastReadAt: string | undefined, now: number): boolean {
	if (!lastReadAt) return false;
	const then = Date.parse(lastReadAt);
	return Number.isFinite(then) && now - then >= STORY_NUDGE_DAYS * 24 * 60 * 60 * 1000;
}
