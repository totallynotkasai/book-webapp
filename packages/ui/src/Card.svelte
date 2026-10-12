<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		variant?: 'elevated' | 'filled' | 'outlined';
		/** Makes the whole card a link. Keep its contents free of other controls. */
		href?: string;
		/** Accessible name for a link card, if its text isn't enough. */
		label?: string;
		children: Snippet;
		class?: string;
	}

	let { variant = 'filled', href, label, children, class: className }: Props = $props();
</script>

{#if href}
	<a {href} class={['card', variant, 'interactive', className]} aria-label={label}>
		{@render children()}
	</a>
{:else}
	<div class={['card', variant, className]}>{@render children()}</div>
{/if}

<style>
	.card {
		position: relative;
		display: block;
		overflow: hidden;
		border-radius: var(--md-sys-shape-corner-medium);
		color: var(--md-sys-color-on-surface);
		text-decoration: none;
		isolation: isolate;
	}

	.elevated {
		background: var(--md-sys-color-surface-container-low);
		box-shadow: var(--md-sys-elevation-1);
	}

	.filled {
		background: var(--md-sys-color-surface-container-highest);
	}

	.outlined {
		background: var(--md-sys-color-surface);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline-variant);
	}

	.interactive {
		cursor: pointer;
		transition: box-shadow var(--duration-fast) var(--easing-standard);
	}

	.interactive::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		background: var(--md-sys-color-on-surface);
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--duration-fast) var(--easing-standard);
	}

	.interactive:hover::before {
		opacity: var(--md-sys-state-hover);
	}

	.interactive:active::before {
		opacity: var(--md-sys-state-pressed);
	}

	.interactive:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 2px;
	}
</style>
