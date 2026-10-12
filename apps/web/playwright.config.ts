import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against built copies of the app, served statically as a host would serve
// them (DESIGN.md §12.4): the owner profile from build/ and the tester profile from build-tester/.
// WebKit is the stand-in for iOS until the backlog's iOS items (D-024).
// E2E_PORT moves both servers, so two checkouts (e.g. agent worktrees) can run side by side:
// a reused server on the default port may belong to another checkout.
const PORT = Number(process.env.E2E_PORT ?? 4173);
const OWNER = `http://127.0.0.1:${PORT}`;
const TESTER = `http://127.0.0.1:${PORT + 1}`;
const TESTER_SPECS = /tester\.spec\.ts/;

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: { trace: 'retain-on-failure' },
	projects: [
		{
			name: 'chromium',
			testIgnore: TESTER_SPECS,
			use: { ...devices['Desktop Chrome'], baseURL: OWNER }
		},
		{
			name: 'webkit',
			testIgnore: TESTER_SPECS,
			use: { ...devices['Desktop Safari'], baseURL: OWNER }
		},
		{
			name: 'tester-chromium',
			testMatch: TESTER_SPECS,
			use: { ...devices['Desktop Chrome'], baseURL: TESTER }
		},
		{
			name: 'tester-webkit',
			testMatch: TESTER_SPECS,
			use: { ...devices['Desktop Safari'], baseURL: TESTER }
		}
	],
	webServer: [
		{
			command: `node scripts/serve.mjs build ${PORT}`,
			url: OWNER,
			reuseExistingServer: !process.env.CI
		},
		{
			command: `node scripts/serve.mjs build-tester ${PORT + 1}`,
			url: TESTER,
			reuseExistingServer: !process.env.CI
		}
	]
});
