import { describe, expect, it } from 'vitest';
import { STORY_NUDGE_DAYS, storyNudgeDue } from './story.svelte';

describe('the story-so-far nudge (P1-RDR-13)', () => {
	const day = 24 * 60 * 60 * 1000;
	const now = Date.parse('2026-10-20T12:00:00.000Z');

	it('comes after a week away, not before', () => {
		expect(STORY_NUDGE_DAYS).toBe(7);
		expect(storyNudgeDue(new Date(now - 7 * day).toISOString(), now)).toBe(true);
		expect(storyNudgeDue(new Date(now - 7 * day + 60_000).toISOString(), now)).toBe(false);
	});

	it('never comes for a Book never read, or a time it can’t read', () => {
		expect(storyNudgeDue(undefined, now)).toBe(false);
		expect(storyNudgeDue('not a date', now)).toBe(false);
	});
});
