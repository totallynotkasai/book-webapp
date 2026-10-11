import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		// IPv4 loopback, so `adb reverse tcp:5173 tcp:5173` reaches it from a USB-connected phone.
		// `npm run dev:host` overrides this to listen on the LAN for the phone's browser over Wi-Fi.
		host: '127.0.0.1'
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
			adapter: adapter({ fallback: 'index.html' })
		})
	]
});
