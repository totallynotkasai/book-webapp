<script lang="ts" generics="V extends string">
	import { ToggleGroup } from 'bits-ui';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	interface Option {
		value: V;
		label: string;
		icon?: IconName;
		disabled?: boolean;
	}

	interface Props {
		options: readonly Option[];
		value: V;
		/** Names the group for screen readers ("Theme"). */
		label: string;
		onchange?: (value: V) => void;
		disabled?: boolean;
		/** Hide labels and show icons only (labels stay for screen readers). */
		iconsOnly?: boolean;
		class?: string;
	}

	let {
		options,
		value = $bindable(),
		label,
		onchange,
		disabled = false,
		iconsOnly = false,
		class: className
	}: Props = $props();
</script>

<!-- A segmented button always has one choice, so attempts to clear it are ignored. -->
<ToggleGroup.Root
	type="single"
	bind:value={
		() => value,
		(next) => {
			if (!next || next === value) return;
			value = next as V;
			onchange?.(next as V);
		}
	}
	{disabled}
>
	{#snippet child({ props })}
		<div
			{...props}
			class={['segmented', className, { 'icons-only': iconsOnly }]}
			role="radiogroup"
			aria-label={label}
		>
			{#each options as option (option.value)}
				<ToggleGroup.Item value={option.value} disabled={option.disabled}>
					{#snippet child({ props: itemProps, pressed })}
						<button
							{...itemProps}
							aria-label={iconsOnly ? option.label : undefined}
							class={['segment', { pressed }]}
						>
							{#if pressed}
								<span class="check"><Icon name="check" size={18} /></span>
							{:else if option.icon}
								<span class="option-icon"><Icon name={option.icon} size={18} /></span>
							{/if}
							{#if !iconsOnly}<span class="text">{option.label}</span>{/if}
						</button>
					{/snippet}
				</ToggleGroup.Item>
			{/each}
		</div>
	{/snippet}
</ToggleGroup.Root>

<style>
	.segmented {
		display: inline-flex;
		max-width: 100%;
		border-radius: var(--md-sys-shape-corner-full);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline);
	}

	.segment {
		position: relative;
		display: inline-flex;
		flex: 1 1 auto;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-width: 48px;
		min-height: var(--touch-target);
		padding: 0 var(--space-3);
		overflow: hidden;
		border: none;
		border-inline-start: 1px solid var(--md-sys-color-outline);
		background: transparent;
		color: var(--md-sys-color-on-surface);
		font-family: var(--font-ui);
		font-size: var(--md-sys-typescale-label-large-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		cursor: pointer;
		isolation: isolate;
		transition: background-color var(--duration-fast) var(--easing-standard);
	}

	.segment:first-child {
		border-inline-start: none;
		border-start-start-radius: var(--md-sys-shape-corner-full);
		border-end-start-radius: var(--md-sys-shape-corner-full);
	}

	.segment:last-child {
		border-start-end-radius: var(--md-sys-shape-corner-full);
		border-end-end-radius: var(--md-sys-shape-corner-full);
	}

	.segment::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border-radius: inherit;
		background: currentColor;
		opacity: 0;
	}

	.segment:hover::before {
		opacity: var(--md-sys-state-hover);
	}

	.segment:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: -3px;
		z-index: 1;
	}

	.text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.option-icon,
	.check {
		display: inline-flex;
	}

	/* Narrow: labels matter more than icons; the filled segment still marks the choice. */
	@media (max-width: 420px) {
		.segmented:not(.icons-only) .option-icon,
		.segmented:not(.icons-only) .check {
			display: none;
		}

		.segment {
			padding: 0 var(--space-2);
		}
	}

	.pressed {
		background: var(--md-sys-color-secondary-container);
		color: var(--md-sys-color-on-secondary-container);
	}

	.segment:disabled {
		cursor: default;
		color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
	}
</style>
