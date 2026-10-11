import type { CapacitorConfig } from '@capacitor/cli';

// The same static build as the web app, wrapped for Android (DESIGN.md §5.2, D-002).
// iOS is deferred (D-024, docs/BACKLOG.md IOS-01). The app ID is for the PoC only; the named
// product (OPEN-07) gets its own before any public Play Store listing.
const config: CapacitorConfig = {
	appId: 'io.github.totallynotkasai.bookpoc',
	appName: 'Book Reader (PoC)',
	webDir: 'build',
	android: {
		// Debug builds can be inspected from chrome://inspect on the PC.
		webContentsDebuggingEnabled: true
	}
};

export default config;
