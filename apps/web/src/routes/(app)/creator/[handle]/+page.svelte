<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button, Skeleton } from '@book/ui';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookGrid from '$lib/components/BookGrid.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';

	// P1-APP-01: read-only Creator profile. Tip and Subscribe arrive with P1-STO-04; follow with P1-COM-02.
	const creator = resource(() => {
		const handle = page.params.handle ?? '';
		return getBackend().then((b) => b.catalogue.getCreator(handle));
	});
	const books = resource(
		() => {
			const handle = page.params.handle ?? '';
			return getBackend().then((b) => b.catalogue.listCreatorBooks(handle, { limit: 100 }));
		},
		{ topics: ['catalogue'] }
	);
</script>

<svelte:head><title>{creator.data?.displayName ?? 'Creator'} · Book Reader</title></svelte:head>

<div>
	<StatusView resource={creator} what="This creator">
		{#snippet loading()}
			<Skeleton width="50%" height="2rem" />
			<Skeleton width="80%" />
		{/snippet}
		{#snippet children(profile)}
			<PageHeader
				title={profile.displayName}
				subtitle={profile.bio}
				back={{ href: resolve('/store'), label: 'Back to the store' }}
			>
				{#snippet actions()}
					<Button variant="tonal" icon="volunteer_activism" disabled>Tip</Button>
					<Button icon="card_membership" disabled>Subscribe</Button>
				{/snippet}
			</PageHeader>
		{/snippet}
	</StatusView>

	<h2>Books</h2>
	<StatusView resource={books} what="Their books">
		{#snippet loading()}<BookGrid skeleton={4} />{/snippet}
		{#snippet empty()}
			<EmptyState icon="menu_book" title="No books yet" message="Their books will appear here." />
		{/snippet}
		{#snippet children(list)}
			<BookGrid label="Books">
				{#each list.items as book (book.id)}
					<li><BookCard {book} href={resolve('/(app)/book/[slug]', { slug: book.slug })} /></li>
				{/each}
			</BookGrid>
		{/snippet}
	</StatusView>
</div>

<style>
	h2 {
		margin: var(--space-6) 0 var(--space-4);
		font-family: var(--font-display);
		font-size: var(--md-sys-typescale-title-large-size);
		font-weight: var(--md-sys-typescale-weight-regular);
	}
</style>
