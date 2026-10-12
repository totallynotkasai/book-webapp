<script lang="ts">
	import Icon from './Icon.svelte';
	import type { NavItem } from './types';

	interface Props {
		items: readonly NavItem[];
		/** Names the navigation landmark. */
		label?: string;
		class?: string;
	}

	let { items, label = 'Main', class: className }: Props = $props();
</script>

<!-- Bottom navigation for compact windows (§11.5, IMPLEMENTATION-PLAN.md §5.1). -->
<nav class={['bar', className]} aria-label={label}>
	{#each items as item (item.href)}
		<a href={item.href} class="item" aria-current={item.active ? 'page' : undefined}>
			<span class="indicator">
				<Icon name={item.active ? (item.activeIcon ?? item.icon) : item.icon} />
			</span>
			<span class="label">{item.label}</span>
		</a>
	{/each}
</nav>

<style>
	.bar {
		display: flex;
		justify-content: space-around;
		gap: var(--space-2);
		min-height: 80px;
		padding: var(--space-3) var(--space-2) calc(var(--space-4) + var(--safe-bottom));
		padding-inline: calc(var(--space-2) + var(--safe-left)) calc(var(--space-2) + var(--safe-right));
		background: var(--md-sys-color-surface-container);
	}

	.item {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		min-width: 48px;
		max-width: 120px;
		color: var(--md-sys-color-on-surface-variant);
		text-decoration: none;
		-webkit-tap-highlight-color: transparent;
	}

	.indicator {
		position: relative;
		display: grid;
		place-items: center;
		width: 64px;
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
