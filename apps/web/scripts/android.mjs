// Builds the Android app and installs it on a connected phone or emulator over adb.
//
//   node scripts/android.mjs      The owner's debug build (app ID …bookpoc.dev) of build/. Run
//                                 `npm run cap:sync` first; `npm run cap:android` does both.
//   node scripts/android.mjs --web build-tester --release --no-install
//                                 The tester APK (`npm run apk:tester`): copies build-tester/
//                                 into the app, signs it with the PoC key (D-030) and writes
//                                 build-apk/book-reader-poc.apk. Leave out --no-install to
//                                 install it too.
//
// Finds the tools itself, so it works without changing PATH:
//   JDK 21 (Capacitor 8 needs it): JAVA_HOME if it is 21, else Android Studio's downloaded
//   ~/.jdks/jbr-21*, else Android Studio's bundled jbr if that is 21.
//   Android SDK: ANDROID_HOME, else %LOCALAPPDATA%\Android\Sdk (Windows) or ~/Library/Android/sdk.
//   Device: ANDROID_SERIAL if set, else the only connected device.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ID = 'io.github.totallynotkasai.bookpoc';
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(appDir, 'android');
const isWindows = platform() === 'win32';

const args = process.argv.slice(2);
const release = args.includes('--release');
const install = !args.includes('--no-install');
const webDir = args.includes('--web') ? args[args.indexOf('--web') + 1] : undefined;

function javaMajor(javaHome) {
	const java = join(javaHome, 'bin', isWindows ? 'java.exe' : 'java');
	if (!existsSync(java)) return undefined;
	const result = spawnSync(java, ['-version'], { encoding: 'utf8' });
	const match = /version "(\d+)/.exec(result.stderr ?? '');
	return match ? Number(match[1]) : undefined;
}

function findJdk21() {
	const candidates = [process.env.JAVA_HOME];
	const jdks = join(homedir(), '.jdks');
	if (existsSync(jdks)) {
		for (const name of readdirSync(jdks).sort().reverse()) {
			if (/21/.test(name)) candidates.push(join(jdks, name));
		}
	}
	candidates.push(
		'C:\\Program Files\\Android\\Android Studio\\jbr',
		'/Applications/Android Studio.app/Contents/jbr/Contents/Home'
	);
	return candidates.find((home) => home && javaMajor(home) === 21);
}

function findSdk() {
	const candidates = [
		process.env.ANDROID_HOME,
		process.env.ANDROID_SDK_ROOT,
		process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
		join(homedir(), 'Library', 'Android', 'sdk'),
		join(homedir(), 'Android', 'Sdk')
	];
	return candidates.find((dir) => dir && existsSync(join(dir, 'platform-tools')));
}

function fail(message) {
	console.error(`\n${message}\n`);
	process.exit(1);
}

const javaHome = findJdk21();
if (!javaHome) {
	fail(
		'No JDK 21 found. In Android Studio: Settings → Build Tools → Gradle → Gradle JDK → download a JDK 21, or set JAVA_HOME to one.'
	);
}
const sdk = findSdk();
if (!sdk) fail('No Android SDK found. Install Android Studio or set ANDROID_HOME.');

const adb = join(sdk, 'platform-tools', isWindows ? 'adb.exe' : 'adb');
const devices = install
	? execFileSync(adb, ['devices'], { encoding: 'utf8' })
			.split('\n')
			.slice(1)
			.map((line) => line.trim().split(/\s+/))
			.filter(([, state]) => state === 'device')
			.map(([serial]) => serial)
	: [];
const serial = process.env.ANDROID_SERIAL ?? (devices.length === 1 ? devices[0] : undefined);
if (install && !serial) {
	fail(
		devices.length === 0
			? 'No phone connected. Turn on USB debugging (or Wireless debugging and `adb pair`), then try again.'
			: `Several devices are connected (${devices.join(', ')}). Set ANDROID_SERIAL to choose one.`
	);
}

const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk };
// Relative to `cwd`, so a path with spaces never reaches the shell.
const gradlew = isWindows ? '.\\gradlew.bat' : './gradlew';
console.log(`JDK: ${javaHome}\nSDK: ${sdk}\nDevice: ${install ? serial : '(build only)'}\n`);

// Another web build (the tester profile) goes into the app first; capacitor.config.ts reads it.
if (webDir) {
	const sync = spawnSync('npx cap sync android', {
		cwd: appDir,
		env: { ...env, CAP_WEB_DIR: webDir },
		stdio: 'inherit',
		shell: true
	});
	if (sync.status !== 0) fail(`Couldn't copy ${webDir} into the Android app (see above).`);
}

const variant = release ? 'release' : 'debug';
const build = spawnSync(`${gradlew} assemble${release ? 'Release' : 'Debug'} --console=plain`, {
	cwd: androidDir,
	env,
	stdio: 'inherit',
	shell: isWindows
});
if (build.status !== 0) fail('The Android build failed (see above).');

const apk = join(androidDir, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`);
if (release) {
	mkdirSync(join(appDir, 'build-apk'), { recursive: true });
	copyFileSync(apk, join(appDir, 'build-apk', 'book-reader-poc.apk'));
	console.log('\nThe tester APK is apps/web/build-apk/book-reader-poc.apk.');
}
if (!install) process.exit(0);

// Debug builds have their own app ID, so they sit beside the tester app.
const appId = release ? APP_ID : `${APP_ID}.dev`;
execFileSync(adb, ['-s', serial, 'install', '-r', apk], { stdio: 'inherit' });
execFileSync(adb, ['-s', serial, 'shell', 'am', 'start', '-n', `${appId}/${APP_ID}.MainActivity`], {
	stdio: 'inherit'
});
console.log('\nInstalled and launched. Debug the WebView from chrome://inspect on this PC.');
