import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against built copies of the app, served statically as a host would serve
// them (DESIGN.md §12.4). WebKit is the stand-in for iOS until the backlog's iOS items (D-024).
const OWNER_PORT = 4173;

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `http://127.0.0.1:${OWNER_PORT}`,
		trace: 'retain-on-failure'
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } }
	],
	webServer: {
		command: `node scripts/serve.mjs build ${OWNER_PORT}`,
		url: `http://127.0.0.1:${OWNER_PORT}`,
		reuseExistingServer: !process.env.CI
	}
});
