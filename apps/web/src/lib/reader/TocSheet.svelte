<script lang="ts">
	import type { TocEntry } from '@book/core';
	import { AdaptiveSheet } from '@book/ui';
	import { tick } from 'svelte';

	// The table of contents (§4.1): a sheet from the start edge with the current Chapter marked.
	interface Props {
		open: boolean;
		entries: readonly TocEntry[];
		/** The entry the reader is in, by index. */
		currentIndex: number;
		onselect: (entry: TocEntry) => void;
	}

	let { open = $bindable(), entries, currentIndex, onselect }: Props = $props();
	let list = $state<HTMLElement>();

	$effect(() => {
		if (!open) return;
		void tick().then(() => {
			const current = list?.querySelector<HTMLElement>('[aria-current="location"]');
			current?.scrollIntoView({ block: 'center' });
			current?.focus();
		});
	});
</script>

<AdaptiveSheet bind:open title="Contents" side="start" height="full">
	<ol class="toc" bind:this={list}>
		{#each entries as entry, i (i)}
			<li style:--depth={entry.depth}>
				<button
					type="button"
					aria-current={i === currentIndex ? 'location' : undefined}
					onclick={() => {
						open = false;
						onselect(entry);
					}}
				>
					{entry.label || 'Untitled'}
				</button>
			</li>
		{/each}
	</ol>
</AdaptiveSheet>

<style>
	.toc {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	button {
		display: block;
		width: 100%;
		min-height: var(--touch-target);
		padding: var(--space-2) var(--space-3) var(--space-2)
			calc(var(--space-3) + var(--depth, 0) * var(--space-5));
		border: none;
		border-radius: var(--md-sys-shape-corner-full);
		background: transparent;
		color: var(--md-sys-color-on-surface-variant);
		font: inherit;
		font-size: var(--md-sys-typescale-body-large-size);
		text-align: start;
		cursor: pointer;
	}

	button:hover {
		background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
	}

	button:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: -3px;
	}

	button[aria-current='location'] {
		background: var(--md-sys-color-secondary-container);
		color: var(--md-sys-color-on-secondary-container);
		font-weight: var(--md-sys-typescale-weight-medium);
	}
</style>
