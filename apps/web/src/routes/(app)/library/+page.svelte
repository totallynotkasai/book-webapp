<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '@book/ui';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookGrid from '$lib/components/BookGrid.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { flags } from '$lib/flags';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';

	// P1-APP-01: the Library from backend-local. P1-APP-03 adds imported Books and Continue reading.
	const library = resource(async () => (await getBackend()).library.list({ limit: 100 }), {
		topics: ['entitlements', 'session']
	});
</script>

<svelte:head><title>Library · Book Reader</title></svelte:head>

<div>
	<PageHeader
		title="Library"
		subtitle="Your books. Everything you read and note stays on this device."
	/>

	<StatusView resource={library} what="Your library">
		{#snippet loading()}<BookGrid skeleton={6} />{/snippet}
		{#snippet empty()}
			<EmptyState
				icon="library_books"
				title="Your library is empty"
				message={flags.store
					? 'Find a free book in the store, or import an EPUB of your own.'
					: 'Import an EPUB of your own to start reading.'}
			>
				{#snippet actions()}
					{#if flags.store}
						<Button href={resolve('/store')} icon="storefront">Browse the store</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{/snippet}
		{#snippet children(page)}
			<BookGrid label="Your books">
				{#each page.items as entry (entry.book.id)}
					<li>
						<BookCard
							book={entry.book}
							href={resolve('/read/[bookId]', { bookId: entry.book.id })}
							showPrice={false}
						/>
					</li>
				{/each}
			</BookGrid>
		{/snippet}
	</StatusView>
</div>
