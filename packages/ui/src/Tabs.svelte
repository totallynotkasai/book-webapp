<script lang="ts" generics="V extends string">
	import { Tabs } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import type { TabItem } from './types';

	interface Props {
		items: readonly TabItem<V>[];
		value: V;
		/** Names the tab list for screen readers. */
		label: string;
		/** Renders the panel for the selected tab. */
		panel: Snippet<[V]>;
		onchange?: (value: V) => void;
		class?: string;
	}

	let { items, value = $bindable(), label, panel, onchange, class: className }: Props = $props();
</script>

<Tabs.Root
	{value}
	onValueChange={(next) => {
		value = next as V;
		onchange?.(next as V);
	}}
>
	{#snippet child({ props })}
		<div {...props} class={['tabs', className]}>
			<Tabs.List>
				{#snippet child({ props: listProps })}
					<div {...listProps} class="list" aria-label={label}>
						{#each items as item (item.value)}
							<Tabs.Trigger value={item.value}>
								{#snippet child({ props: triggerProps })}
									<button {...triggerProps} class="tab">
										{#if item.icon}<Icon name={item.icon} size={20} />{/if}
										<span>{item.label}</span>
										{#if item.count !== undefined}<span class="count">{item.count}</span>{/if}
									</button>
								{/snippet}
							</Tabs.Trigger>
						{/each}
					</div>
				{/snippet}
			</Tabs.List>
			{#each items as item (item.value)}
				<Tabs.Content value={item.value}>
					{#snippet child({ props: contentProps })}
						<div {...contentProps} class="panel">
							{#if item.value === value}{@render panel(item.value)}{/if}
						</div>
					{/snippet}
				</Tabs.Content>
			{/each}
		</div>
	{/snippet}
</Tabs.Root>

<style>
	.list {
		display: flex;
		overflow-x: auto;
		border-bottom: 1px solid var(--md-sys-color-outline-variant);
		scrollbar-width: none;
	}

	.tab {
		position: relative;
		display: inline-flex;
		flex: 1 0 auto;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: var(--touch-target);
		padding: 0 var(--space-4);
		border: none;
		background: transparent;
		color: var(--md-sys-color-on-surface-variant);
		font-family: var(--font-ui);
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		cursor: pointer;
	}

	.tab:hover {
		background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
	}

	.tab:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: -3px;
	}

	.tab[data-state='active'] {
		color: var(--md-sys-color-primary);
	}

	.tab[data-state='active']::after {
		content: '';
		position: absolute;
		right: var(--space-4);
		bottom: 0;
		left: var(--space-4);
		height: 3px;
		border-radius: 3px 3px 0 0;
		background: var(--md-sys-color-primary);
	}

	.count {
		min-width: 20px;
		padding: 0 6px;
		border-radius: var(--md-sys-shape-corner-full);
		background: var(--md-sys-color-surface-container-highest);
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-label-small-size);
	}

	.panel:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: -3px;
	}
</style>
