<script lang="ts">
	import { IconButton } from '@book/ui';
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		subtitle?: string;
		/** A back link for pages below a destination (a Book page, Settings). */
		back?: { href: string; label: string };
		actions?: Snippet;
		/** Extra content under the title (badges, meta). */
		children?: Snippet;
	}

	let { title, subtitle, back, actions, children }: Props = $props();
</script>

<header class="page-header">
	{#if back}<IconButton icon="arrow_back" label={back.label} href={back.href} />{/if}
	<div class="titles">
		<h1>{title}</h1>
		{#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
		{#if children}{@render children()}{/if}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
	.page-header {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
	}

	.titles {
		flex: 1;
		min-width: 0;
	}

	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--md-sys-typescale-headline-medium-size);
		line-height: var(--md-sys-typescale-headline-medium-line-height);
		font-weight: var(--md-sys-typescale-weight-regular);
		overflow-wrap: anywhere;
	}

	.subtitle {
		margin: var(--space-1) 0 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
