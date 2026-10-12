import { BackendError, type BackendEvents, type BackendTopic } from '@book/core';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOADING_DELAY_MS, resource, type Resource } from './resource.svelte';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function fakeEvents() {
	const listeners = new Map<BackendTopic, Set<() => void>>();
	const events: BackendEvents = {
		on(topic, callback) {
			const set = listeners.get(topic) ?? new Set();
			set.add(callback);
			listeners.set(topic, set);
			return () => set.delete(callback);
		}
	};
	return {
		events,
		emit: (topic: BackendTopic) => listeners.get(topic)?.forEach((cb) => cb()),
		count: (topic: BackendTopic) => listeners.get(topic)?.size ?? 0
	};
}

/** Creates a resource inside an effect root, as a component would. */
function mount<T>(create: () => Resource<T>) {
	let r!: Resource<T>;
	const destroy = $effect.root(() => {
		r = create();
	});
	flushSync();
	return { r, destroy };
}

const flush = async () => {
	await vi.advanceTimersByTimeAsync(0);
	flushSync();
};

describe('resource() (P1-APP-02)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('loads straight away and reports ready with the data', async () => {
		const { r, destroy } = mount(() => resource(async () => 42));
		expect(r.status).toBe('loading');
		expect(r.loading).toBe(true);
		await flush();
		expect(r.status).toBe('ready');
		expect(r.data).toBe(42);
		expect(r.loading).toBe(false);
		destroy();
	});

	it('shows loading indicators only after the delay', async () => {
		const slow = deferred<string>();
		const { r, destroy } = mount(() => resource(() => slow.promise));
		await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS - 1);
		expect(r.showLoading).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(r.showLoading).toBe(true);
		slow.resolve('done');
		await flush();
		expect(r.showLoading).toBe(false);
		expect(r.data).toBe('done');
		destroy();
	});

	it('never flickers a loading indicator for a fast response', async () => {
		const { r, destroy } = mount(() => resource(async () => 'fast'));
		await flush();
		await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS * 2);
		expect(r.showLoading).toBe(false);
		destroy();
	});

	it('describes a failure, keeps the last data, and recovers on refresh', async () => {
		let fail = false;
		const { r, destroy } = mount(() =>
			resource(async () => {
				if (fail) throw new BackendError('NETWORK_ERROR', 'offline');
				return 'books';
			})
		);
		await flush();
		fail = true;
		await r.refresh();
		expect(r.status).toBe('error');
		expect(r.error?.code).toBe('NETWORK_ERROR');
		expect(r.error?.offline).toBe(true);
		expect(r.data).toBe('books');
		fail = false;
		await r.refresh();
		expect(r.status).toBe('ready');
		expect(r.error).toBeUndefined();
		destroy();
	});

	it('keeps only the latest result when loads overlap', async () => {
		const first = deferred<string>();
		const second = deferred<string>();
		const loads = [first, second];
		const { r, destroy } = mount(() => resource(() => loads.shift()!.promise));
		const refreshed = r.refresh();
		second.resolve('new');
		await refreshed;
		first.resolve('old');
		await flush();
		expect(r.data).toBe('new');
		destroy();
	});

	it('reloads when one of its topics fires, and stops listening when destroyed', async () => {
		const hub = fakeEvents();
		let calls = 0;
		const { r, destroy } = mount(() =>
			resource(async () => ++calls, {
				topics: ['entitlements'],
				events: async () => hub.events
			})
		);
		await flush();
		expect(r.data).toBe(1);
		hub.emit('catalogue');
		hub.emit('entitlements');
		await flush();
		expect(r.data).toBe(2);
		destroy();
		expect(hub.count('entitlements')).toBe(0);
	});

	it('reloads when reactive state it reads changes', async () => {
		let slug = $state('alice');
		const { r, destroy } = mount(() => resource(async () => `book:${slug}`));
		await flush();
		expect(r.data).toBe('book:alice');
		slug = 'oz';
		flushSync();
		await flush();
		expect(r.data).toBe('book:oz');
		destroy();
	});

	it('treats a loader that throws synchronously as a failed load', async () => {
		const { r, destroy } = mount(() =>
			resource<number>(() => {
				throw new Error('boom');
			})
		);
		await flush();
		expect(r.status).toBe('error');
		expect(r.error?.code).toBe('UNKNOWN');
		destroy();
	});
});
