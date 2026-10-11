import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			'packages/*',
			// Repo-level checks, such as the import-boundary lint rules.
			{ test: { name: 'repo', include: ['tests/**/*.test.ts'], testTimeout: 30_000 } }
		]
	}
});
