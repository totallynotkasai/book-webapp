<script lang="ts">
	import '@book/tokens/tokens.css';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { preferences } from '$lib/preferences.svelte';
	import { themeAttribute } from '@book/tokens';
	import { MediaQuery } from 'svelte/reactivity';

	let { children } = $props();

	const systemDark = new MediaQuery('prefers-color-scheme: dark');

	preferences.load();

	$effect(() => {
		document.documentElement.dataset.theme = themeAttribute(
			preferences.current.theme,
			systemDark.current
		);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Book Reader</title>
</svelte:head>

{@render children()}
