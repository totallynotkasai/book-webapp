import type { AiUse, CommunityAi, CommunityPolicy } from '@book/core';
import { describe, expect, it } from 'vitest';
import {
	aiUntaggedSuspected,
	DEFAULT_FLAG_THRESHOLDS,
	hubOrder,
	labelledAi,
	mayMakeFor,
	rapidNewAccount,
	ratingSummary,
	reportPriority,
	stubDetectorScore,
	submission,
	uploadVolume
} from './index';

const book = (communityPolicy: CommunityPolicy, communityAi: CommunityAi = 'allowed') => ({
	creatorId: 'author',
	communityPolicy,
	communityAi
});

describe('community submissions under every policy (Invariant 19, P1-COM-01)', () => {
	const policies: CommunityPolicy[] = ['closed', 'approval', 'open'];
	const ais: CommunityAi[] = ['allowed', 'refused'];
	const answers: (AiUse | null)[] = [null, 'none', 'assisted', 'generated'];

	it('follows the author’s policy for every combination', () => {
		for (const policy of policies) {
			for (const ai of ais) {
				for (const aiUse of answers) {
					const result = submission(book(policy, ai), { creatorId: 'illustrator', aiUse });
					if (policy === 'closed') expect(result).toMatchObject({ allowed: false });
					else if (!aiUse) expect(result).toMatchObject({ allowed: false });
					else if (aiUse === 'generated' && ai === 'refused') {
						expect(result).toMatchObject({ allowed: false, reason: /AI-generated/ });
					} else {
						expect(result).toEqual({
							allowed: true,
							state: policy === 'approval' ? 'pending' : 'listed'
						});
					}
				}
			}
		}
	});

	it('never limits the author on their own Book', () => {
		for (const policy of policies) {
			expect(
				submission(book(policy, 'refused'), { creatorId: 'author', aiUse: 'generated' })
			).toEqual({
				allowed: true,
				state: 'listed'
			});
		}
	});

	it('refuses to start one for a closed Book', () => {
		expect(mayMakeFor(book('closed'), 'illustrator')).toMatchObject({ allowed: false });
		expect(mayMakeFor(book('approval'), 'illustrator')).toEqual({
			allowed: true,
			state: 'pending'
		});
	});
});

describe('ratings and the hub’s order (P1-COM-02)', () => {
	it('average to one decimal place', () => {
		expect(ratingSummary([])).toBeNull();
		expect(ratingSummary([{ stars: 5 }, { stars: 4 }, { stars: 4 }])).toEqual({
			average: 4.3,
			count: 3
		});
	});

	it('put endorsed Layers first, then the top-rated', () => {
		const layers = [
			{ name: 'B', endorsed: false, rating: { average: 4.9, count: 10 } },
			{ name: 'A', endorsed: true, rating: { average: 3.1, count: 2 } },
			{ name: 'C', endorsed: false, rating: null },
			{ name: 'D', endorsed: false, rating: { average: 4.9, count: 30 } }
		];
		expect([...layers].sort(hubOrder).map((l) => l.name)).toEqual(['A', 'D', 'B', 'C']);
	});
});

describe('Flag rules (§10.6, P1-ADM-01): below, at and above each threshold', () => {
	const now = new Date('2026-10-11T12:00:00.000Z');
	const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
	const t = DEFAULT_FLAG_THRESHOLDS;

	it('upload_volume counts distinct Books, and every Layer, within the window', () => {
		const books = (n: number) =>
			Array.from({ length: n }, (_, i) => ({ at: daysAgo(1), targetId: `b${i}` }));
		expect(uploadVolume(books(t.books - 1), 'books', now)).toEqual({ count: 9, fires: false });
		expect(uploadVolume(books(t.books), 'books', now).fires).toBe(true);
		expect(uploadVolume(books(t.books + 1), 'books', now).fires).toBe(true);
		// Ten Revisions of one Book are one Book.
		const sameBook = Array.from({ length: 12 }, () => ({ at: daysAgo(1), targetId: 'b' }));
		expect(uploadVolume(sameBook, 'books', now).count).toBe(1);
		// Layers count each publish; older than the window doesn't count.
		const layers = Array.from({ length: t.layers }, (_, i) => ({
			at: daysAgo(i < 2 ? 31 : 1),
			targetId: `l${i}`
		}));
		expect(uploadVolume(layers, 'layers', now)).toEqual({ count: 8, fires: false });
		expect(
			uploadVolume(
				layers.map((l) => ({ ...l, at: daysAgo(1) })),
				'layers',
				now
			).fires
		).toBe(true);
	});

	it('ai_untagged_suspected: unlabelled content, after volume or at the detector’s threshold', () => {
		const score = (s: number) => ({ aiUse: 'none' as const, volumeFired: false, detectorScore: s });
		expect(aiUntaggedSuspected(score(t.detectorScore - 0.01))).toBe(false);
		expect(aiUntaggedSuspected(score(t.detectorScore))).toBe(true);
		expect(aiUntaggedSuspected(score(t.detectorScore + 0.01))).toBe(true);
		expect(aiUntaggedSuspected({ aiUse: 'none', volumeFired: true, detectorScore: null })).toBe(
			true
		);
		// Labelled AI is never suspected of being unlabelled.
		expect(aiUntaggedSuspected({ aiUse: 'generated', volumeFired: true, detectorScore: 1 })).toBe(
			false
		);
		expect(labelledAi('assisted')).toBe(true);
		expect(stubDetectorScore('suspect')).toBeGreaterThanOrEqual(t.detectorScore);
		expect(stubDetectorScore('clean')).toBeLessThan(t.detectorScore);
	});

	it('rapid_new_account: paid content within the first days only', () => {
		const paid = { priceMinor: 99 };
		const joined = (days: number) => ({ joinedAt: daysAgo(days) });
		expect(rapidNewAccount(joined(t.newAccountDays - 1), paid, now)).toBe(true);
		expect(rapidNewAccount(joined(t.newAccountDays), paid, now)).toBe(false);
		expect(rapidNewAccount(joined(t.newAccountDays + 1), paid, now)).toBe(false);
		expect(rapidNewAccount(joined(1), { priceMinor: 0 }, now)).toBe(false);
	});

	it('report: priority rises with each report', () => {
		expect(reportPriority(0)).toBe(1);
		expect(reportPriority(1)).toBe(1);
		expect(reportPriority(3)).toBe(3);
	});
});
