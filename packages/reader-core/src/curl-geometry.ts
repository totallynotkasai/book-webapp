/**
 * Page curl (P1-RDR-19): where the turning sheet bends. The sheet rolls round a cylinder lying on
 * the page: points past the cylinder's axis wrap round it, and points more than half its
 * circumference past are turned over, flat, on the other side. This module is the plain maths
 * (unit-tested); `curl-gl.ts` draws it.
 *
 * Everything is in CSS pixels in a left-to-right frame: the sheet spans x0 (its bound edge: the
 * spine in a spread) to x1 (the free edge, which lifts). A right-to-left Book is drawn mirrored.
 * Progress runs from 0 (flat, nothing turned) to 1 (turned right over: the free edge lies a
 * sheet's width beyond the bound edge, so in a spread the sheet lands exactly on the other page).
 */

export interface CurlSheet {
	x0: number;
	x1: number;
	height: number;
}

/** A moment of the turn: how far, and where the reader holds the page. */
export interface CurlPose {
	/** 0 (flat) to 1 (turned over). */
	progress: number;
	/** The height the free edge is held at. */
	grabY: number;
	/** How far the held point has moved up (−) or down (+) from there. */
	lift: number;
}

/** The cylinder: points with `dot(q, normal) > axis` are past it. */
export interface CurlAxis {
	/** Unit vector pointing from the axis towards the free edge. */
	normal: [number, number];
	/** The axis's distance from the origin along `normal`. */
	axis: number;
	radius: number;
}

/** The steepest the axis tilts from upright (about 24°), so it always reads as a page. */
export const MAX_TILT = 0.42;

/**
 * The cylinder's radius through the turn: a gentle roll that's widest half-way and, in a
 * spread, closes up as the sheet lands, so it lies flat on the other page.
 */
export function curlRadius(sheet: CurlSheet, progress: number, landing: boolean): number {
	const width = sheet.x1 - sheet.x0;
	const p = Math.min(1, Math.max(0, progress));
	const rise = Math.sin(Math.PI * p);
	return landing ? width * 0.13 * Math.pow(rise, 0.7) : width * (0.06 + 0.08 * rise);
}

/**
 * Where a point at distance `s` past the axis ends up, along the normal, relative to the axis:
 * flat before it, round the cylinder, then turned over.
 */
export function rolled(s: number, radius: number): number {
	if (s <= 0) return s;
	if (s < Math.PI * radius) return radius * Math.sin(s / radius);
	return Math.PI * radius - s;
}

/**
 * The axis that puts the held point of the free edge where the pose says it is: the free edge
 * travels 2 × the sheet's width over the turn, tilted by the lift.
 */
export function curlAxis(sheet: CurlSheet, pose: CurlPose, landing: boolean): CurlAxis {
	const width = sheet.x1 - sheet.x0;
	const p = Math.min(1, Math.max(0, pose.progress));
	const radius = Math.max(0.5, curlRadius(sheet, p, landing));
	const travel = 2 * width * p;
	// The held point starts on the free edge and is pulled towards (and past) the bound edge.
	let angle = travel > 0 || pose.lift !== 0 ? Math.atan2(-pose.lift, Math.max(travel, 1)) : 0;
	angle = Math.max(-MAX_TILT, Math.min(MAX_TILT, angle));
	const normal: [number, number] = [Math.cos(angle), Math.sin(angle)];
	const held: [number, number] = [sheet.x1, pose.grabY];
	const e = held[0] * normal[0] + held[1] * normal[1];
	// Where the held point should appear, along the normal.
	const t = e - travel;
	let axis: number;
	if (e - t >= Math.PI * radius) {
		// Turned over: it lands as far before the axis as it was past it, less the roll.
		axis = (t + e - Math.PI * radius) / 2;
	} else {
		// Still on the roll: solve e − s + r·sin(s/r) = t for s ∈ [0, πr] (it falls with s).
		let lo = 0;
		let hi = Math.PI * radius;
		for (let i = 0; i < 40; i++) {
			const s = (lo + hi) / 2;
			if (e - s + radius * Math.sin(s / radius) > t) lo = s;
			else hi = s;
		}
		axis = e - (lo + hi) / 2;
	}
	return { normal, axis, radius };
}

/** Where a point of the sheet ends up in the pose: on the page, and its height above it. */
export function curlPoint(q: [number, number], c: CurlAxis): { x: number; y: number; z: number } {
	const s = q[0] * c.normal[0] + q[1] * c.normal[1] - c.axis;
	if (s <= 0) return { x: q[0], y: q[1], z: 0 };
	const r = c.radius;
	const along = rolled(s, r) - s;
	const z = s < Math.PI * r ? r * (1 - Math.cos(s / r)) : 2 * r;
	return { x: q[0] + along * c.normal[0], y: q[1] + along * c.normal[1], z };
}

/**
 * A finger's drag as a pose (UX notes: "the curl follows a finger"). Dragging from where the
 * finger went down to the bound edge turns the page half-way, wherever on the page it started;
 * so a drag from the free edge moves the edge with the finger. Moving up or down tilts the
 * curl. `dir` is 1 for a turn forward (the finger moves towards the bound edge), −1 back.
 */
export function dragPose(
	sheet: CurlSheet,
	start: { x: number; y: number },
	now: { x: number; y: number },
	dir: 1 | -1
): CurlPose {
	const width = sheet.x1 - sheet.x0;
	const room =
		dir > 0 ? Math.max(start.x - sheet.x0, width * 0.3) : Math.max(sheet.x1 - start.x, width * 0.3);
	const moved = dir > 0 ? start.x - now.x : now.x - start.x;
	const half = Math.max(0, moved) / room / 2;
	return {
		progress: dir > 0 ? Math.min(1, half) : Math.max(0, 1 - half),
		grabY: Math.min(sheet.height, Math.max(0, start.y)),
		lift: (now.y - start.y) * 0.6
	};
}

/**
 * Whether a released drag finishes the turn or settles back: past a quarter of the way (from
 * where it started), or flicked towards it; a flick the other way always settles back.
 * `velocity` is the finger's, in px/ms along x.
 */
export function dragCommits(progress: number, velocity: number, dir: 1 | -1): boolean {
	const towards = dir > 0 ? -velocity : velocity;
	if (towards < -0.25) return false;
	if (towards > 0.25) return true;
	return dir > 0 ? progress >= 0.25 : progress <= 0.75;
}

/** A tap or key's turn, as a pose over time: held low on the edge, its corner lifting a little. */
export function playedPose(sheet: CurlSheet, progress: number): CurlPose {
	return {
		progress,
		grabY: sheet.height * 0.9,
		lift: -sheet.height * 0.07 * Math.sin(Math.PI * Math.min(1, Math.max(0, progress)))
	};
}

/** Slow in, slow out. */
export function easeInOut(t: number): number {
	const x = Math.min(1, Math.max(0, t));
	return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Fast out, slow in: a released drag carries on from the finger's speed. */
export function easeOut(t: number): number {
	const x = Math.min(1, Math.max(0, t));
	return 1 - Math.pow(1 - x, 3);
}
