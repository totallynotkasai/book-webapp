<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';
	import Progress from './Progress.svelte';

	interface Props extends Omit<HTMLButtonAttributes, 'children' | 'class'> {
		variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';
		/** Leading icon. */
		icon?: IconName;
		trailingIcon?: IconName;
		/** A backend action is running: the button stays focusable but ignores presses (plan §8). */
		pending?: boolean;
		/** Destructive actions use the error colour. */
		danger?: boolean;
		/** Renders a link styled as a button. */
		href?: string;
		target?: string;
		rel?: string;
		download?: string | boolean;
		children: Snippet;
		class?: string;
	}

	let {
		variant = 'filled',
		icon,
		trailingIcon,
		pending = false,
		danger = false,
		href,
		type = 'button',
		children,
		class: className,
		onclick,
		...rest
	}: Props = $props();
</script>

<svelte:element
	this={href === undefined ? 'button' : 'a'}
	{href}
	type={href === undefined ? type : undefined}
	class={['button', variant, className, { pending, danger }]}
	aria-busy={pending || undefined}
	{...rest}
	onclick={(event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }) => {
		if (pending) {
			event.preventDefault();
			return;
		}
		onclick?.(event);
	}}
	role={href !== undefined && rest.disabled ? 'link' : undefined}
	aria-disabled={href !== undefined && rest.disabled ? 'true' : undefined}
>
	{#if pending}
		<Progress kind="circular" size={18} label="Working" />
	{:else if icon}
		<Icon name={icon} size={18} />
	{/if}
	<span class="label">{@render children()}</span>
	{#if trailingIcon}<Icon name={trailingIcon} size={18} />{/if}
</svelte:element>

<style>
	.button {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 40px;
		min-width: 48px;
		padding: 0 var(--space-5);
		border: none;
		border-radius: var(--md-sys-shape-corner-full);
		font-family: var(--font-ui);
		font-size: var(--md-sys-typescale-label-large-size);
		line-height: var(--md-sys-typescale-label-large-line-height);
		font-weight: var(--md-sys-typescale-weight-medium);
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
		isolation: isolate;
		transition:
			box-shadow var(--duration-fast) var(--easing-standard),
			background-color var(--duration-fast) var(--easing-standard);
		-webkit-tap-highlight-color: transparent;
	}

	/* 48 px touch target even though the visible button is 40 px tall (§11.7). */
	.button::after {
		content: '';
		position: absolute;
		inset: -4px 0;
	}

	/* State layer: the content colour over the container (M3). */
	.button::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border-radius: inherit;
		background: currentColor;
		opacity: 0;
		transition: opacity var(--duration-fast) var(--easing-standard);
	}

	.button:hover::before {
		opacity: var(--md-sys-state-hover);
	}

	.button:focus-visible::before,
	.button:active::before {
		opacity: var(--md-sys-state-pressed);
	}

	.button:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 2px;
	}

	.filled {
		background: var(--md-sys-color-primary);
		color: var(--md-sys-color-on-primary);
	}

	.filled.danger {
		background: var(--md-sys-color-error);
		color: var(--md-sys-color-on-error);
	}

	.tonal {
		background: var(--md-sys-color-secondary-container);
		color: var(--md-sys-color-on-secondary-container);
	}

	.elevated {
		background: var(--md-sys-color-surface-container-low);
		color: var(--md-sys-color-primary);
		box-shadow: var(--md-sys-elevation-1);
	}

	.outlined {
		background: transparent;
		color: var(--md-sys-color-primary);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline);
	}

	.text {
		background: transparent;
		color: var(--md-sys-color-primary);
		padding: 0 var(--space-3);
	}

	.outlined.danger,
	.text.danger {
		color: var(--md-sys-color-error);
	}

	.button:disabled,
	.button[aria-disabled='true'] {
		cursor: default;
		color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
		background: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent);
		box-shadow: none;
	}

	.text:disabled,
	.outlined:disabled {
		background: transparent;
	}

	.button:disabled::before {
		display: none;
	}

	.pending {
		cursor: progress;
	}

	.label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
