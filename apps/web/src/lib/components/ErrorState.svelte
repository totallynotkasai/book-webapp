<script lang="ts">
	import { Button, Icon } from '@book/ui';
	import type { DescribedError } from '$lib/errors';

	interface Props {
		error: DescribedError;
		/** What failed to load, for the heading ("Your library"). */
		what: string;
		onretry?: () => void;
		/** A slim banner above content that is still shown (data kept from before). */
		inline?: boolean;
	}

	let { error, what, onretry, inline = false }: Props = $props();

	// Offline says what still works (plan §8); other errors say what happened and how to fix it.
	const heading = $derived(error.offline ? 'You’re offline' : `${what} didn’t load`);
	const message = $derived(
		error.offline
			? inline
				? 'This may be out of date. Books you imported still work.'
				: 'Connect to see this. Books you imported still work.'
			: `${error.title}. ${error.message}`
	);
</script>

<div class={['error-state', { inline, offline: error.offline }]} role="alert">
	<Icon name={error.offline ? 'cloud_off' : 'error'} size={inline ? 20 : 40} />
	<div class="text">
		<p class="heading">{heading}</p>
		<p class="message">{message}</p>
	</div>
	{#if onretry && error.retry}
		<Button variant={inline ? 'text' : 'tonal'} icon="refresh" onclick={onretry}>Try again</Button>
	{/if}
</div>

<style>
	.error-state {
		display: grid;
		justify-items: center;
		gap: var(--space-3);
		max-width: 28rem;
		margin: var(--space-7) auto;
		padding: var(--space-5);
		text-align: center;
		color: var(--md-sys-color-on-surface);
	}

	.error-state > :global(svg) {
		color: var(--md-sys-color-error);
	}

	.offline > :global(svg) {
		color: var(--md-sys-color-on-surface-variant);
	}

	.inline {
		display: flex;
		align-items: center;
		max-width: none;
		margin: 0 0 var(--space-4);
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-high);
		text-align: start;
	}

	.text {
		flex: 1;
	}

	p {
		margin: 0;
	}

	.heading {
		font-size: var(--md-sys-typescale-title-medium-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.inline .heading {
		font-size: var(--md-sys-typescale-body-medium-size);
	}

	.message {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-medium-size);
	}
</style>
