import { describe, expect, it } from 'vitest';
import {
	MAX_TILT,
	curlAxis,
	curlPoint,
	dragCommits,
	dragPose,
	easeInOut,
	playedPose,
	rolled,
	type CurlSheet
} from './curl-geometry';

// The page curl's geometry (P1-RDR-19). What it looks like is checked in e2e/page-curl.spec.ts;
// these are the rules a turn relies on: flat at the start, exactly on the other page at the end
// of a spread, the finger's drag and release.

const single: CurlSheet = { x0: 0, x1: 400, height: 800 };
const spread: CurlSheet = { x0: 600, x1: 1200, height: 800 };

describe('the curl', () => {
	it('lies flat before the turn starts', () => {
		const axis = curlAxis(single, playedPose(single, 0), false);
		for (const q of [
			[0, 0],
			[400, 0],
			[400, 800],
			[200, 400]
		] as [number, number][]) {
			expect(curlPoint(q, axis)).toEqual({ x: q[0], y: q[1], z: 0 });
		}
	});

	it('rolls a point round the cylinder, then turns it over flat', () => {
		const r = 10;
		expect(rolled(-5, r)).toBe(-5);
		expect(rolled(Math.PI * r * 0.5, r)).toBeCloseTo(r);
		expect(rolled(Math.PI * r, r)).toBeCloseTo(0);
		expect(rolled(Math.PI * r + 30, r)).toBeCloseTo(-30);
	});

	it('lands a spread’s page exactly on the other page, mirrored about the spine', () => {
		const axis = curlAxis(spread, playedPose(spread, 1), true);
		for (const q of [
			[600, 0],
			[700, 300],
			[1200, 800],
			[950, 412]
		] as [number, number][]) {
			const p = curlPoint(q, axis);
			// Within half a pixel: the roll never quite closes (its radius stays at least 0.5 px).
			expect(Math.abs(p.x - (2 * spread.x0 - q[0]))).toBeLessThan(0.5);
			expect(Math.abs(p.y - q[1])).toBeLessThan(0.5);
		}
	});

	it('takes a single page right off the screen', () => {
		const axis = curlAxis(single, playedPose(single, 1), false);
		for (const q of [
			[0, 0],
			[400, 800],
			[200, 400]
		] as [number, number][]) {
			expect(curlPoint(q, axis).x).toBeLessThan(0);
		}
	});

	it('moves the held edge to where the pose says, round the roll or turned over', () => {
		for (const progress of [0.02, 0.1, 0.3, 0.5, 0.8]) {
			const pose = { progress, grabY: 400, lift: 0 };
			const axis = curlAxis(single, pose, false);
			const edge = curlPoint([400, 400], axis);
			expect(edge.x).toBeCloseTo(400 - 2 * 400 * progress, 0);
		}
	});

	it('tilts with the lift, but never past the limit', () => {
		const up = curlAxis(single, { progress: 0.2, grabY: 780, lift: -40 }, false);
		expect(up.normal[1]).toBeGreaterThan(0);
		const steep = curlAxis(single, { progress: 0.01, grabY: 780, lift: -400 }, false);
		expect(Math.atan2(steep.normal[1], steep.normal[0])).toBeCloseTo(MAX_TILT);
	});

	it('plays a tap’s turn with its corner lifting, square at both ends', () => {
		expect(playedPose(single, 0).lift).toBeCloseTo(0);
		expect(playedPose(single, 1).lift).toBeCloseTo(0);
		expect(playedPose(single, 0.5).lift).toBeLessThan(0);
		expect(easeInOut(0)).toBe(0);
		expect(easeInOut(1)).toBe(1);
		expect(easeInOut(0.5)).toBeCloseTo(0.5);
	});
});

describe('a finger’s drag', () => {
	it('turns half-way at the bound edge, wherever it started', () => {
		for (const startX of [380, 300, 200]) {
			const pose = dragPose(single, { x: startX, y: 400 }, { x: 0, y: 400 }, 1);
			expect(pose.progress).toBeCloseTo(0.5);
		}
		// Very near the bound edge, it needs room to move: it starts from 30% of the width.
		expect(dragPose(single, { x: 20, y: 400 }, { x: 0, y: 400 }, 1).progress).toBeLessThan(0.5);
	});

	it('back, runs from turned over to flat as the finger moves the other way', () => {
		expect(dragPose(single, { x: 50, y: 400 }, { x: 50, y: 400 }, -1).progress).toBe(1);
		expect(dragPose(single, { x: 50, y: 400 }, { x: 400, y: 400 }, -1).progress).toBeCloseTo(0.5);
		expect(dragPose(single, { x: 50, y: 400 }, { x: 0, y: 400 }, -1).progress).toBe(1);
	});

	it('holds the page at the height the finger took it, tilting as it moves up or down', () => {
		const pose = dragPose(single, { x: 380, y: 700 }, { x: 200, y: 650 }, 1);
		expect(pose.grabY).toBe(700);
		expect(pose.lift).toBeCloseTo(-30);
	});

	it('finishes past a quarter of the way or on a flick, and settles back otherwise', () => {
		expect(dragCommits(0.3, 0, 1)).toBe(true);
		expect(dragCommits(0.1, 0, 1)).toBe(false);
		expect(dragCommits(0.1, -0.6, 1)).toBe(true);
		expect(dragCommits(0.4, 0.6, 1)).toBe(false);
		expect(dragCommits(0.7, 0, -1)).toBe(true);
		expect(dragCommits(0.9, 0, -1)).toBe(false);
		expect(dragCommits(0.9, 0.6, -1)).toBe(true);
	});
});
