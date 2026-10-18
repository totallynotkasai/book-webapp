/**
 * Page curl (P1-RDR-19, DESIGN.md §4.1, D-044): the optional page turn that curls the page like
 * paper. Loaded on first use, when the reader chooses it.
 *
 * The engine turns the page first, without animation, and the curl plays over it, so the page
 * coming into view is always the real one turned to and never one past it (the acceptance
 * criterion). Pictures of the pages (snapshot.ts) stand in for those that have gone: the page
 * turning away, and, turning back or in a spread, the page arriving. The overlay is a WebGL
 * canvas over the reading area (curl-gl.ts), clear wherever the real page should show.
 *
 * - **Single page:** forward, the old page curls away from its free edge over the real new page,
 *   its own text faint and mirrored on its back (owner's choice, D-044). Back, the previous page
 *   uncurls over the old one.
 * - **Spread:** the right page turns over onto the left like a book's leaf: its back is the new
 *   left page and the new right page lies under it (D-044). Back, the left page turns over to the
 *   right. A right-to-left Book turns the other way throughout.
 */
import { capture, type CaptureSource, type PageSnapshot } from './snapshot';
import { CurlRenderer, type CurlFrame, type CurlTexture } from './curl-gl';
import { curlAxis, easeInOut, playedPose, type CurlPose, type CurlSheet } from './curl-geometry';

/** How long a tap's or key's turn takes. */
export const CURL_MS = 460;
/** How much of a page's text shows through its back (single page). */
const INK = 0.16;
/** Page pictures are drawn at up to this many pixels per CSS pixel, to keep memory down. */
const MAX_DPR = 2;

export interface CurlScene {
	layout: 'single' | 'spread';
	/** 1 forward, −1 back. */
	dir: 1 | -1;
	rtl: boolean;
	/** The area's CSS size, and in a spread the spine's distance from its left. */
	width: number;
	height: number;
	spine: number;
	/** What was on screen before the turn. */
	before: PageSnapshot;
	/** What's on screen after it: needed turning back, and in a spread. */
	after: PageSnapshot | null;
}

/** Whether a scene needs the page turned to as a picture (forward on a single page doesn't). */
export function needsAfter(layout: CurlScene['layout'], dir: 1 | -1): boolean {
	return layout === 'spread' || dir < 0;
}

interface Slot {
	canvas: HTMLCanvasElement;
	texture: CurlTexture | null;
	snapshot: PageSnapshot | null;
	/** Uploaded since it was last drawn. */
	fresh: boolean;
}

export class CurlTurn {
	readonly scene: CurlScene;
	#curl: PageCurl;
	#pose: CurlPose;
	#done = false;
	#animation: { cancel: () => void } | null = null;

	constructor(curl: PageCurl, scene: CurlScene) {
		this.#curl = curl;
		this.scene = scene;
		const sheet = curl.sheetOf(scene);
		this.#pose = playedPose(sheet, scene.dir > 0 ? 0 : 1);
	}

	get done(): boolean {
		return this.#done;
	}

	get progress(): number {
		return this.#pose.progress;
	}

	get pose(): CurlPose {
		return this.#pose;
	}

	/** Shows the turn at this pose (a finger dragging it). */
	set(pose: CurlPose) {
		if (this.#done) return;
		this.#animation?.cancel();
		this.#animation = null;
		this.#pose = pose;
		this.#curl.draw(this);
	}

	/**
	 * Plays on to `to` (1 turned, 0 flat): the whole way for a tap, or on from a finger's release.
	 * Resolves when it gets there (or the turn is ended); the overlay is then gone, unless `keep`
	 * leaves its last frame up (settling back, until the page under it is back too).
	 */
	play(to: 0 | 1, ms = CURL_MS, ease = easeInOut, keep = false): Promise<void> {
		if (this.#done) return Promise.resolve();
		this.#animation?.cancel();
		const from = this.#pose;
		const sheet = this.#curl.sheetOf(this.scene);
		const target = playedPose(sheet, to);
		// A tap's turn follows the played pose; a release carries the finger's pose on, its tilt
		// easing out so the sheet lands square.
		const played =
			Math.abs(from.progress - (this.scene.dir > 0 ? 0 : 1)) < 1e-6 && from.grabY === target.grabY;
		const duration = Math.max(90, ms * Math.abs(to - from.progress));
		return new Promise<void>((resolve) => {
			let start = 0;
			let frame = 0;
			const cancel = () => {
				cancelAnimationFrame(frame);
				resolve();
			};
			this.#animation = { cancel };
			const step = (now: number) => {
				if (this.#done) return resolve();
				if (!start) start = now;
				const t = Math.min(1, (now - start) / duration);
				const k = ease(t);
				const progress = from.progress + (to - from.progress) * k;
				this.#pose = played
					? playedPose(sheet, progress)
					: {
							progress,
							grabY: from.grabY + (target.grabY - from.grabY) * k,
							lift: from.lift * (1 - k)
						};
				this.#curl.draw(this);
				if (t < 1) frame = requestAnimationFrame(step);
				else {
					this.#animation = null;
					if (!keep) this.end();
					resolve();
				}
			};
			frame = requestAnimationFrame(step);
		});
	}

	/** Ends it now: the overlay goes and the real page shows. */
	end() {
		if (this.#done) return;
		this.#done = true;
		this.#animation?.cancel();
		this.#animation = null;
		this.#curl.ended(this);
	}
}

export class PageCurl {
	readonly #canvas: HTMLCanvasElement;
	#renderer: CurlRenderer;
	#slots: Slot[];
	#next = 0;
	/** The picture prepared ahead of a turn (see prepare). */
	#prepared: PageSnapshot | null = null;
	/** Whether a frame has been drawn yet (see prepare). */
	#warmed = false;
	#turn: CurlTurn | null = null;
	#frame = 0;
	#lost = false;

	/** Null when the device can't draw it (no WebGL): the engine slides instead. */
	static create(host: HTMLElement): PageCurl | null {
		const canvas = document.createElement('canvas');
		canvas.setAttribute('aria-hidden', 'true');
		canvas.dataset.pageCurl = '';
		canvas.style.cssText =
			'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;visibility:hidden;contain:strict';
		// Multisampled edges, except on Android: there it costs fill rate on cheap phones (and in
		// the emulator, two frames in three), and at a phone's density its smoothing hardly shows.
		// Elsewhere it's cheap, and Playwright's WebKit shows a WebGL canvas only with it.
		const renderer = CurlRenderer.create(canvas, !/Android/i.test(navigator.userAgent));
		if (!renderer) return null;
		return new PageCurl(host, canvas, renderer);
	}

	private constructor(host: HTMLElement, canvas: HTMLCanvasElement, renderer: CurlRenderer) {
		this.#canvas = canvas;
		this.#renderer = renderer;
		this.#slots = Array.from({ length: 3 }, () => ({
			canvas: document.createElement('canvas'),
			texture: null,
			snapshot: null,
			fresh: false
		}));
		host.append(canvas);
		canvas.addEventListener('webglcontextlost', (e) => {
			e.preventDefault();
			this.#lost = true;
			this.stop();
		});
		canvas.addEventListener('webglcontextrestored', () => {
			this.#renderer.restore();
			for (const slot of this.#slots) slot.texture = null;
			this.#lost = false;
		});
	}

	/** Whether it can draw now (a lost GPU context comes back by itself). */
	get usable(): boolean {
		return !this.#lost && !this.#renderer.lost;
	}

	get turning(): CurlTurn | null {
		return this.#turn;
	}

	/**
	 * A picture of what's on screen now, in a canvas of its own: the oldest one not in use, and
	 * not the one prepared ahead unless there's no other.
	 */
	capture(source: Omit<CaptureSource, 'dpr'>): PageSnapshot {
		const turn = this.#turn;
		const inUse = (s: Slot) =>
			!!s.snapshot &&
			!!turn &&
			(s.snapshot === turn.scene.before || s.snapshot === turn.scene.after);
		let slot: Slot | undefined;
		for (const spare of [false, true]) {
			for (let i = 0; i < this.#slots.length && !slot; i++) {
				const candidate = this.#slots[(this.#next + i) % this.#slots.length]!;
				if (!inUse(candidate) && (spare || candidate.snapshot !== this.#prepared)) {
					slot = candidate;
				}
			}
		}
		slot ??= this.#slots[this.#next]!;
		if (slot.snapshot === this.#prepared) this.#prepared = null;
		this.#next = (this.#slots.indexOf(slot) + 1) % this.#slots.length;
		const dpr = Math.min(MAX_DPR, globalThis.devicePixelRatio || 1);
		const started = performance.now();
		slot.snapshot = capture({ ...source, dpr }, slot.canvas);
		performance.measure('page-curl:capture', { start: started });
		slot.fresh = true;
		return slot.snapshot;
	}

	/**
	 * Pictures the page and uploads it now, while the reader reads, so a turn from this page
	 * starts with nothing to draw (the page-turn budget, §12.3). See `ready`.
	 */
	prepare(source: Omit<CaptureSource, 'dpr'>): PageSnapshot {
		const snapshot = this.capture(source);
		if (this.usable) {
			const texture = this.#texture(snapshot);
			// The first time, a frame is drawn out of sight too: the GPU finishes building the
			// shaders on their first use, which would otherwise hold up the first turn.
			if (!this.#warmed && !this.#turn) {
				this.#warmed = true;
				const { width, height } = snapshot;
				const sheet = { x0: 0, x1: width, height };
				this.#renderer.resize(width, height, Math.min(MAX_DPR, globalThis.devicePixelRatio || 1));
				this.#renderer.draw(
					{
						sheet,
						axis: curlAxis(sheet, playedPose(sheet, 0.3), false),
						front: texture,
						back: { kind: 'through', ink: INK },
						under: [{ texture, x0: 0, x1: width / 2 }],
						paper: snapshot.paper,
						dark: snapshot.dark,
						mirror: false,
						shadow: 1
					},
					[width, height]
				);
				this.#renderer.clear();
			}
		}
		this.#prepared = snapshot;
		return snapshot;
	}

	/** Whether a picture prepared earlier is still there to use. */
	ready(snapshot: PageSnapshot | null | undefined): snapshot is PageSnapshot {
		return (
			!!snapshot && snapshot === this.#prepared && this.#slots.some((s) => s.snapshot === snapshot)
		);
	}

	#texture(snapshot: PageSnapshot): CurlTexture {
		const slot = this.#slots.find((s) => s.snapshot === snapshot);
		// Its canvas went to a newer picture: this turn is ending anyway (#paint skips the frame).
		if (!slot) throw new StalePicture();
		if (!slot.texture || slot.fresh) {
			slot.texture = this.#renderer.upload(slot.canvas, slot.texture ?? undefined);
			slot.fresh = false;
		}
		return slot.texture;
	}

	/** The sheet that turns, in the left-to-right frame (a right-to-left Book is mirrored). */
	sheetOf(scene: CurlScene): CurlSheet {
		if (scene.layout === 'single') return { x0: 0, x1: scene.width, height: scene.height };
		const spine = scene.rtl ? scene.width - scene.spine : scene.spine;
		return { x0: spine, x1: scene.width, height: scene.height };
	}

	#frameOf(turn: CurlTurn): CurlFrame | null {
		const { scene } = turn;
		const sheet = this.sheetOf(scene);
		const forward = scene.dir > 0;
		const arriving = scene.after;
		const front = forward ? scene.before : arriving;
		if (!front) return null;
		const axis = curlAxis(sheet, turn.pose, scene.layout === 'spread');
		const under: CurlFrame['under'] = [];
		let back: CurlFrame['back'];
		if (scene.layout === 'single') {
			back = { kind: 'through', ink: INK };
			if (!forward) under.push({ texture: this.#texture(scene.before), x0: 0, x1: scene.width });
		} else {
			const other = forward ? arriving : scene.before;
			if (!other) return null;
			back = { kind: 'page', texture: this.#texture(other) };
			// The page the sheet will cover lies still until it does.
			under.push(
				forward
					? { texture: this.#texture(scene.before), x0: 0, x1: sheet.x0 }
					: { texture: this.#texture(scene.before), x0: sheet.x0, x1: sheet.x1 }
			);
		}
		return {
			sheet,
			axis,
			front: this.#texture(front),
			back,
			under,
			paper: front.paper,
			dark: front.dark,
			mirror: scene.rtl,
			shadow: shadowAt(turn.pose.progress)
		};
	}

	/** Starts a turn: its first frame is drawn now, so it shows with the next paint. */
	start(scene: CurlScene): CurlTurn {
		this.#turn?.end();
		const turn = new CurlTurn(this, scene);
		this.#turn = turn;
		// Shown before it's drawn: WebKit drops a frame drawn into a hidden canvas.
		this.#canvas.style.visibility = 'visible';
		this.#paint(turn);
		return turn;
	}

	/** Shows a page picture flat over the page, until a turn starts (a Chapter still loading). */
	cover(snapshot: PageSnapshot, width: number, height: number) {
		const scene: CurlScene = {
			layout: 'single',
			dir: 1,
			rtl: false,
			width,
			height,
			spine: width / 2,
			before: snapshot,
			after: null
		};
		return this.start(scene);
	}

	/** Draws the turn on the next frame (several changes in one frame draw once). */
	draw(turn: CurlTurn) {
		if (turn !== this.#turn || this.#frame) return;
		this.#frame = requestAnimationFrame(() => {
			this.#frame = 0;
			if (turn === this.#turn) this.#paint(turn);
		});
	}

	#paint(turn: CurlTurn) {
		if (!this.usable) return;
		const { width, height } = turn.scene;
		this.#renderer.resize(width, height, Math.min(MAX_DPR, globalThis.devicePixelRatio || 1));
		try {
			const started = performance.now();
			const frame = this.#frameOf(turn);
			const uploaded = performance.now();
			if (frame) this.#renderer.draw(frame, [width, height]);
			performance.measure('page-curl:upload', { start: started, end: uploaded });
			performance.measure('page-curl:draw', { start: uploaded });
		} catch (e) {
			if (!(e instanceof StalePicture)) throw e;
		}
	}

	ended(turn: CurlTurn) {
		if (turn !== this.#turn) return;
		this.#turn = null;
		cancelAnimationFrame(this.#frame);
		this.#frame = 0;
		this.#canvas.style.visibility = 'hidden';
		this.#renderer.clear();
	}

	/** Ends any turn at once (a jump, a new layout): the real page shows. */
	stop() {
		this.#turn?.end();
	}

	destroy() {
		this.stop();
		this.#renderer.destroy();
		this.#canvas.remove();
		for (const slot of this.#slots) {
			slot.canvas.width = slot.canvas.height = 0;
		}
	}
}

class StalePicture extends Error {}

/** How dark the curl's shadows are through the turn: none while it lies flat at either end. */
export function shadowAt(progress: number): number {
	const p = Math.min(1, Math.max(0, progress));
	return Math.min(1, p / 0.08) * Math.min(1, (1 - p) / 0.08);
}
