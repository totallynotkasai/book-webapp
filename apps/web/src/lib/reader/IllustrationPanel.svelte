<script lang="ts">
	import { prefersReducedMotion } from '@book/ui';
	import { fade } from 'svelte/transition';
	import { IconButton } from '@book/ui';
	import IllustrationImage from './IllustrationImage.svelte';
	import type { BookIllustrations, Current } from './illustrations.svelte';

	/**
	 * The `per-page` and `spread` Illustration areas (§8.2; plan §6 Phase 1.4 UX notes).
	 * per-page: a panel left of the book; on compact screens a strip above it. spread: a wide area
	 * above the book, for double-page art; single pictures centred, or the previous and current
	 * side by side when there's room. Both collapse to a thumbnail strip, and crossfade slowly.
	 */
	interface Props {
		mode: 'per-page' | 'spread';
		/** Above the book (compact per-page, and spread) rather than beside it. */
		above: boolean;
		collapsed: boolean;
		currents: Current[];
		index: number;
		illustrations: BookIllustrations;
		/** Room for two pictures side by side (spread). */
		wide: boolean;
		onzoom: (current: Current) => void;
		oncollapse: (collapsed: boolean) => void;
	}

	let {
		mode,
		above,
		collapsed,
		currents,
		index = $bindable(),
		illustrations,
		wide,
		onzoom,
		oncollapse
	}: Props = $props();

	const current = $derived(currents[Math.min(index, currents.length - 1)]);
	const pair = $derived(
		mode === 'spread' &&
			wide &&
			current &&
			current.illustration.span === 'single' &&
			current.previous?.span === 'single'
			? [{ ...current, illustration: current.previous }, current]
			: current
				? [current]
				: []
	);
	const duration = $derived(prefersReducedMotion() ? 0 : 600);
</script>

<aside
	class={['panel', mode, { above, collapsed }]}
	aria-label="Illustration"
	data-testid="illustration-panel"
	data-start={current?.illustration.anchor.startOrdinal}
>
	<div class="bar">
		{#if current}
			<span class="name">{current.pack.name}</span>
		{:else}
			<span class="name muted">No picture yet</span>
		{/if}
		{#if currents.length > 1}
			<IconButton
				size="small"
				icon="chevron_left"
				label="Previous pack"
				onclick={() => (index = (index - 1 + currents.length) % currents.length)}
			/>
			<IconButton
				size="small"
				icon="chevron_right"
				label="Next pack"
				onclick={() => (index = (index + 1) % currents.length)}
			/>
		{/if}
		{#if above}
			<IconButton
				size="small"
				icon={collapsed ? 'keyboard_arrow_down' : 'keyboard_arrow_up'}
				label={collapsed ? 'Show the picture' : 'Make the picture smaller'}
				onclick={() => oncollapse(!collapsed)}
			/>
		{/if}
	</div>
	<div class="pictures">
		{#each pair as item (`${item.pack.id}/${item.illustration.id}`)}
			<button
				type="button"
				class="picture"
				in:fade={{ duration }}
				out:fade={{ duration }}
				aria-label={`Zoom: ${item.illustration.alt}`}
				data-start={item.illustration.anchor.startOrdinal}
				onclick={() => onzoom(item)}
			>
				<IllustrationImage
					{illustrations}
					packId={item.pack.id}
					illustration={item.illustration}
					width={collapsed ? 120 : mode === 'spread' ? 900 : 480}
				/>
			</button>
		{:else}
			<p class="empty">The first picture appears when you reach its page.</p>
		{/each}
	</div>
	{#if current && !collapsed && current.illustration.caption}
		<p class="caption">{current.illustration.caption}</p>
	{/if}
</aside>

<style>
	.panel {
		position: absolute;
		z-index: 3;
		display: grid;
		/* The picture row takes what's left, never more: pictures shrink to fit it. */
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3) var(--space-3);
		overflow: hidden;
		background: var(--md-sys-color-surface-container-low);
		color: var(--md-sys-color-on-surface);
		font-family: var(--font-ui);
	}

	/* per-page beside the book: the left edge, under the top bar. */
	.panel:not(.above) {
		top: calc(var(--safe-top) + 56px);
		bottom: calc(var(--safe-bottom) + 64px);
		left: var(--safe-left);
		width: var(--panel-width);
		border-right: 1px solid var(--md-sys-color-outline-variant);
	}

	/* Above the book: compact per-page, and spread. */
	.panel.above {
		top: calc(var(--safe-top) + 56px);
		right: var(--safe-right);
		left: var(--safe-left);
		height: var(--panel-height);
		border-bottom: 1px solid var(--md-sys-color-outline-variant);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 32px;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: var(--md-sys-typescale-label-large-size);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.muted {
		color: var(--md-sys-color-on-surface-variant);
	}

	.pictures {
		position: relative;
		display: flex;
		justify-content: center;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	.picture {
		display: grid;
		place-items: center;
		height: 100%;
		min-width: 0;
		min-height: 0;
		max-width: 100%;
		padding: 0;
		border: none;
		background: transparent;
		cursor: zoom-in;
	}

	/* Crossfades stack the old and new pictures in the same place. */
	.pictures > .picture:only-child,
	.per-page .picture {
		grid-area: 1 / 1;
	}

	.per-page .pictures {
		display: grid;
		place-items: center;
	}

	.per-page .picture {
		width: 100%;
	}

	/* Fill the height and keep the shape, but never wider than the room. */
	.picture :global(.frame) {
		height: 100%;
		max-width: 100%;
		max-height: 100%;
		background-color: #fff;
	}

	.picture:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 2px;
	}

	.collapsed .caption {
		display: none;
	}

	.caption {
		margin: 0;
		overflow: hidden;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		color: var(--md-sys-color-on-surface-variant);
		font-family: var(--font-literata);
		font-size: var(--md-sys-typescale-body-small-size);
		font-style: italic;
	}

	.empty {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
		text-align: center;
	}
</style>
