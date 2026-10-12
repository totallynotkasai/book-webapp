import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Unit and component tests for the web app: runes in .svelte.ts modules, components with
// @testing-library/svelte in jsdom. E2E lives in e2e/ with Playwright. The plain Svelte plugin is
// used rather than SvelteKit's, which looks for its config in the working directory (the repo root
// when Vitest runs every project); `$lib` is aliased by hand and `$app/*` is not available.
export default defineConfig({
	plugins: [svelte({ configFile: false })],
	// Svelte's browser build, so components mount in jsdom rather than rendering on the "server".
	resolve: {
		conditions: ['browser'],
		alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) }
	},
	test: {
		name: 'web',
		include: ['src/**/*.test.ts'],
		environment: 'jsdom',
		setupFiles: ['../../tests/setup-dom.ts'],
		// @material/material-color-utilities 0.4.0 has extensionless relative imports that Node's
		// ESM loader rejects (upstream issue #195), so Vite has to resolve it.
		server: { deps: { inline: ['@material/material-color-utilities'] } }
	}
});
