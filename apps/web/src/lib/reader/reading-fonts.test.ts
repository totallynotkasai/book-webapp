// @vitest-environment node
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The stylesheet's URL as the app's `?url` import gives it (Vitest doesn't process CSS itself).
// A getter, since the mocked module outlives `vi.resetModules()`.
const fontsCss = vi.hoisted(() => ({ url: '' }));
vi.mock('@book/tokens/fonts.css?url', () => ({
	get default() {
		return fontsCss.url;
	}
}));

/** The faces as a fresh page load gets them (the module fetches them once per load). */
async function readingFontFaces(origin: string) {
	vi.resetModules();
	vi.stubGlobal('location', new URL('/read/book-alice', origin));
	return (await import('./reading-fonts')).readingFontFaces();
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the reading fonts under `npm run dev`', () => {
	let server: ViteDevServer;
	let origin: string;

	beforeAll(async () => {
		// The web app's root without its plugins: serving files and stylesheets is Vite's own.
		server = await createServer({
			root: fileURLToPath(new URL('../../..', import.meta.url)),
			configFile: false,
			logLevel: 'silent',
			server: { host: '127.0.0.1', port: 0, hmr: false }
		});
		await server.listen();
		origin = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
		const asset = (await server.ssrLoadModule('@book/tokens/fonts.css?url')) as { default: string };
		fontsCss.url = asset.default;
	});

	afterAll(async () => {
		await server?.close();
	});

	it('gets the @font-face rules, not the JavaScript module Vite serves for the stylesheet', async () => {
		const css = await readingFontFaces(origin);
		expect(css).not.toContain('import.meta.hot');
		expect(css).toMatch(/@font-face\s*\{\s*font-family: 'Literata';/);
		// Absolute, since the Book frames are blob documents, and served by the dev server.
		const literata = /url\("([^"]+\/literata-latin-wght-normal\.woff2)"\)/.exec(css)?.[1];
		expect(literata?.startsWith(`${origin}/`)).toBe(true);
		expect((await fetch(literata!)).status).toBe(200);
	});
});

describe('the reading fonts in a build', () => {
	const origin = 'https://reader.example';

	beforeAll(() => {
		fontsCss.url = '/_app/immutable/assets/fonts.Ab12.css';
	});

	it('fetches the stylesheet once and makes its URLs absolute', async () => {
		const fetch = vi.fn(async () => {
			return new Response(
				"@font-face { src: url('./literata.Cd34.woff2') } @font-face { src: url(/fonts/nunito.woff2) }"
			);
		});
		vi.stubGlobal('fetch', fetch);
		const faces = readingFontFaces(origin);
		expect(await faces).toBe(
			`@font-face { src: url("${origin}/_app/immutable/assets/literata.Cd34.woff2") } ` +
				`@font-face { src: url("${origin}/fonts/nunito.woff2") }`
		);
		const { readingFontFaces: again } = await import('./reading-fonts');
		await again();
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('leaves the Book in its fallback fonts when the stylesheet cannot be fetched', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
		expect(await readingFontFaces(origin)).toBe('');
	});
});
