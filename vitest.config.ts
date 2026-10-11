import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			'packages/*',
			// Repo-level checks, such as the import-boundary lint rules.
			{ test: { name: 'repo', include: ['tests/**/*.test.ts'], testTimeout: 30_000 } },
			// Pure TypeScript in the web app (no Svelte components; those get @testing-library in P1-UI-02).
			{ test: { name: 'web', include: ['apps/web/src/**/*.test.ts'] } }
		]
	}
});
