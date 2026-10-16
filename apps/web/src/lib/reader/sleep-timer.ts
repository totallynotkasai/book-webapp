/**
 * The sleep timer's choices and labels (P1-LAY-09; plan §6 Phase 1.13 UX notes): 5, 15, 30 or 60
 * minutes of listening, or the end of the Chapter. The platform adapters do the counting.
 */
import { sleepTimerChoices, type SleepTimerChoice } from '@book/core';
import type { SleepState, SleepTimer } from '$lib/platform';

export const SLEEP_CHOICES: readonly SleepTimerChoice[] = sleepTimerChoices;

/** The platform's timer for the reader's choice. */
export function sleepTimerOf(choice: SleepTimerChoice): SleepTimer {
	return choice === 'chapter' ? { kind: 'item' } : { kind: 'time', ms: choice * 60_000 };
}

/** As the menu says it: "15 minutes", "End of chapter". */
export function sleepChoiceLabel(choice: SleepTimerChoice): string {
	return choice === 'chapter' ? 'End of chapter' : `${choice} minutes`;
}

/** What the player shows beside its clock: the time left ("14:32"), or "End of chapter". */
export function sleepLeftLabel(state: SleepState): string {
	if (state.kind === 'item' || state.leftMs === null) return 'End of chapter';
	const s = Math.ceil(state.leftMs / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The same for a screen reader, to the minute so it isn't a stream of seconds. */
export function sleepLeftSpoken(state: SleepState): string {
	if (state.kind === 'item' || state.leftMs === null) {
		return 'Sleep timer: stops at the end of the chapter';
	}
	const minutes = Math.ceil(state.leftMs / 60_000);
	return minutes <= 1
		? 'Sleep timer: less than a minute left'
		: `Sleep timer: ${minutes} minutes left`;
}
