import type { Clock } from '@book/core';

/** A clock tests move by hand, so timestamps and IDs are predictable. */
export class ManualClock implements Clock {
	#ms: number;

	constructor(start: string | number = '2026-10-11T09:00:00.000Z') {
		this.#ms = typeof start === 'number' ? start : Date.parse(start);
	}

	now(): Date {
		return new Date(this.#ms);
	}

	advance(ms: number): void {
		this.#ms += ms;
	}
}
