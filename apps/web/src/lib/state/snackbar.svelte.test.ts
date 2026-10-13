import { BackendError } from '@book/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Action, SNACKBAR_MS, SNACKBAR_WITH_ACTION_MS, Snackbars } from './snackbar.svelte';

describe('snackbars (P1-APP-02)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('shows one at a time, in order, each for its timeout', () => {
		const bar = new Snackbars();
		bar.show('Added to library');
		bar.show('Saved note');
		expect(bar.current?.message).toBe('Added to library');
		vi.advanceTimersByTime(SNACKBAR_MS);
		expect(bar.current?.message).toBe('Saved note');
		vi.advanceTimersByTime(SNACKBAR_MS);
		expect(bar.current).toBeNull();
	});

	it('lets an error replace a plain confirmation at once, but never one with an action', () => {
		const bar = new Snackbars();
		bar.show('Picture attached.');
		bar.show('Add alt text first.', { tone: 'error' });
		expect(bar.current?.message).toBe('Add alt text first.');

		const undoable = new Snackbars();
		undoable.show('Highlight removed', { action: { label: 'Undo', run: vi.fn() } });
		undoable.show('Couldn’t save', { tone: 'error' });
		expect(undoable.current?.message).toBe('Highlight removed');
		vi.advanceTimersByTime(SNACKBAR_WITH_ACTION_MS);
		expect(undoable.current?.message).toBe('Couldn’t save');
	});

	it('stays longer when it has an action, and can be dismissed early', () => {
		const bar = new Snackbars();
		const run = vi.fn();
		const id = bar.show('Highlight removed', { action: { label: 'Undo', run } });
		vi.advanceTimersByTime(SNACKBAR_MS);
		expect(bar.current?.id).toBe(id);
		vi.advanceTimersByTime(SNACKBAR_WITH_ACTION_MS - SNACKBAR_MS);
		expect(bar.current).toBeNull();

		bar.show('Again');
		bar.dismiss();
		expect(bar.current).toBeNull();
	});

	it('holds while focused or hovered, then carries on', () => {
		const bar = new Snackbars();
		bar.show('Saved');
		bar.hold();
		vi.advanceTimersByTime(SNACKBAR_MS * 3);
		expect(bar.current?.message).toBe('Saved');
		bar.release();
		vi.advanceTimersByTime(SNACKBAR_MS);
		expect(bar.current).toBeNull();
	});

	it('shows error copy, offering "Try again" only when it could help', () => {
		const bar = new Snackbars();
		const retry = vi.fn();
		bar.error(new BackendError('SERVER_ERROR', 'x'), retry);
		expect(bar.current?.tone).toBe('error');
		expect(bar.current?.message).toBe('Something went wrong on the server. Try again in a moment.');
		bar.current?.action?.run();
		expect(retry).toHaveBeenCalled();
		bar.dismiss();
		bar.error(new BackendError('FORBIDDEN', 'x'), retry);
		expect(bar.current?.action).toBeUndefined();
	});
});

describe('Action', () => {
	it('is pending while it runs, ignores repeat taps, and confirms by name', async () => {
		const bar = new Snackbars();
		let resolve!: (v: string) => void;
		const perform = vi.fn(() => new Promise<string>((r) => (resolve = r)));
		const add = new Action(perform, { done: 'Added to library' }, bar);
		const first = add.run();
		expect(add.pending).toBe(true);
		await add.run();
		expect(perform).toHaveBeenCalledTimes(1);
		resolve('ok');
		expect(await first).toBe('ok');
		expect(add.pending).toBe(false);
		expect(bar.current?.message).toBe('Added to library');
	});

	it('turns a failure into an error snackbar with a retry', async () => {
		const bar = new Snackbars();
		const perform = vi
			.fn<() => Promise<number>>()
			.mockRejectedValueOnce(new BackendError('NETWORK_ERROR', 'offline'))
			.mockResolvedValueOnce(1);
		const buy = new Action(perform, { done: (n) => `Bought ${n}` }, bar);
		expect(await buy.run()).toBeUndefined();
		expect(bar.current?.tone).toBe('error');
		bar.current?.action?.run();
		await vi.waitFor(() => expect(perform).toHaveBeenCalledTimes(2));
		bar.dismiss();
		await vi.waitFor(() => expect(bar.current?.message).toBe('Bought 1'));
	});
});
