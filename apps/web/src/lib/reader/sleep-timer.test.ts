import { describe, expect, it } from 'vitest';
import {
	SLEEP_CHOICES,
	sleepChoiceLabel,
	sleepLeftLabel,
	sleepLeftSpoken,
	sleepTimerOf
} from './sleep-timer';

describe('the sleep timer’s choices (P1-LAY-09)', () => {
	it('offers 5, 15, 30 and 60 minutes and the end of the Chapter', () => {
		expect(SLEEP_CHOICES.map(sleepChoiceLabel)).toEqual([
			'5 minutes',
			'15 minutes',
			'30 minutes',
			'60 minutes',
			'End of chapter'
		]);
	});

	it('turns a choice into the platform’s timer', () => {
		expect(sleepTimerOf(15)).toEqual({ kind: 'time', ms: 900_000 });
		expect(sleepTimerOf('chapter')).toEqual({ kind: 'item' });
	});
});

describe('what the player shows', () => {
	it('shows the time left to the second, rounding up', () => {
		expect(sleepLeftLabel({ kind: 'time', leftMs: 900_000 })).toBe('15:00');
		expect(sleepLeftLabel({ kind: 'time', leftMs: 61_001 })).toBe('1:02');
		expect(sleepLeftLabel({ kind: 'time', leftMs: 0 })).toBe('0:00');
		expect(sleepLeftLabel({ kind: 'item', leftMs: 12_000 })).toBe('End of chapter');
	});

	it('tells a screen reader to the minute', () => {
		expect(sleepLeftSpoken({ kind: 'time', leftMs: 14 * 60_000 + 1 })).toBe(
			'Sleep timer: 15 minutes left'
		);
		expect(sleepLeftSpoken({ kind: 'time', leftMs: 30_000 })).toBe(
			'Sleep timer: less than a minute left'
		);
		expect(sleepLeftSpoken({ kind: 'item', leftMs: null })).toBe(
			'Sleep timer: stops at the end of the chapter'
		);
	});
});
