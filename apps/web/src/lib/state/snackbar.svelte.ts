/**
 * Snackbars (P1-APP-02): short confirmations and errors, one at a time, in order. An action keeps
 * its name through the flow: "Add to library" confirms with "Added to library" (DESIGN.md §11.6).
 */
import { describeError } from '$lib/errors';

export interface SnackbarAction {
	label: string;
	run: () => void;
}

export interface Snackbar {
	id: number;
	message: string;
	action?: SnackbarAction;
	/** Errors are announced assertively; confirmations politely. */
	tone: 'info' | 'error';
	timeoutMs: number;
}

export interface ShowOptions {
	action?: SnackbarAction;
	tone?: Snackbar['tone'];
	timeoutMs?: number;
}

/** M3: 4 s for a message; longer when there's an action to reach. */
export const SNACKBAR_MS = 4000;
export const SNACKBAR_WITH_ACTION_MS = 8000;

export class Snackbars {
	current = $state<Snackbar | null>(null);
	#queue: Snackbar[] = [];
	#nextId = 1;
	#timer: ReturnType<typeof setTimeout> | undefined;

	show(message: string, options: ShowOptions = {}): number {
		const snackbar: Snackbar = {
			id: this.#nextId++,
			message,
			action: options.action,
			tone: options.tone ?? 'info',
			timeoutMs: options.timeoutMs ?? (options.action ? SNACKBAR_WITH_ACTION_MS : SNACKBAR_MS)
		};
		this.#queue.push(snackbar);
		if (!this.current) this.#next();
		return snackbar.id;
	}

	/** Shows an error's copy, with "Try again" when retrying could help. */
	error(error: unknown, retry?: () => void): number {
		const copy = describeError(error);
		return this.show(`${copy.title}. ${copy.message}`, {
			tone: 'error',
			action: retry && copy.retry ? { label: 'Try again', run: retry } : undefined
		});
	}

	dismiss(id?: number) {
		if (!this.current || (id !== undefined && this.current.id !== id)) {
			this.#queue = this.#queue.filter((s) => s.id !== id);
			return;
		}
		clearTimeout(this.#timer);
		this.current = null;
		this.#next();
	}

	/** Pauses the timeout while the reader hovers or focuses the snackbar. */
	hold() {
		clearTimeout(this.#timer);
	}

	release() {
		if (this.current) this.#arm(this.current);
	}

	#next() {
		const next = this.#queue.shift();
		this.current = next ?? null;
		if (next) this.#arm(next);
	}

	#arm(snackbar: Snackbar) {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.dismiss(snackbar.id), snackbar.timeoutMs);
	}
}

export const snackbars = new Snackbars();

/**
 * A backend action with a pending state for its control and a snackbar when it finishes
 * (plan §8 rule 2). `done` is the action's name in the past tense ("Added to library").
 */
export class Action<A extends unknown[], R> {
	pending = $state(false);

	constructor(
		private readonly perform: (...args: A) => Promise<R>,
		private readonly copy: { done?: string | ((result: R) => string) },
		private readonly bar: Snackbars = snackbars
	) {}

	run = async (...args: A): Promise<R | undefined> => {
		if (this.pending) return undefined;
		this.pending = true;
		try {
			const result = await this.perform(...args);
			const done = typeof this.copy.done === 'function' ? this.copy.done(result) : this.copy.done;
			if (done) this.bar.show(done);
			return result;
		} catch (error) {
			this.bar.error(error, () => void this.run(...args));
			return undefined;
		} finally {
			this.pending = false;
		}
	};
}

export function action<A extends unknown[], R>(
	perform: (...args: A) => Promise<R>,
	copy: { done?: string | ((result: R) => string) } = {}
): Action<A, R> {
	return new Action(perform, copy);
}
