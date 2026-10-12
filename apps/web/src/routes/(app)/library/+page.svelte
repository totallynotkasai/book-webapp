<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '@book/ui';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookGrid from '$lib/components/BookGrid.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { flags } from '$lib/flags';
	import ImportDialog from '$lib/library/ImportDialog.svelte';
	import { loadLibrary, type LibraryItem } from '$lib/library/library';
	import { resource } from '$lib/state/resource.svelte';

	// P1-APP-03: one Library list (owned catalogue Books and imports) with Continue reading.
	const library = resource(loadLibrary, { topics: ['entitlements', 'session'] });
	let importer = $state<ImportDialog>();

	const percent = (item: LibraryItem) =>
		item.progress ? `${Math.max(1, Math.round(item.progress.progression * 100))}% read` : undefined;
</script>

<svelte:head><title>Library · Book Reader</title></svelte:head>

<div>
	<PageHeader
		title="Library"
		subtitle="Your books. Everything you read and note stays on this device."
	>
		{#snippet actions()}
			<Button variant="tonal" icon="upload" onclick={() => importer?.start()}>Import EPUB</Button>
		{/snippet}
	</PageHeader>

	<StatusView resource={library} what="Your library" isEmpty={(view) => view.items.length === 0}>
		{#snippet loading()}<BookGrid skeleton={6} />{/snippet}
		{#snippet empty()}
			{#if library.data?.backendError}
				<ErrorState
					error={library.data.backendError}
					what="Your library"
					onretry={library.refresh}
				/>
			{/if}
			<EmptyState
				icon="library_books"
				title="Your library is empty"
				message={flags.store
					? 'Find a free book in the store, or import an EPUB of your own.'
					: 'Import an EPUB of your own to start reading.'}
			>
				{#snippet actions()}
					<Button icon="upload" onclick={() => importer?.start()}>Import EPUB</Button>
					{#if flags.store}
						<Button variant="tonal" href={resolve('/store')} icon="storefront"
							>Browse the store</Button
						>
					{/if}
				{/snippet}
			</EmptyState>
		{/snippet}
		{#snippet children(view)}
			{#if view.backendError}
				<ErrorState
					error={view.backendError}
					what="Books from the store"
					onretry={library.refresh}
					inline
				/>
			{/if}
			{#if view.continueReading.length}
				<section aria-labelledby="continue-heading" class="shelf">
					<h2 id="continue-heading">Continue reading</h2>
					<BookGrid label="Continue reading">
						{#each view.continueReading as item (item.bookId)}
							<li>
								<BookCard
									book={{ ...item.book, coverUrl: item.coverUrl }}
									href={resolve('/read/[bookId]', { bookId: item.bookId })}
									detail={percent(item)}
								/>
							</li>
						{/each}
					</BookGrid>
				</section>
			{/if}
			<section aria-labelledby="all-heading" class="shelf">
				<h2 id="all-heading">All books</h2>
				<BookGrid label="All books">
					{#each view.items as item (item.bookId)}
						<li>
							<BookCard
								book={{ ...item.book, coverUrl: item.coverUrl }}
								href={resolve('/read/[bookId]', { bookId: item.bookId })}
								showPrice={false}
								detail={item.source === 'import' ? 'Imported' : percent(item)}
							/>
						</li>
					{/each}
				</BookGrid>
			</section>
		{/snippet}
	</StatusView>
</div>

<ImportDialog bind:this={importer} onimported={library.refresh} />

<style>
	.shelf + .shelf {
		margin-top: var(--space-6);
	}

	h2 {
		margin: 0 0 var(--space-4);
		font-family: var(--font-display);
		font-size: var(--md-sys-typescale-title-large-size);
		font-weight: var(--md-sys-typescale-weight-regular);
	}
</style>
