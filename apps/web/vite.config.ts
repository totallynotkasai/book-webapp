import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Static output: no server needed, deployable to any static host, and wrappable by
			// Capacitor for mobile. Switch to a server adapter when public book pages need SSR.
			adapter: adapter({ fallback: 'index.html' })
		})
	]
});
