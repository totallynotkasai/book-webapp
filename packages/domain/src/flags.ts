/**
 * Automatic Flags (DESIGN.md §10.6, P1-ADM-01): the rules in one module, thresholds in one
 * configurable object, every rule unit-tested below, at and above its threshold. A Flag only
 * ever puts content in front of a human; detector scores are evidence, never a verdict.
 */
import type { AiUse } from '@book/core';

export interface FlagThresholds {
	/** `upload_volume`: this many Books (or new Revisions of different Books) in `days`. */
	books: number;
	/** `upload_volume`: this many Illustration Packs and Audio Tracks in `days`. */
	layers: number;
	days: number;
	/** `ai_untagged_suspected`: a detector score at or above this on unlabelled content. */
	detectorScore: number;
	/** `rapid_new_account`: paid content within this many days of joining. */
	newAccountDays: number;
}

/** §10.6's numbers; changing them is a config change, not a code change. */
export const DEFAULT_FLAG_THRESHOLDS: FlagThresholds = {
	books: 10,
	layers: 10,
	days: 30,
	detectorScore: 0.8,
	newAccountDays: 7
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Labelled AI: the creator said AI made or helped make it (§10.6). */
export function labelledAi(aiUse: AiUse | null | undefined): boolean {
	return aiUse === 'assisted' || aiUse === 'generated';
}

/**
 * `upload_volume`: how many publishes fall in the window ending now, and whether that reaches
 * the threshold. For Books, `targets` are Book IDs: several Revisions of one Book count once.
 */
export function uploadVolume(
	publishes: readonly { at: string; targetId: string }[],
	kind: 'books' | 'layers',
	now: Date,
	t: FlagThresholds = DEFAULT_FLAG_THRESHOLDS
): { count: number; fires: boolean } {
	const since = now.getTime() - t.days * DAY_MS;
	const recent = publishes.filter((p) => {
		const at = Date.parse(p.at);
		return at > since && at <= now.getTime();
	});
	const count = kind === 'books' ? new Set(recent.map((p) => p.targetId)).size : recent.length;
	return { count, fires: count >= t[kind] };
}

/**
 * `ai_untagged_suspected`: the content isn't labelled AI, and either `upload_volume` fired or the
 * detector's score reaches the threshold. Such content is held for manual review.
 */
export function aiUntaggedSuspected(
	content: { aiUse: AiUse | null | undefined; volumeFired: boolean; detectorScore: number | null },
	t: FlagThresholds = DEFAULT_FLAG_THRESHOLDS
): boolean {
	if (labelledAi(content.aiUse)) return false;
	return (
		content.volumeFired ||
		(content.detectorScore !== null && content.detectorScore >= t.detectorScore)
	);
}

/** `rapid_new_account`: paid content from an account in its first days. */
export function rapidNewAccount(
	account: { joinedAt: string },
	content: { priceMinor: number },
	now: Date,
	t: FlagThresholds = DEFAULT_FLAG_THRESHOLDS
): boolean {
	if (content.priceMinor <= 0) return false;
	return now.getTime() - Date.parse(account.joinedAt) < t.newAccountDays * DAY_MS;
}

/** `report`: priority rises with every report on the same content. */
export function reportPriority(reports: number): number {
	return Math.max(1, reports);
}

/**
 * SIMULATION: the stub AI detector (§10.6, OPEN-09's detail stays open), driven from the dev
 * panel. A real service would return its own score; these sit either side of the threshold.
 */
export function stubDetectorScore(verdict: 'clean' | 'suspect'): number {
	return verdict === 'suspect' ? 0.93 : 0.04;
}
