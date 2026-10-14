import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
	// `vite build --mode tester` (npm run build:tester) writes the tester profile beside the owner one.
	const out = mode === 'tester' ? 'build-tester' : 'build';
	// Static hosts that serve the app from a folder (GitHub Pages project sites: /book-webapp) set
	// BASE_PATH at build time (D-029). Empty serves it from the root, as Capacitor and E2E do.
	const base = (process.env.BASE_PATH ?? '').replace(/\/$/, '') as '' | `/${string}`;
	return {
		server: {
			// IPv4 loopback, so `adb reverse tcp:5173 tcp:5173` reaches it from a USB-connected phone.
			// `npm run dev:host` overrides this to listen on the LAN for the phone's browser over Wi-Fi.
			host: '127.0.0.1'
		},
		build: {
			// Seed and demo JSON is always fetched as a file, never inlined into the bundle (plan §4.3).
			assetsInlineLimit: (file) => (file.endsWith('.json') ? false : undefined)
		},
		plugins: [
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},

				// Static output: no server needed, deployable to any static host, and wrappable by
				// Capacitor for mobile. Switch to a server adapter when public book pages need SSR.
				adapter: adapter({ pages: out, assets: out, fallback: 'index.html' }),
				paths: { base }
			})
		]
	};
});
