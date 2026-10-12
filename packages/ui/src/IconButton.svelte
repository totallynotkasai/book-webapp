<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	interface Props extends Omit<HTMLButtonAttributes, 'class' | 'children'> {
		icon: IconName;
		/** Required: the button has no visible text (§11.7 labelled controls). */
		label: string;
		variant?: 'standard' | 'filled' | 'tonal' | 'outlined';
		/** Makes it a toggle button (`aria-pressed`). */
		selected?: boolean;
		/** Icon shown while selected, e.g. a filled form. */
		selectedIcon?: IconName;
		/** Renders a link. */
		href?: string;
		size?: 'small' | 'medium';
		/** A small dot, e.g. "a new Illustration is available". */
		dot?: boolean;
		class?: string;
	}

	let {
		icon,
		label,
		variant = 'standard',
		selected,
		selectedIcon,
		href,
		size = 'medium',
		dot = false,
		class: className,
		type = 'button',
		...rest
	}: Props = $props();

	const toggle = $derived(selected !== undefined);
	const shown = $derived(selected && selectedIcon ? selectedIcon : icon);
</script>

<svelte:element
	this={href === undefined ? 'button' : 'a'}
	{href}
	type={href === undefined ? type : undefined}
	class={['icon-button', variant, size, className, { selected }]}
	aria-label={label}
	aria-pressed={toggle && href === undefined ? Boolean(selected) : undefined}
	{...rest}
>
	<Icon name={shown} size={size === 'small' ? 20 : 24} />
	{#if dot}<span class="dot" aria-hidden="true"></span>{/if}
</svelte:element>

<style>
	.icon-button {
		position: relative;
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 40px;
		height: 40px;
		padding: 0;
		border: none;
		border-radius: var(--md-sys-shape-corner-full);
		background: transparent;
		color: var(--md-sys-color-on-surface-variant);
		cursor: pointer;
		isolation: isolate;
		text-decoration: none;
		-webkit-tap-highlight-color: transparent;
	}

	.icon-button.small {
		width: 32px;
		height: 32px;
	}

	/* 48 px touch target (§11.7). */
	.icon-button::after {
		content: '';
		position: absolute;
		inset: -4px;
	}

	.small::after {
		inset: -8px;
	}

	.icon-button::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border-radius: inherit;
		background: currentColor;
		opacity: 0;
		transition: opacity var(--duration-fast) var(--easing-standard);
	}

	.icon-button:hover::before {
		opacity: var(--md-sys-state-hover);
	}

	.icon-button:focus-visible::before,
	.icon-button:active::before {
		opacity: var(--md-sys-state-pressed);
	}

	.icon-button:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 2px;
	}

	.standard.selected {
		color: var(--md-sys-color-primary);
	}

	.filled {
		background: var(--md-sys-color-surface-container-highest);
		color: var(--md-sys-color-primary);
	}

	.filled.selected,
	.filled:not([aria-pressed]) {
		background: var(--md-sys-color-primary);
		color: var(--md-sys-color-on-primary);
	}

	.tonal {
		background: var(--md-sys-color-surface-container-highest);
		color: var(--md-sys-color-on-surface-variant);
	}

	.tonal.selected,
	.tonal:not([aria-pressed]) {
		background: var(--md-sys-color-secondary-container);
		color: var(--md-sys-color-on-secondary-container);
	}

	.outlined {
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline);
	}

	.outlined.selected {
		box-shadow: none;
		background: var(--md-sys-color-inverse-surface);
		color: var(--md-sys-color-inverse-on-surface);
	}

	.icon-button:disabled {
		cursor: default;
		color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
		background: transparent;
	}

	.icon-button:disabled::before {
		display: none;
	}

	.dot {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--md-sys-color-error);
		box-shadow: 0 0 0 2px var(--md-sys-color-surface);
	}
</style>
