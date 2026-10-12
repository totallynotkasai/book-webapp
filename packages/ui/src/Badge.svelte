<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	interface Props {
		/** `simulated` marks anything that would involve money or servers (plan §8 rule 3). */
		tone?: 'neutral' | 'primary' | 'tertiary' | 'error' | 'simulated';
		icon?: IconName;
		children: Snippet;
		class?: string;
	}

	let { tone = 'neutral', icon, children, class: className }: Props = $props();
</script>

<span class={['badge', tone, className]}>
	{#if icon}<Icon name={icon} size={14} />{/if}
	{@render children()}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 2px var(--space-2);
		border-radius: var(--md-sys-shape-corner-small);
		font-family: var(--font-ui);
		font-size: var(--md-sys-typescale-label-small-size);
		line-height: var(--md-sys-typescale-label-small-line-height);
		font-weight: var(--md-sys-typescale-weight-medium);
		white-space: nowrap;
		vertical-align: middle;
	}

	.neutral {
		background: var(--md-sys-color-surface-container-highest);
		color: var(--md-sys-color-on-surface-variant);
	}

	.primary {
		background: var(--md-sys-color-primary-container);
		color: var(--md-sys-color-on-primary-container);
	}

	.tertiary {
		background: var(--md-sys-color-tertiary-container);
		color: var(--md-sys-color-on-tertiary-container);
	}

	.error {
		background: var(--md-sys-color-error-container);
		color: var(--md-sys-color-on-error-container);
	}

	.simulated {
		background: transparent;
		color: var(--md-sys-color-on-surface-variant);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline);
	}
</style>
