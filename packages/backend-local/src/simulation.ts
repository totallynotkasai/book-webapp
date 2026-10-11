/**
 * Simulation controls, set from the dev panel (IMPLEMENTATION-PLAN.md §4.3). They make the
 * simulated backend behave like a real one over a real network: slow, sometimes failing,
 * sometimes unreachable, with a clock that can be moved forward to try renewals and periods.
 */
import type { Clock } from '@book/core';
import { z } from 'zod';

export const simulationSchema = z.object({
	/** Each call waits a random time in this range (ms). */
	latencyMs: z
		.object({ min: z.number().int().min(0), max: z.number().int().min(0) })
		.refine((l) => l.max >= l.min, 'max must be at least min'),
	/** Chance (0–1) that a call fails with `SERVER_ERROR`. */
	failureRate: z.number().min(0).max(1),
	/** Every call fails with `NETWORK_ERROR`. */
	offline: z.boolean(),
	/** What simulated checkout does (used from P1-STO-02). */
	paymentOutcome: z.enum(['succeed', 'decline', 'fail']),
	/** What the stub AI detector says about unlabelled uploads (used from P1-ADM-01). */
	aiDetectorVerdict: z.enum(['clean', 'suspect']),
	/** How far the simulated clock runs ahead of real time (ms). */
	clockOffsetMs: z.number().int().min(0)
});

export type SimulationSettings = z.infer<typeof simulationSchema>;

/** Owner builds: loading states are visible but nothing fails (plan §4.3). */
export const ownerSimulationDefaults: SimulationSettings = {
	latencyMs: { min: 150, max: 400 },
	failureRate: 0,
	offline: false,
	paymentOutcome: 'succeed',
	aiDetectorVerdict: 'clean',
	clockOffsetMs: 0
};

/** Tests and E2E: instant, reliable and on a fixed clock (plan §9). */
export const testSimulationDefaults: SimulationSettings = {
	...ownerSimulationDefaults,
	latencyMs: { min: 0, max: 0 }
};

/** Real time from `base`, shifted forward by the dev panel's offset. */
export class SimulatedClock implements Clock {
	constructor(
		private readonly base: Clock,
		private readonly offset: () => number
	) {}

	now(): Date {
		return new Date(this.base.now().getTime() + this.offset());
	}
}
