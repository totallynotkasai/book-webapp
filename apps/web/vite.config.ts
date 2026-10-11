import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
// SPIKE P0-10: m3-svelte's styles need this build step (ADR-005). Remove it with the spike code.
import { functionsMixins } from 'vite-plugin-functions-mixins';

// SPIKE P0-10: the plugin looks for each dependency in <cwd>/node_modules, but npm workspaces hoist
// m3-svelte to the repo root, so point it there relative to wherever the build runs from.
const m3Svelte = relative(
	join(process.cwd(), 'node_modules'),
	fileURLToPath(new URL('../../node_modules/m3-svelte', import.meta.url))
);

export default defineConfig(({ mode }) => {
	// `vite build --mode tester` (npm run build:tester) writes the tester profile beside the owner one.
	const out = mode === 'tester' ? 'build-tester' : 'build';
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
		// SPIKE P0-10: pre-bundled m3-svelte skips the plugin's transform in dev (unstyled buttons).
		optimizeDeps: { exclude: ['m3-svelte'] },
		plugins: [
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},

				// Static output: no server needed, deployable to any static host, and wrappable by
				// Capacitor for mobile. Switch to a server adapter when public book pages need SSR.
				adapter: adapter({ pages: out, assets: out, fallback: 'index.html' })
			}),
			// SPIKE P0-10: expands m3-svelte's @mixin, @apply and CSS --function() calls at build time.
			functionsMixins({ deps: [m3Svelte] })
		]
	};
});
