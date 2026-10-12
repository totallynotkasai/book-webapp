<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import Icon from './Icon.svelte';
	import IconButton from './IconButton.svelte';
	import type { IconName } from './icons';
	import type { MenuItem } from './types';

	interface Props {
		/** The trigger's accessible name ("More actions"). */
		label: string;
		icon?: IconName;
		/** Items; `'separator'` draws a divider. */
		items: (MenuItem | 'separator')[];
		align?: 'start' | 'end';
		class?: string;
	}

	let { label, icon = 'more_vert', items, align = 'end', class: className }: Props = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<IconButton {...props} {icon} {label} />
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content sideOffset={4} {align}>
			{#snippet child({ props, wrapperProps })}
				<div {...wrapperProps}>
					<div {...props} class={['menu', className]}>
						{#each items as item, i (i)}
							{#if item === 'separator'}
								<DropdownMenu.Separator>
									{#snippet child({ props: separatorProps })}
										<div {...separatorProps} class="separator"></div>
									{/snippet}
								</DropdownMenu.Separator>
							{:else}
								<DropdownMenu.Item disabled={item.disabled} onSelect={item.onselect}>
									{#snippet child({ props: itemProps })}
										<div {...itemProps} class={['item', { danger: item.danger }]}>
											{#if item.icon}<Icon name={item.icon} size={20} />{/if}
											<span>{item.label}</span>
										</div>
									{/snippet}
								</DropdownMenu.Item>
							{/if}
						{/each}
					</div>
				</div>
			{/snippet}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
	/* Bits UI copies the content's z-index onto its positioning wrapper, so it goes here: menus
	   open above sheets and dialogs (40-41). */
	.menu {
		position: relative;
		z-index: 50;
		min-width: 180px;
		max-width: 280px;
		padding: var(--space-2) 0;
		border-radius: var(--md-sys-shape-corner-extra-small);
		background: var(--md-sys-color-surface-container);
		color: var(--md-sys-color-on-surface);
		box-shadow: var(--md-sys-elevation-2);
		outline: none;
		animation: fade-in var(--duration-fast) var(--easing-standard);
	}

	.item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--touch-target);
		padding: 0 var(--space-4);
		font-size: var(--md-sys-typescale-label-large-size);
		cursor: pointer;
		outline: none;
		user-select: none;
	}

	.item :global(svg) {
		color: var(--md-sys-color-on-surface-variant);
	}

	.item[data-highlighted] {
		background: color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent);
	}

	.item[data-disabled] {
		cursor: default;
		opacity: 0.38;
	}

	.item.danger,
	.item.danger :global(svg) {
		color: var(--md-sys-color-error);
	}

	.separator {
		height: 1px;
		margin: var(--space-2) 0;
		background: var(--md-sys-color-outline-variant);
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
