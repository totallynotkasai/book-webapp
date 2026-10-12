/**
 * Reading Progress (P1-RDR-05, §9.5): saved on every relocation, debounced to 2 s, and at once when
 * the app is backgrounded or closed. The furthest position only ever moves forward.
 */
import type { PointAnchor, ReadingProgress, Stores } from '@book/core';
import type { VisibleRange } from '@book/reader-core';

export const PROGRESS_DEBOUNCE_MS = 2000;

/** Saves still being written, so a screen that shows progress can wait for them. */
const writing = new Set<Promise<void>>();

/** Resolves once every progress save started so far has been written. */
export async function progressSaved(): Promise<void> {
	await Promise.allSettled([...writing]);
}

export class ProgressSaver {
	#stores: Stores;
	#bookId: string;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#pending: VisibleRange | null = null;
	#furthest: { anchor: PointAnchor; progression: number } | null;
	#onHide = () => {
		if (document.visibilityState === 'hidden') void this.flush();
	};

	constructor(stores: Stores, bookId: string, existing: ReadingProgress | undefined) {
		this.#stores = stores;
		this.#bookId = bookId;
		this.#furthest = existing
			? { anchor: existing.furthest, progression: existing.furthestProgression }
			: null;
		document.addEventListener('visibilitychange', this.#onHide);
		addEventListener('pagehide', this.#onHide);
	}

	/** Call on every `relocated`. */
	record(range: VisibleRange) {
		this.#pending = range;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.flush(), PROGRESS_DEBOUNCE_MS);
	}

	async flush(): Promise<void> {
		clearTimeout(this.#timer);
		const range = this.#pending;
		if (!range) return;
		this.#pending = null;
		const furthest = this.#furthest;
		// The furthest position only moves forward, and only compares within one Revision.
		const ahead =
			!furthest ||
			furthest.anchor.revisionId !== range.first.revisionId ||
			range.first.ordinal > furthest.anchor.ordinal;
		if (ahead) this.#furthest = { anchor: range.first, progression: range.progression };
		const write = this.#stores.progress
			.save({
				bookId: this.#bookId,
				current: range.first,
				progression: range.progression,
				furthest: this.#furthest!.anchor,
				furthestProgression: this.#furthest!.progression
			})
			.then(() => undefined);
		writing.add(write);
		try {
			await write;
		} finally {
			writing.delete(write);
		}
	}

	async close() {
		document.removeEventListener('visibilitychange', this.#onHide);
		removeEventListener('pagehide', this.#onHide);
		await this.flush();
	}
}
