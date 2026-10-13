<script lang="ts">
	import { resolve } from '$app/paths';
	import type { BookSummaryDto } from '@book/core';
	import { Badge, Button, IconButton, TextField } from '@book/ui';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookGrid from '$lib/components/BookGrid.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { getBackend } from '$lib/services';
	import { preferences } from '$lib/state/preferences.svelte';
	import { resource } from '$lib/state/resource.svelte';

	// The store (P1-STO-01): curated shelves, search across titles, authors and descriptions, and
	// every Book. "Hide AI-generated content" (P1-STO-05) takes AI-generated Books out of all of it.
	const store = resource(
		async () => {
			const backend = await getBackend();
			const [books, shelves] = await Promise.all([
				backend.catalogue.listBooks({ limit: 100 }),
				backend.catalogue.listShelves()
			]);
			return { books: books.items, shelves };
		},
		{ topics: ['catalogue', 'entitlements'] }
	);

	let query = $state('');
	let searched = $state<{ query: string; books: BookSummaryDto[] } | null>(null);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const q = query.trim();
		clearTimeout(searchTimer);
		if (!q) {
			searched = null;
			return;
		}
		searchTimer = setTimeout(async () => {
			const found = await (await getBackend()).catalogue.search(q, { limit: 100 });
			if (query.trim() === q) searched = { query: q, books: found.items };
		}, 200);
	});

	const hideAi = $derived(preferences.current.hideAiGenerated);
	const visible = (books: BookSummaryDto[]) =>
		hideAi ? books.filter((b) => b.aiUse !== 'generated') : books;
	const href = (book: BookSummaryDto) => resolve('/(app)/book/[slug]', { slug: book.slug });
</script>

<svelte:head><title>Store · Book Reader</title></svelte:head>

<div class="store">
	<PageHeader title="Store" subtitle="Books with Illustrations and Narration to go with them.">
		<Badge tone="simulated" icon="science">Simulated: no real money</Badge>
	</PageHeader>

	<form class="search" role="search" onsubmit={(e) => e.preventDefault()}>
		<TextField
			label="Search books and authors"
			type="search"
			leadingIcon="search"
			bind:value={query}
		>
			{#snippet trailing()}
				{#if query}
					<IconButton icon="close" size="small" label="Clear search" onclick={() => (query = '')} />
				{/if}
			{/snippet}
		</TextField>
	</form>

	<StatusView resource={store} what="The store">
		{#snippet loading()}<BookGrid skeleton={8} />{/snippet}
		{#snippet children({ books, shelves })}
			{#if searched}
				{@const results = visible(searched.books)}
				<section aria-labelledby="results-heading">
					<h2 id="results-heading" class="shelf-title" aria-live="polite">
						{results.length === 1 ? '1 book' : `${results.length} books`} for “{searched.query}”
					</h2>
					{#if results.length}
						<BookGrid label="Search results">
							{#each results as book (book.id)}<li><BookCard {book} href={href(book)} /></li>{/each}
						</BookGrid>
					{:else}
						<EmptyState
							icon="search"
							title="No books match"
							message="Try another word, or an author’s name."
						/>
					{/if}
				</section>
			{:else if !books.length}
				<EmptyState
					icon="storefront"
					title="Nothing in the store yet"
					message="Books appear here when authors publish them."
				/>
			{:else}
				{@const byId = new Map(books.map((b) => [b.id, b]))}
				{#each shelves as shelf (shelf.id)}
					{@const shelfBooks = visible(
						shelf.bookIds.map((id) => byId.get(id)).filter((b): b is BookSummaryDto => !!b)
					)}
					{#if shelfBooks.length}
						<section class="shelf" aria-labelledby={`${shelf.id}-heading`}>
							<h2 id={`${shelf.id}-heading`} class="shelf-title">{shelf.title}</h2>
							<p class="shelf-description">{shelf.description}</p>
							<ul class="row" aria-label={shelf.title}>
								{#each shelfBooks as book (book.id)}<li>
										<BookCard {book} href={href(book)} />
									</li>{/each}
							</ul>
						</section>
					{/if}
				{/each}

				<section class="designs" aria-labelledby="designs-heading">
					<div>
						<h2 id="designs-heading" class="shelf-title">Bookmark designs</h2>
						<p class="shelf-description">Ribbons for your bookmarks, in every book you read.</p>
					</div>
					<Button variant="tonal" icon="bookmark" href={resolve('/you/bookmarks')}
						>See designs</Button
					>
				</section>

				<section aria-labelledby="all-heading">
					<h2 id="all-heading" class="shelf-title">All books</h2>
					<BookGrid label="All books">
						{#each visible(books) as book (book.id)}<li>
								<BookCard {book} href={href(book)} />
							</li>{/each}
					</BookGrid>
				</section>
			{/if}
			{#if hideAi}
				<p class="hidden-note">
					AI-generated books are hidden. <a href={resolve('/you/settings')}>Change in Settings</a>
				</p>
			{/if}
		{/snippet}
	</StatusView>
</div>

<style>
	.store {
		display: grid;
		gap: var(--space-6);
	}

	.search {
		max-width: 32rem;
	}

	.shelf-title {
		margin: 0 0 var(--space-1);
		font-family: var(--font-display);
		font-size: var(--md-sys-typescale-title-large-size);
		font-weight: var(--md-sys-typescale-weight-regular);
	}

	.shelf-description {
		margin: 0 0 var(--space-4);
		color: var(--md-sys-color-on-surface-variant);
	}

	/* A shelf scrolls sideways on narrow screens, two to six covers wide. */
	.row {
		display: grid;
		grid-auto-columns: clamp(8.5rem, 28vw, 11rem);
		grid-auto-flow: column;
		gap: var(--space-4);
		margin: 0;
		padding: var(--space-2);
		margin-inline: calc(-1 * var(--space-2));
		overflow-x: auto;
		list-style: none;
		scroll-snap-type: x proximity;
		overscroll-behavior-x: contain;
	}

	.row li {
		scroll-snap-align: start;
	}

	.designs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-4);
		border-radius: var(--md-sys-shape-corner-large);
		background: var(--md-sys-color-surface-container);
	}

	.designs .shelf-description {
		margin: 0;
	}

	.hidden-note {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}
</style>
