import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

// Component tests in jsdom with @testing-library/svelte: keyboard, focus and reduced motion for
// every component (DESIGN.md P1-UI-02).
export default defineConfig({
	// svelteTesting: browser conditions, cleanup, and compiling the library's own runes code.
	plugins: [svelte({ configFile: false }), svelteTesting()],
	resolve: { conditions: ['browser'] },
	test: {
		name: 'ui',
		include: ['src/**/*.test.ts'],
		environment: 'jsdom',
		setupFiles: ['../../tests/setup-dom.ts']
	}
});
