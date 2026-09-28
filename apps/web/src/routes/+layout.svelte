<script lang="ts">
	import '@book/tokens/tokens.css';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { settings } from '$lib/settings.svelte';

	let { children } = $props();

	settings.load();

	$effect(() => {
		document.documentElement.dataset.theme = settings.current.theme;
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Book Reader</title>
</svelte:head>

{@render children()}
