/**
 * Page curl (P1-RDR-19): draws a turn with WebGL. The turning sheet is a fine grid bent round a
 * cylinder in the vertex shader (curl-geometry.ts has the same maths), so a frame only changes a
 * few numbers: it holds 60 fps on any phone's GPU. Pictures of the pages (snapshot.ts) are its
 * textures: the sheet's front; its back (the same page seen faintly through the paper, or in a
 * spread the page it lands as); and pages lying still underneath. Where nothing is drawn the
 * canvas is clear, so the real page shows through, with the curl's shadow over it.
 *
 * Coordinates are CSS pixels in a left-to-right frame; `mirror` flips the output for a
 * right-to-left Book (its pages turn the other way).
 */
import type { CurlAxis, CurlSheet } from './curl-geometry';

/** A page picture uploaded for drawing. */
export interface CurlTexture {
	readonly id: WebGLTexture;
	readonly width: number;
	readonly height: number;
}

export interface CurlFrame {
	sheet: CurlSheet;
	axis: CurlAxis;
	front: CurlTexture;
	/** The back: `page` lands on the other page (sampled mirrored about the bound edge); `through` is the front seen through the paper. */
	back: { kind: 'page'; texture: CurlTexture } | { kind: 'through'; ink: number };
	/** Pages lying still under the sheet, in the same frame's coordinates. */
	under: { texture: CurlTexture; x0: number; x1: number }[];
	paper: [number, number, number];
	dark: boolean;
	mirror: boolean;
	/** 0–1: how dark the shadows are (none while the sheet lies flat). */
	shadow: number;
}

const SHEET_VERTEX = `
attribute vec2 aGrid;
uniform vec2 uSize;
uniform vec2 uSheet;
uniform vec2 uNormal;
uniform float uAxis;
uniform float uRadius;
uniform float uDepth;
uniform float uMirror;
varying vec2 vQ;
varying float vTheta;
const float PI = 3.14159265;
void main() {
	vec2 q = vec2(mix(uSheet.x, uSheet.y, aGrid.x), aGrid.y * uSize.y);
	float s = dot(q, uNormal) - uAxis;
	float r = max(uRadius, 0.5);
	vec3 p = vec3(q, 0.0);
	float theta = 0.0;
	if (s > 0.0) {
		if (s < PI * r) {
			theta = s / r;
			p.xy = q + (r * sin(theta) - s) * uNormal;
			p.z = r * (1.0 - cos(theta));
		} else {
			theta = PI;
			p.xy = q + (PI * r - 2.0 * s) * uNormal;
			p.z = 2.0 * r;
		}
	}
	vec2 c = uSize * 0.5;
	vec2 xy = c + (p.xy - c) * (uDepth / (uDepth - p.z));
	if (uMirror > 0.5) xy.x = uSize.x - xy.x;
	gl_Position = vec4(xy.x / uSize.x * 2.0 - 1.0, 1.0 - xy.y / uSize.y * 2.0, -p.z / (2.0 * r + 1.0), 1.0);
	vQ = q;
	vTheta = theta;
}`;

/** The shadow the turned-over part casts on what lies flat beside its edge (shared below). */
const SHADOW = `
uniform vec2 uSize;
uniform vec2 uSheet;
uniform vec2 uNormal;
uniform float uAxis;
uniform float uRadius;
uniform float uMirror;
uniform float uDark;
uniform float uShadow;
const float PI = 3.14159265;
// How far a point lies outside the sheet (0 inside).
float outside(vec2 p) {
	vec2 d = max(vec2(uSheet.x, 0.0) - p, p - vec2(uSheet.y, uSize.y));
	return length(max(d, 0.0));
}
// Darkness at q, which lies flat (s <= 0): the turned-over paper that would land here comes
// from q + (πr − 2s)·n; just beyond its edge, the page is in its shadow.
float landingShadow(vec2 q, float s) {
	float r = max(uRadius, 0.5);
	vec2 from = q + (PI * r - 2.0 * s) * uNormal;
	float d = outside(from);
	if (d <= 0.0) return 0.0;
	float reach = 6.0 + r * 1.2;
	return uShadow * (uDark > 0.5 ? 0.42 : 0.26) * (1.0 - smoothstep(0.0, reach, d)) * smoothstep(0.0, r * 0.6, -s + 1.0);
}
// Darkness on the page uncovered past the roll (s > 0): deepest at the roll, fading out.
float rollShadow(float s) {
	float r = max(uRadius, 0.5);
	float width = r * 0.9 + (uSheet.y - uSheet.x) * 0.05;
	return uShadow * (uDark > 0.5 ? 0.5 : 0.32) * (1.0 - smoothstep(r * 0.2, r + width, s));
}`;

const SHEET_FRAGMENT = `
precision highp float;
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uBackPage;
uniform float uInk;
uniform vec3 uPaper;
varying vec2 vQ;
varying float vTheta;
${SHADOW}
vec4 sampleAt(sampler2D t, vec2 q) {
	float x = uMirror > 0.5 ? uSize.x - q.x : q.x;
	return texture2D(t, vec2(x / uSize.x, q.y / uSize.y));
}
void main() {
	vec3 colour;
	if (vTheta < PI * 0.5) {
		colour = sampleAt(uFront, vQ).rgb;
		// The roll turns away from the light; a soft sheen near its top.
		float bend = sin(vTheta);
		float light = 1.0 - (uDark > 0.5 ? 0.18 : 0.22) * bend * bend;
		float sheen = smoothstep(0.55, 0.9, bend) * (1.0 - smoothstep(0.9, 1.0, bend));
		colour = colour * light + vec3(uDark > 0.5 ? 0.07 : 0.05) * sheen;
		if (vTheta == 0.0) colour *= 1.0 - landingShadow(vQ, dot(vQ, uNormal) - uAxis);
	} else {
		if (uBackPage > 0.5) {
			colour = sampleAt(uBack, vec2(2.0 * uSheet.x - vQ.x, vQ.y)).rgb;
		} else {
			colour = mix(uPaper, sampleAt(uFront, vQ).rgb, uInk);
		}
		// The back of the roll faces the light as it comes round to lie flat.
		float up = -cos(vTheta);
		float light = mix(uDark > 0.5 ? 0.8 : 0.78, 1.0, up);
		float sheen = smoothstep(0.0, 0.35, up) * (1.0 - smoothstep(0.35, 0.8, up));
		colour = colour * light + vec3(uDark > 0.5 ? 0.06 : 0.04) * sheen;
	}
	gl_FragColor = vec4(colour, 1.0);
}`;

const QUAD_VERTEX = `
attribute vec2 aGrid;
uniform vec2 uSize;
uniform vec2 uSpan;
uniform float uMirror;
varying vec2 vQ;
void main() {
	vec2 q = vec2(mix(uSpan.x, uSpan.y, aGrid.x), aGrid.y * uSize.y);
	vec2 xy = q;
	if (uMirror > 0.5) xy.x = uSize.x - xy.x;
	gl_Position = vec4(xy.x / uSize.x * 2.0 - 1.0, 1.0 - xy.y / uSize.y * 2.0, 0.999, 1.0);
	vQ = q;
}`;

/**
 * A band of the page beside the axis, `uBand` (distances past it) wide and as long as the page
 * is big: where the roll's shadow falls, so the shadow is worked out only there.
 */
const BAND_VERTEX = `
attribute vec2 aGrid;
uniform vec2 uSize;
uniform vec2 uNormal;
uniform float uAxis;
uniform vec2 uBand;
uniform float uMirror;
varying vec2 vQ;
void main() {
	vec2 along = vec2(-uNormal.y, uNormal.x);
	float reach = length(uSize) * 1.5;
	vec2 q = uNormal * (uAxis + mix(uBand.x, uBand.y, aGrid.x)) + along * mix(-reach, reach, aGrid.y);
	vec2 xy = q;
	if (uMirror > 0.5) xy.x = uSize.x - xy.x;
	gl_Position = vec4(xy.x / uSize.x * 2.0 - 1.0, 1.0 - xy.y / uSize.y * 2.0, 0.999, 1.0);
	vQ = q;
}`;

/** A page lying still under the sheet. */
const UNDER_FRAGMENT = `
precision highp float;
uniform sampler2D uTexture;
uniform vec2 uSize;
uniform float uMirror;
varying vec2 vQ;
void main() {
	float x = uMirror > 0.5 ? uSize.x - vQ.x : vQ.x;
	gl_FragColor = vec4(texture2D(uTexture, vec2(x / uSize.x, vQ.y / uSize.y)).rgb, 1.0);
}`;

/** The curl's shadow over whatever lies under it (a still page, or the real one showing through). */
const SHADOW_FRAGMENT = `
precision highp float;
varying vec2 vQ;
${SHADOW}
void main() {
	float s = dot(vQ, uNormal) - uAxis;
	float inside = step(uSheet.x, vQ.x) * step(vQ.x, uSheet.y);
	float a = s > 0.0 ? rollShadow(s) * inside : landingShadow(vQ, s);
	gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

function compile(gl: WebGLRenderingContext, vertex: string, fragment: string): WebGLProgram {
	const program = gl.createProgram();
	if (!program) throw new Error('No WebGL program.');
	for (const [type, source] of [
		[gl.VERTEX_SHADER, vertex],
		[gl.FRAGMENT_SHADER, fragment]
	] as const) {
		const shader = gl.createShader(type)!;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
			throw new Error(`Page curl shader: ${gl.getShaderInfoLog(shader) ?? 'failed'}`);
		}
		gl.attachShader(program, shader);
	}
	gl.bindAttribLocation(program, 0, 'aGrid');
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
		throw new Error(`Page curl program: ${gl.getProgramInfoLog(program) ?? 'failed'}`);
	}
	return program;
}

/** A grid of columns × rows cells over [0, 1]², as triangles. */
function grid(gl: WebGLRenderingContext, columns: number, rows: number) {
	const vertices = new Float32Array((columns + 1) * (rows + 1) * 2);
	let v = 0;
	for (let j = 0; j <= rows; j++) {
		for (let i = 0; i <= columns; i++) {
			vertices[v++] = i / columns;
			vertices[v++] = j / rows;
		}
	}
	const indices = new Uint16Array(columns * rows * 6);
	let k = 0;
	for (let j = 0; j < rows; j++) {
		for (let i = 0; i < columns; i++) {
			const a = j * (columns + 1) + i;
			const b = a + 1;
			const c = a + columns + 1;
			const d = c + 1;
			indices.set([a, c, b, b, c, d], k);
			k += 6;
		}
	}
	const vbo = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
	const ibo = gl.createBuffer();
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
	return { vbo, ibo, count: indices.length };
}

export class CurlRenderer {
	readonly canvas: HTMLCanvasElement;
	readonly #gl: WebGLRenderingContext;
	#sheet!: WebGLProgram;
	#under!: WebGLProgram;
	#shadow!: WebGLProgram;
	#band!: WebGLProgram;
	#sheetGrid!: ReturnType<typeof grid>;
	#quad!: ReturnType<typeof grid>;
	#uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
	#textures: WebGLTexture[] = [];

	/** Null when the device has no WebGL: the turn then slides instead. */
	static create(canvas: HTMLCanvasElement, antialias: boolean): CurlRenderer | null {
		const gl = canvas.getContext('webgl', {
			alpha: true,
			premultipliedAlpha: true,
			antialias,
			depth: true,
			stencil: false,
			preserveDrawingBuffer: false
		});
		if (!gl) return null;
		try {
			return new CurlRenderer(canvas, gl);
		} catch (e) {
			console.warn(e);
			return null;
		}
	}

	private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
		this.canvas = canvas;
		this.#gl = gl;
		this.#setUp();
	}

	#setUp() {
		const gl = this.#gl;
		// Uniforms both shaders use must match in precision: without highp in fragment shaders
		// (rare now), both use mediump.
		const high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision;
		const fragment = (source: string) =>
			high ? source : source.replace('precision highp float;', 'precision mediump float;');
		const vertex = (source: string) => (high ? source : `precision mediump float;\n${source}`);
		this.#sheet = compile(gl, vertex(SHEET_VERTEX), fragment(SHEET_FRAGMENT));
		this.#under = compile(gl, vertex(QUAD_VERTEX), fragment(UNDER_FRAGMENT));
		this.#shadow = compile(gl, vertex(QUAD_VERTEX), fragment(SHADOW_FRAGMENT));
		this.#band = compile(gl, vertex(BAND_VERTEX), fragment(SHADOW_FRAGMENT));
		this.#sheetGrid = grid(gl, 96, 96);
		this.#quad = grid(gl, 1, 1);
		this.#uniforms.clear();
	}

	/** After the context was lost and given back, everything is made again. */
	restore() {
		this.#textures = [];
		this.#setUp();
	}

	get lost(): boolean {
		return this.#gl.isContextLost();
	}

	#u(program: WebGLProgram, name: string): WebGLUniformLocation | null {
		let names = this.#uniforms.get(program);
		if (!names) this.#uniforms.set(program, (names = new Map()));
		if (!names.has(name)) names.set(name, this.#gl.getUniformLocation(program, name));
		return names.get(name)!;
	}

	/** Uploads a page picture (or replaces an earlier upload's pixels). */
	upload(source: HTMLCanvasElement, into?: CurlTexture): CurlTexture {
		const gl = this.#gl;
		const id = into?.id ?? gl.createTexture()!;
		if (!into) this.#textures.push(id);
		gl.bindTexture(gl.TEXTURE_2D, id);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return { id, width: source.width, height: source.height };
	}

	/** Sizes the canvas's pixels to its box. */
	resize(width: number, height: number, dpr: number) {
		const w = Math.max(1, Math.round(width * dpr));
		const h = Math.max(1, Math.round(height * dpr));
		if (this.canvas.width !== w) this.canvas.width = w;
		if (this.canvas.height !== h) this.canvas.height = h;
	}

	#bindGrid(g: ReturnType<typeof grid>) {
		const gl = this.#gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ibo);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
	}

	#common(program: WebGLProgram, f: CurlFrame, size: [number, number]) {
		const gl = this.#gl;
		gl.uniform2f(this.#u(program, 'uSize'), size[0], size[1]);
		gl.uniform2f(this.#u(program, 'uSheet'), f.sheet.x0, f.sheet.x1);
		gl.uniform2f(this.#u(program, 'uNormal'), f.axis.normal[0], f.axis.normal[1]);
		gl.uniform1f(this.#u(program, 'uAxis'), f.axis.axis);
		gl.uniform1f(this.#u(program, 'uRadius'), f.axis.radius);
		gl.uniform1f(this.#u(program, 'uMirror'), f.mirror ? 1 : 0);
		gl.uniform1f(this.#u(program, 'uDark'), f.dark ? 1 : 0);
		gl.uniform1f(this.#u(program, 'uShadow'), f.shadow);
	}

	/** Draws one frame. `size` is the canvas's CSS size. */
	draw(f: CurlFrame, size: [number, number]) {
		const gl = this.#gl;
		if (gl.isContextLost()) return;
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clearDepth(1);
		gl.disable(gl.CULL_FACE);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		// Pages lying still.
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.useProgram(this.#under);
		this.#bindGrid(this.#quad);
		gl.uniform2f(this.#u(this.#under, 'uSize'), size[0], size[1]);
		gl.uniform1f(this.#u(this.#under, 'uMirror'), f.mirror ? 1 : 0);
		gl.uniform1i(this.#u(this.#under, 'uTexture'), 0);
		gl.activeTexture(gl.TEXTURE0);
		for (const under of f.under) {
			gl.bindTexture(gl.TEXTURE_2D, under.texture.id);
			gl.uniform2f(this.#u(this.#under, 'uSpan'), under.x0, under.x1);
			gl.drawElements(gl.TRIANGLES, this.#quad.count, gl.UNSIGNED_SHORT, 0);
		}

		// The curl's shadow over them, and over the real page showing through: only where it can
		// fall, so a frame shades as few pixels as it can (cheap phones, §12.3). Beside the roll…
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		const radius = Math.max(f.axis.radius, 0.5);
		gl.useProgram(this.#band);
		this.#common(this.#band, f, size);
		gl.uniform2f(
			this.#u(this.#band, 'uBand'),
			0,
			radius * 1.9 + (f.sheet.x1 - f.sheet.x0) * 0.05 + 2
		);
		gl.drawElements(gl.TRIANGLES, this.#quad.count, gl.UNSIGNED_SHORT, 0);
		// …and, in a spread, on the other page, where the turned-over part comes to land (on the
		// sheet itself, its own shader adds that shadow).
		if (f.sheet.x0 > 0) {
			gl.useProgram(this.#shadow);
			this.#common(this.#shadow, f, size);
			gl.uniform2f(this.#u(this.#shadow, 'uSpan'), 0, f.sheet.x0);
			gl.drawElements(gl.TRIANGLES, this.#quad.count, gl.UNSIGNED_SHORT, 0);
		}

		// The sheet.
		gl.disable(gl.BLEND);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LESS);
		gl.useProgram(this.#sheet);
		this.#bindGrid(this.#sheetGrid);
		this.#common(this.#sheet, f, size);
		gl.uniform1f(this.#u(this.#sheet, 'uDepth'), Math.max(size[0], size[1]) * 2.5);
		gl.uniform1f(this.#u(this.#sheet, 'uBackPage'), f.back.kind === 'page' ? 1 : 0);
		gl.uniform1f(this.#u(this.#sheet, 'uInk'), f.back.kind === 'through' ? f.back.ink : 0);
		gl.uniform3f(this.#u(this.#sheet, 'uPaper'), ...f.paper);
		gl.uniform1i(this.#u(this.#sheet, 'uFront'), 0);
		gl.uniform1i(this.#u(this.#sheet, 'uBack'), 1);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, f.front.id);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, f.back.kind === 'page' ? f.back.texture.id : f.front.id);
		gl.drawElements(gl.TRIANGLES, this.#sheetGrid.count, gl.UNSIGNED_SHORT, 0);
		gl.activeTexture(gl.TEXTURE0);
	}

	/** Clears the canvas (nothing shows over the page). */
	clear() {
		const gl = this.#gl;
		if (gl.isContextLost()) return;
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}

	destroy() {
		const gl = this.#gl;
		for (const t of this.#textures) gl.deleteTexture(t);
		this.#textures = [];
		gl.getExtension('WEBGL_lose_context')?.loseContext();
	}
}
