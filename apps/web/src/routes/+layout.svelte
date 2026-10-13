<script lang="ts">
	import '@book/tokens/fonts.css';
	import '@book/tokens/default-theme.css';
	import '@book/tokens/tokens.css';
	import '../app.css';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SnackbarHost } from '@book/ui';
	import favicon from '$lib/assets/favicon.svg';
	import { profile, rememberAreas } from '$lib/flags';
	import { getPlatform } from '$lib/platform';
	import { preferences } from '$lib/state/preferences.svelte';
	import { session } from '$lib/state/session.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import { applyTheme } from '$lib/theme';
	import { themeFromPreferences } from '@book/tokens';
	import { MediaQuery } from 'svelte/reactivity';

	let { children } = $props();

	const systemDark = new MediaQuery('prefers-color-scheme: dark');
	// The app layout's bottom navigation bar shows below 600 px (DESIGN.md §11.5).
	const compact = new MediaQuery('max-width: 599.98px');

	preferences.load();
	session.start();

	// The whole app follows the user's seed colour, mode and contrast (DESIGN.md §11.2). Until the
	// stored preferences load, app.html's cached theme stays on screen rather than flashing the
	// default one.
	$effect(() => {
		if (!preferences.loaded) return;
		applyTheme(themeFromPreferences(preferences.current.theme, systemDark.current));
	});

	// The strips behind the system bars, and the browser's toolbar where it has one, match the
	// page (P1-MOB-01): the reading page in a book; elsewhere the app's surface, and the bottom
	// navigation bar's colour below it on compact screens.
	$effect(() => {
		if (!preferences.loaded) return;
		void preferences.current.theme;
		void systemDark.current;
		const reading = page.route.id?.startsWith('/read/') ?? false;
		const style = getComputedStyle(document.documentElement);
		const token = (name: string) => style.getPropertyValue(name).trim();
		const top = token(reading ? '--reader-background' : '--md-sys-color-surface');
		const bottom =
			!reading && compact.current && page.route.id?.startsWith('/(app)')
				? token('--md-sys-color-surface-container')
				: top;
		if (top) getPlatform().systemBars.setColors({ top, bottom: bottom || top });
	});

	// Facilitator links in the Android tester app (bookpoc://open?areas=store, D-031). The web
	// build reads ?areas= as it starts (lib/flags.ts); flags are fixed for a run, so a change
	// restarts the app on the Library.
	$effect(() => {
		if (profile !== 'tester') return;
		return getPlatform().deepLinks.onOpen((url) => {
			if (rememberAreas(url)) location.replace(resolve('/library'));
		});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Book Reader</title>
</svelte:head>

{@render children()}

<SnackbarHost
	snackbar={snackbars.current}
	ondismiss={(id) => snackbars.dismiss(id)}
	onhold={() => snackbars.hold()}
	onrelease={() => snackbars.release()}
/>
