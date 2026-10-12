<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '@book/ui';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookGrid from '$lib/components/BookGrid.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';

	// P1-APP-01 skeleton with real seed data, so density and proportions can be judged (plan §6).
	// Shelves and search come with P1-STO-01.
	const books = resource(async () => (await getBackend()).catalogue.listBooks({ limit: 100 }), {
		topics: ['catalogue']
	});
</script>

<svelte:head><title>Store · Book Reader</title></svelte:head>

<div>
	<PageHeader title="Store" subtitle="Books with Illustrations and Narration to go with them.">
		<Badge tone="simulated" icon="science">Simulated: no real money</Badge>
	</PageHeader>

	<StatusView resource={books} what="The store">
		{#snippet loading()}<BookGrid skeleton={8} />{/snippet}
		{#snippet empty()}
			<EmptyState
				icon="storefront"
				title="Nothing in the store yet"
				message="Books appear here when authors publish them."
			/>
		{/snippet}
		{#snippet children(page)}
			<h2 class="shelf">All books</h2>
			<BookGrid label="All books">
				{#each page.items as book (book.id)}
					<li><BookCard {book} href={resolve('/(app)/book/[slug]', { slug: book.slug })} /></li>
				{/each}
			</BookGrid>
		{/snippet}
	</StatusView>
</div>

<style>
	.shelf {
		margin: 0 0 var(--space-4);
		font-family: var(--font-display);
		font-size: var(--md-sys-typescale-title-large-size);
		font-weight: var(--md-sys-typescale-weight-regular);
	}
</style>
