<script lang="ts">
	import { Skeleton } from '@book/ui';
	import type { Snippet } from 'svelte';

	interface Props {
		/** Draws skeleton cards instead of children. */
		skeleton?: number;
		label?: string;
		children?: Snippet;
	}

	let { skeleton, label, children }: Props = $props();
</script>

<!-- A responsive grid of Book cards: 2 columns on a 360 px phone, more as the window grows. -->
<ul class="book-grid" aria-label={label}>
	{#if skeleton}
		{#each Array.from({ length: skeleton }, (_, i) => i) as i (i)}
			<li aria-hidden="true">
				<Skeleton shape="block" height="auto" class="cover-skeleton" />
				<Skeleton width="80%" />
				<Skeleton width="50%" />
			</li>
		{/each}
	{:else if children}
		{@render children()}
	{/if}
</ul>

<style>
	.book-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(9.5rem, 42vw), 1fr));
		gap: var(--space-5) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.book-grid :global(> li) {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
	}

	.book-grid :global(.cover-skeleton) {
		aspect-ratio: 2 / 3;
	}
</style>
