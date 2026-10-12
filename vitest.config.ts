import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			'packages/*',
			// The web app's unit and component tests (its own config: SvelteKit, jsdom).
			'apps/web',
			// Repo-level checks, such as the import-boundary lint rules.
			{ test: { name: 'repo', include: ['tests/**/*.test.ts'], testTimeout: 30_000 } }
		]
	}
});
