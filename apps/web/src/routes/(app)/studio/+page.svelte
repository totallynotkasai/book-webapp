<script lang="ts">
	import { resolve } from '$app/paths';
	import type { StudioBookDto } from '@book/core';
	import { Badge, Card, Skeleton } from '@book/ui';
	import AiLabel from '$lib/components/AiLabel.svelte';
	import BookCover from '$lib/components/BookCover.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';

	// P1-APP-01: the Studio dashboard, read-only. The backend refuses non-Creators with FORBIDDEN
	// itself (§10.6); the navigation only hides the link. Publishing arrives with P1-STU-01.
	const books = resource(async () => (await getBackend()).studio.listBooks({ limit: 100 }), {
		topics: ['studio', 'session']
	});

	const listingLabels: Record<StudioBookDto['listingState'], string> = {
		draft: 'Draft',
		listed: 'Published',
		delisted: 'Delisted'
	};
</script>

<svelte:head><title>Studio · Book Reader</title></svelte:head>

<div>
	<PageHeader title="Creator Studio" subtitle="Your books, their Illustrations and Narration.">
		<Badge tone="simulated" icon="science">Simulated: nothing leaves this device</Badge>
	</PageHeader>

	<section aria-labelledby="earnings-heading" class="tiles">
		<h2 id="earnings-heading" class="visually-hidden">Earnings</h2>
		{#each ['Sales this month', 'Tips', 'Subscribers'] as label (label)}
			<Card variant="outlined">
				<div class="tile">
					<span class="tile-label">{label}</span>
					<span class="tile-value">—</span>
					<span class="tile-note">Simulated figures arrive in phase 1.7</span>
				</div>
			</Card>
		{/each}
	</section>

	<h2>Your books</h2>
	<StatusView resource={books} what="Your books">
		{#snippet loading()}
			{#each [1, 2] as i (i)}<Skeleton height="5rem" shape="block" />{/each}
		{/snippet}
		{#snippet empty()}
			<EmptyState
				icon="upload"
				title="No books yet"
				message="Upload an EPUB to publish your first book. Uploading arrives in phase 1.7."
			/>
		{/snippet}
		{#snippet children(list)}
			<ul class="books">
				{#each list.items as book (book.id)}
					<li>
						<BookCover
							title={book.title}
							creatorName={book.creatorName}
							coverUrl={book.coverUrl}
							size="small"
						/>
						<div class="book-text">
							<a href={resolve('/(app)/book/[slug]', { slug: book.slug })}>{book.title}</a>
							<span class="meta">
								<Badge tone={book.listingState === 'listed' ? 'primary' : 'neutral'}>
									{listingLabels[book.listingState]}
								</Badge>
								<AiLabel aiUse={book.aiUse} />
								<span>{formatPrice(book.price)}</span>
							</span>
						</div>
					</li>
				{/each}
			</ul>
		{/snippet}
	</StatusView>
</div>

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: var(--space-3);
	}

	.tile {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-4);
	}

	.tile-label,
	.tile-note {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.tile-value {
		font-size: var(--md-sys-typescale-headline-small-size);
	}

	h2 {
		margin: var(--space-6) 0 var(--space-3);
		font-family: var(--font-display);
		font-size: var(--md-sys-typescale-title-large-size);
		font-weight: var(--md-sys-typescale-weight-regular);
	}

	.books {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.books li {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.book-text {
		display: grid;
		gap: var(--space-1);
	}

	.book-text a {
		color: var(--md-sys-color-on-surface);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
