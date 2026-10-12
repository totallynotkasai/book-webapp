<script lang="ts">
	import { Icon, type IconName } from '@book/ui';
	import type { Snippet } from 'svelte';

	interface Props {
		icon: IconName;
		title: string;
		/** Says what to do next (§11.6). */
		message: string;
		actions?: Snippet;
	}

	let { icon, title, message, actions }: Props = $props();
</script>

<div class="empty-state">
	<span class="icon"><Icon name={icon} size={36} /></span>
	<p class="title">{title}</p>
	<p class="message">{message}</p>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.empty-state {
		display: grid;
		justify-items: center;
		gap: var(--space-2);
		max-width: 28rem;
		margin: var(--space-7) auto;
		padding: var(--space-5);
		text-align: center;
	}

	.icon {
		display: grid;
		place-items: center;
		width: 72px;
		height: 72px;
		margin-bottom: var(--space-2);
		border-radius: 50%;
		background: var(--md-sys-color-secondary-container);
		color: var(--md-sys-color-on-secondary-container);
	}

	p {
		margin: 0;
	}

	.title {
		font-family: var(--font-display);
		font-size: var(--md-sys-typescale-title-large-size);
		line-height: var(--md-sys-typescale-title-large-line-height);
	}

	.message {
		color: var(--md-sys-color-on-surface-variant);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
</style>
