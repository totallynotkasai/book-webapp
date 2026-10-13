import { defineConfig, devices } from '@playwright/test';

// P1-QA-01: the DESIGN.md §12.3 budgets at phone speed (e2e/phone.perf.ts), against the owner
// build. Chromium only: CPU and network throttling use the Chrome DevTools Protocol. One test at
// a time, so the measurements don't compete for the machine. `npm run test:perf`; PERF_CPU sets
// the slowdown (default 4).
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
	testDir: 'e2e',
	testMatch: /\.perf\.ts$/,
	workers: 1,
	retries: 0,
	timeout: 120_000,
	reporter: 'list',
	use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
	webServer: {
		command: `node scripts/serve.mjs build ${PORT}`,
		url: `http://127.0.0.1:${PORT}`,
		reuseExistingServer: true
	}
});
