/**
 * `resource()`: data from the Backend with its loading, error and refresh state (P1-APP-02).
 * Every screen uses it, so the five states of IMPLEMENTATION-PLAN.md §8 behave the same
 * everywhere: loading indicators wait about 300 ms (fast responses don't flicker), errors keep
 * the last data on screen, and screens refresh when a `Backend.events` topic fires.
 *
 * Call it while a component initialises (it uses `$effect`). Reactive values the loader reads
 * before its first `await` are tracked, so a route parameter change reloads it.
 */
import type { BackendEvents, BackendTopic } from '@book/core';
import { untrack } from 'svelte';
import { describeError, type DescribedError } from '$lib/errors';

export type ResourceStatus = 'loading' | 'ready' | 'error';

export interface ResourceOptions {
	/** Topics that make the resource reload when they fire. */
	topics?: readonly BackendTopic[];
	/** How long a load may take before loading indicators show (plan §8). */
	showLoadingAfterMs?: number;
	/** Where topics come from. Defaults to the app's Backend. */
	events?: () => Promise<BackendEvents>;
}

export const LOADING_DELAY_MS = 300;

async function appEvents(): Promise<BackendEvents> {
	const { getBackend } = await import('$lib/services');
	return (await getBackend()).events;
}

export class Resource<T> {
	/** The latest data. Kept while a refresh runs or fails, so screens don't blank. */
	data = $state<T | undefined>(undefined);
	/** Set when the latest load failed. */
	error = $state<DescribedError | undefined>(undefined);
	status = $state<ResourceStatus>('loading');
	/** A load is in flight. */
	loading = $state(false);
	/** Loading has taken longer than the delay: show a skeleton or progress indicator. */
	showLoading = $state(false);

	#load: () => Promise<T>;
	#delay: number;
	#generation = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(load: () => Promise<T>, options: ResourceOptions = {}) {
		this.#load = load;
		this.#delay = options.showLoadingAfterMs ?? LOADING_DELAY_MS;
	}

	/** Loads again. Only the latest call's result is kept. */
	refresh = (): Promise<void> => {
		const generation = ++this.#generation;
		// Called synchronously, so reactive reads before its first await are tracked by the effect.
		let promise: Promise<T>;
		try {
			promise = this.#load();
		} catch (error) {
			promise = Promise.reject(error);
		}
		return untrack(() => this.#settle(generation, promise));
	};

	async #settle(generation: number, promise: Promise<T>) {
		this.loading = true;
		if (this.data === undefined) this.status = 'loading';
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			if (generation === this.#generation && this.loading) this.showLoading = true;
		}, this.#delay);
		try {
			const data = await promise;
			if (generation !== this.#generation) return;
			this.data = data;
			this.error = undefined;
			this.status = 'ready';
		} catch (error) {
			if (generation !== this.#generation) return;
			this.error = describeError(error);
			this.status = 'error';
		} finally {
			if (generation === this.#generation) {
				clearTimeout(this.#timer);
				this.loading = false;
				this.showLoading = false;
			}
		}
	}

	/** Stops timers; later results are ignored. */
	dispose() {
		this.#generation++;
		clearTimeout(this.#timer);
	}
}

/** Creates a resource that loads now, reloads when its tracked inputs or topics change. */
export function resource<T>(load: () => Promise<T>, options: ResourceOptions = {}): Resource<T> {
	const r = new Resource(load, options);
	$effect(() => {
		void r.refresh();
		return () => r.dispose();
	});
	if (options.topics?.length) {
		const topics = options.topics;
		$effect(() => {
			let offs: (() => void)[] = [];
			let cancelled = false;
			(options.events ?? appEvents)().then((events) => {
				if (cancelled) return;
				offs = topics.map((topic) => events.on(topic, () => void r.refresh()));
			});
			return () => {
				cancelled = true;
				for (const off of offs) off();
			};
		});
	}
	return r;
}
