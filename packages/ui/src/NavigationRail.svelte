<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import type { NavItem } from './types';

	interface Props {
		items: readonly NavItem[];
		label?: string;
		/** Above the destinations, e.g. the app's mark. */
		header?: Snippet;
		/** Pinned to the bottom, e.g. a developer panel link. */
		footer?: Snippet;
		class?: string;
	}

	let { items, label = 'Main', header, footer, class: className }: Props = $props();
</script>

<!-- Side navigation for medium and expanded windows (§11.5, IMPLEMENTATION-PLAN.md §5.1). -->
<nav class={['rail', className]} aria-label={label}>
	{#if header}<div class="header">{@render header()}</div>{/if}
	<div class="items">
		{#each items as item (item.href)}
			<a href={item.href} class="item" aria-current={item.active ? 'page' : undefined}>
				<span class="indicator">
					<Icon name={item.active ? (item.activeIcon ?? item.icon) : item.icon} />
				</span>
				<span class="label">{item.label}</span>
			</a>
		{/each}
	</div>
	{#if footer}<div class="footer">{@render footer()}</div>{/if}
</nav>

<style>
	.rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		width: calc(88px + var(--safe-left));
		height: 100%;
		padding: calc(var(--space-4) + var(--safe-top)) 0 calc(var(--space-4) + var(--safe-bottom));
		padding-left: var(--safe-left);
		background: var(--md-sys-color-surface);
	}

	.items {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-4);
	}

	.item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		width: 80px;
		min-height: 56px;
		color: var(--md-sys-color-on-surface-variant);
		text-decoration: none;
	}

	.indicator {
		display: grid;
		place-items: center;
		width: 56px;
		height: 32px;
		border-radius: var(--md-sys-shape-corner-full);
		transition: background-color var(--duration-fast) var(--easing-standard);
	}

	.item:hover .indicator {
		background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
	}

	.item[aria-current='page'] {
		color: var(--md-sys-color-on-surface);
	}

	.item[aria-current='page'] .indicator {
		background: var(--md-sys-color-secondary-container);
		color: var(--md-sys-color-on-secondary-container);
	}

	.item:focus-visible {
		outline: none;
	}

	.item:focus-visible .indicator {
		outline: 3px solid var(--md-sys-color-secondary);
	}

	.label {
		font-size: var(--md-sys-typescale-label-medium-size);
		line-height: var(--md-sys-typescale-label-medium-line-height);
		font-weight: var(--md-sys-typescale-weight-medium);
		text-align: center;
	}
</style>
