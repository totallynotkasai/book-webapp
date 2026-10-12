<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	interface Props {
		label: string;
		/** `filter` toggles (`aria-pressed`); `input` can be removed; `assist` runs an action. */
		kind?: 'assist' | 'filter' | 'input';
		selected?: boolean;
		icon?: IconName;
		/** A swatch colour drawn before the label (e.g. a highlight colour). */
		swatch?: string;
		onclick?: () => void;
		/** Input chips: adds a remove button with this action. */
		onremove?: () => void;
		href?: string;
		disabled?: boolean;
		class?: string;
	}

	let {
		label,
		kind = 'assist',
		selected = false,
		icon,
		swatch,
		onclick,
		onremove,
		href,
		disabled = false,
		class: className
	}: Props = $props();
</script>

{#snippet inner()}
	{#if kind === 'filter' && selected}
		<Icon name="check" size={18} />
	{:else if icon}
		<Icon name={icon} size={18} />
	{/if}
	{#if swatch}<span class="swatch" style:background={swatch} aria-hidden="true"></span>{/if}
	<span>{label}</span>
{/snippet}

<span class={['chip', kind, className, { selected }]}>
	{#if href}
		<a {href} class="main">{@render inner()}</a>
	{:else}
		<button
			type="button"
			class="main"
			aria-pressed={kind === 'filter' ? selected : undefined}
			{disabled}
			{onclick}>{@render inner()}</button
		>
	{/if}
	{#if kind === 'input' && onremove}
		<button type="button" class="remove" aria-label={`Remove ${label}`} onclick={onremove}>
			<Icon name="close" size={18} />
		</button>
	{/if}
</span>

<style>
	.chip {
		position: relative;
		display: inline-flex;
		align-items: center;
		height: 32px;
		border-radius: var(--md-sys-shape-corner-small);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline);
		color: var(--md-sys-color-on-surface-variant);
		isolation: isolate;
	}

	.selected {
		box-shadow: none;
		background: var(--md-sys-color-secondary-container);
		color: var(--md-sys-color-on-secondary-container);
	}

	.main,
	.remove {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 100%;
		border: none;
		border-radius: inherit;
		background: transparent;
		color: inherit;
		font-family: var(--font-ui);
		font-size: var(--md-sys-typescale-label-large-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		text-decoration: none;
		cursor: pointer;
	}

	.main {
		padding: 0 var(--space-4);
	}

	.input .main {
		padding-inline-end: var(--space-2);
	}

	.remove {
		padding: 0 var(--space-2) 0 0;
	}

	/* 48 px touch targets (§11.7). */
	.main::after,
	.remove::after {
		content: '';
		position: absolute;
		inset: -8px 0;
	}

	.main:hover {
		background: color-mix(in srgb, currentColor 8%, transparent);
	}

	.main:focus-visible,
	.remove:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 2px;
	}

	.main:disabled {
		cursor: default;
		opacity: 0.38;
	}

	.swatch {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline);
	}
</style>
