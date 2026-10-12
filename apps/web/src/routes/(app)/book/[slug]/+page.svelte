<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Badge, Button, Skeleton } from '@book/ui';
	import AiLabel from '$lib/components/AiLabel.svelte';
	import BookCover from '$lib/components/BookCover.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';

	// P1-APP-01: read-only Book page. Buying and "Read sample" arrive with P1-STO-01 and P1-STO-02.
	const book = resource(
		() => {
			const slug = page.params.slug ?? '';
			return getBackend().then((b) => b.catalogue.getBook(slug));
		},
		{ topics: ['catalogue', 'entitlements'] }
	);

	const productLabels = {
		book: 'The book',
		illustration_pack: 'Illustrations',
		audio_track: 'Narration',
		cover: 'Cover',
		bookmark_design: 'Bookmark design',
		bundle: 'Complete edition'
	} as const;
</script>

<svelte:head><title>{book.data?.title ?? 'Book'} · Book Reader</title></svelte:head>

<div>
	<StatusView resource={book} what="This book">
		{#snippet loading()}
			<div class="layout">
				<Skeleton shape="block" width="min(220px, 60vw)" height="auto" class="cover-skeleton" />
				<div class="details">
					<Skeleton width="70%" height="2rem" />
					<Skeleton width="40%" />
					<Skeleton width="100%" height="5rem" />
				</div>
			</div>
		{/snippet}
		{#snippet children(detail)}
			<PageHeader
				title={detail.title}
				back={{ href: resolve('/store'), label: 'Back to the store' }}
			>
				<p class="byline">
					by <a href={resolve('/(app)/creator/[handle]', { handle: detail.creator.handle })}
						>{detail.creator.displayName}</a
					>
				</p>
			</PageHeader>
			<div class="layout">
				<BookCover
					title={detail.title}
					creatorName={detail.creatorName}
					coverUrl={detail.coverUrl}
					size="large"
				/>
				<div class="details">
					<div class="badges">
						<AiLabel aiUse={detail.aiUse} />
						<Badge tone="simulated" icon="science">Simulated store</Badge>
					</div>
					<p class="description">{detail.description}</p>
					<p class="price">{formatPrice(detail.price)}</p>
					<div class="actions">
						<Button disabled>{detail.price.amountMinor === 0 ? 'Add to library' : 'Buy'}</Button>
						<Button variant="outlined" disabled>Read sample</Button>
					</div>
					<p class="note">Getting books arrives in a later build (phase 1.6).</p>
					<h2>What you can get</h2>
					<ul class="products">
						{#each detail.products as product (product.id)}
							<li>
								<span>{productLabels[product.kind]}</span>
								<span class="product-price">{formatPrice(product.price)}</span>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		{/snippet}
	</StatusView>
</div>

<style>
	.layout {
		display: grid;
		gap: var(--space-6);
		justify-items: center;
	}

	@media (min-width: 600px) {
		.layout {
			grid-template-columns: auto 1fr;
			align-items: start;
			justify-items: start;
		}
	}

	.layout :global(.cover-skeleton) {
		aspect-ratio: 2 / 3;
	}

	.details {
		display: grid;
		gap: var(--space-3);
		width: 100%;
		max-width: 40rem;
	}

	.byline {
		margin: var(--space-1) 0 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.badges,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.description {
		margin: 0;
		font-size: var(--md-sys-typescale-body-large-size);
		line-height: var(--md-sys-typescale-body-large-line-height);
	}

	.price {
		margin: 0;
		font-size: var(--md-sys-typescale-title-large-size);
	}

	.note {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	h2 {
		margin: var(--space-4) 0 0;
		font-size: var(--md-sys-typescale-title-medium-size);
	}

	.products {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.products li {
		display: flex;
		justify-content: space-between;
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--md-sys-color-outline-variant);
	}

	.product-price {
		color: var(--md-sys-color-on-surface-variant);
	}
</style>
