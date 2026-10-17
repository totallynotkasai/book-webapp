<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '@book/ui';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookGrid from '$lib/components/BookGrid.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { formatDay, formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';
	import { Wishlist } from '$lib/store/wishlist.svelte';

	// You → Wishlist (P1-STO-06; plan §6 Phase 1.18 UX notes): Books saved for later, newest first.
	// A Book whose price drops sends a message to the inbox; getting a Book takes it off.
	const entries = resource(async () => (await getBackend()).wishlist.list(), {
		topics: ['wishlist', 'catalogue', 'entitlements', 'session']
	});
	const wishlist = new Wishlist();
</script>

<svelte:head><title>Wishlist · Book Reader</title></svelte:head>

<div class="page">
	<PageHeader
		title="Wishlist"
		subtitle="Books saved for later. When one costs less, your inbox will say."
		back={{ href: resolve('/you'), label: 'Back to You' }}
	>
		<Badge tone="simulated" icon="science">Simulated store</Badge>
	</PageHeader>

	<StatusView resource={entries} what="Your wishlist">
		{#snippet loading()}<BookGrid skeleton={4} />{/snippet}
		{#snippet empty()}
			<EmptyState
				icon="favorite"
				title="Your wishlist is empty"
				message="Tap the heart on a book in the store to save it for later."
			/>
		{/snippet}
		{#snippet children(list)}
			{#if list.length}
				<BookGrid label="Wishlist">
					{#each list as entry (entry.book.id)}
						<li>
							<BookCard
								book={entry.book}
								href={resolve('/(app)/book/[slug]', { slug: entry.book.slug })}
								detail={`${formatPrice(entry.book.price)} · added ${formatDay(entry.addedAt)}`}
								wishlist={wishlist.heart(entry.book)}
							/>
						</li>
					{/each}
				</BookGrid>
			{/if}
		{/snippet}
	</StatusView>
</div>

<style>
	.page {
		display: grid;
		gap: var(--space-4);
	}
</style>
