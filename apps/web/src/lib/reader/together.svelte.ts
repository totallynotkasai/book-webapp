/**
 * Other readers, in a catalogue Book (P1-COM-03, P1-COM-04; DESIGN.md §4.8): the comments of each
 * Chapter the reader reaches and the Book's popular highlights, fetched only while the reader has
 * them on for this Book (D-044), and again when comments change (`comments` topic). Nothing here
 * is needed to read: offline, the reader simply shows none, and says why when asked.
 */
import type {
	Backend,
	ChapterCommentsDto,
	CommentDto,
	CommentInput,
	PopularHighlightsDto,
	ReplyInput
} from '@book/core';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { describeError, type DescribedError } from '$lib/errors';

export class BookTogether {
	/** Each Chapter's comments as last fetched, by `chapterId`. */
	readonly chapters = new SvelteMap<string, ChapterCommentsDto>();
	/** Chapters whose comments couldn't be fetched, and why. */
	readonly errors = new SvelteMap<string, DescribedError>();
	popular = $state.raw<PopularHighlightsDto | null>(null);
	popularError = $state.raw<DescribedError | null>(null);

	readonly #backend: Backend;
	readonly #bookId: string;
	#off: (() => void) | undefined;
	/** Chapters asked for, so a change refreshes them all. */
	readonly #wanted = new SvelteSet<string>();
	#wantPopular = false;

	constructor(backend: Backend, bookId: string) {
		this.#backend = backend;
		this.#bookId = bookId;
		this.#off = backend.events.on('comments', () => void this.refresh());
	}

	/** Whether the author lets readers comment: from any Chapter fetched; undefined until then. */
	get allowed(): boolean | undefined {
		for (const chapter of this.chapters.values()) return chapter.allowed;
		return undefined;
	}

	/** Whether this reader can write (they own the Book, and the author allows it). */
	get canComment(): boolean {
		for (const chapter of this.chapters.values()) return chapter.canComment;
		return false;
	}

	/** A Chapter's comments, fetched once unless `again`. */
	async loadChapter(chapterId: string, again = false): Promise<void> {
		this.#wanted.add(chapterId);
		if (!again && this.chapters.has(chapterId)) return;
		try {
			const chapter = await this.#backend.comments.list(this.#bookId, chapterId);
			this.chapters.set(chapterId, chapter);
			this.errors.delete(chapterId);
		} catch (error) {
			this.errors.set(chapterId, describeError(error));
		}
	}

	async loadPopular(again = false): Promise<void> {
		this.#wantPopular = true;
		if (!again && this.popular) return;
		try {
			this.popular = await this.#backend.highlights.popular(this.#bookId);
			this.popularError = null;
		} catch (error) {
			this.popularError = describeError(error);
		}
	}

	/** Fetches again whatever has been asked for. */
	async refresh(): Promise<void> {
		await Promise.all([
			...[...this.#wanted].map((id) => this.loadChapter(id, true)),
			this.#wantPopular ? this.loadPopular(true) : undefined
		]);
	}

	/** Rejects with the backend's error, for the sheet to show. */
	async add(input: CommentInput): Promise<CommentDto> {
		const comment = await this.#backend.comments.add(this.#bookId, input);
		await this.loadChapter(comment.chapterId, true);
		return comment;
	}

	async reply(commentId: string, input: ReplyInput): Promise<CommentDto> {
		const comment = await this.#backend.comments.reply(commentId, input);
		await this.loadChapter(comment.chapterId, true);
		return comment;
	}

	async remove(commentId: string, chapterId: string): Promise<void> {
		await this.#backend.comments.remove(commentId);
		await this.loadChapter(chapterId, true);
	}

	destroy(): void {
		this.#off?.();
		this.#off = undefined;
	}
}
