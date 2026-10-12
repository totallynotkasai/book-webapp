<script lang="ts">
	import '@book/tokens/fonts.css';
	import '@book/tokens/default-theme.css';
	import '@book/tokens/tokens.css';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { preferences } from '$lib/state/preferences.svelte';
	import { applyTheme } from '$lib/theme';
	import { themeFromPreferences } from '@book/tokens';
	import { MediaQuery } from 'svelte/reactivity';

	let { children } = $props();

	const systemDark = new MediaQuery('prefers-color-scheme: dark');

	preferences.load();

	// The whole app follows the user's seed colour, mode and contrast (DESIGN.md §11.2).
	$effect(() => {
		applyTheme(themeFromPreferences(preferences.current.theme, systemDark.current));
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Book Reader</title>
</svelte:head>

{@render children()}
