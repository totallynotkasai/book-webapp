<script lang="ts">
	import type { BookSummaryDto } from '@book/core';
	import { formatPrice } from '$lib/format';
	import AiLabel from './AiLabel.svelte';
	import BookCover from './BookCover.svelte';

	interface Props {
		book: BookSummaryDto;
		href: string;
		/** Show the price (store) or not (library). */
		showPrice?: boolean;
		/** A line under the title instead of the price, e.g. "Chapter 3 · 24%". */
		detail?: string;
	}

	let { book, href, showPrice = true, detail }: Props = $props();
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass a resolved href -->
<a class="book-card" {href}>
	<BookCover title={book.title} creatorName={book.creatorName} coverUrl={book.coverUrl} />
	<span class="title">{book.title}</span>
	<span class="creator">{book.creatorName}</span>
	<span class="meta">
		{#if detail}<span>{detail}</span>{:else if showPrice}<span class="price"
				>{formatPrice(book.price)}</span
			>{/if}
		<AiLabel aiUse={book.aiUse} />
	</span>
</a>

<style>
	.book-card {
		display: grid;
		align-content: start;
		gap: var(--space-1);
		min-width: 0;
		padding: var(--space-2);
		margin: calc(-1 * var(--space-2));
		border-radius: var(--md-sys-shape-corner-medium);
		color: var(--md-sys-color-on-surface);
		text-decoration: none;
	}

	.book-card:hover {
		background: color-mix(in srgb, var(--md-sys-color-on-surface) 6%, transparent);
	}

	.book-card:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 0;
	}

	.book-card > :global(.cover) {
		margin-bottom: var(--space-2);
	}

	.title {
		display: -webkit-box;
		overflow: hidden;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		font-size: var(--md-sys-typescale-title-small-size);
		line-height: var(--md-sys-typescale-title-small-line-height);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.creator,
	.meta {
		font-size: var(--md-sys-typescale-body-small-size);
		line-height: var(--md-sys-typescale-body-small-line-height);
		color: var(--md-sys-color-on-surface-variant);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
	}

	.price {
		color: var(--md-sys-color-on-surface);
		font-weight: var(--md-sys-typescale-weight-medium);
	}
</style>
