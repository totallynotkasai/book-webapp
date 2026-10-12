import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		name: 'tokens',
		// @material/material-color-utilities 0.4.0 has extensionless relative imports that Node's
		// ESM loader rejects (upstream issue #195), so Vite has to resolve it.
		server: { deps: { inline: ['@material/material-color-utilities'] } }
	}
});
