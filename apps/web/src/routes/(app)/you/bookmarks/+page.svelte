<script lang="ts">
	import { resolve } from '$app/paths';
	import type { BookmarkDesignDto, OfferDto } from '@book/core';
	import { Badge, Button, Icon } from '@book/ui';
	import BookmarkRibbon from '$lib/components/BookmarkRibbon.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { preferences } from '$lib/state/preferences.svelte';
	import { resource } from '$lib/state/resource.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import CheckoutSheet from '$lib/store/CheckoutSheet.svelte';

	// Bookmark Designs (P1-STO-03): the small shop and the reader's default. A design works in every
	// Book as soon as it's owned; each Placed Bookmark can also have its own (Contents → Bookmarks).
	const designs = resource(async () => (await getBackend()).catalogue.listBookmarkDesigns(), {
		topics: ['catalogue', 'entitlements']
	});

	let checkoutOpen = $state(false);
	let buying = $state.raw<BookmarkDesignDto | null>(null);
	const offer = $derived<OfferDto | null>(
		buying
			? {
					productId: buying.productId,
					kind: 'book',
					label: 'Bookmark design',
					includes: [buying.productId],
					price: buying.price,
					priceForYou: buying.price,
					owned: buying.owned
				}
			: null
	);

	const current = $derived(preferences.current.bookmarkDesignProductId);
	function isDefault(design: BookmarkDesignDto, all: BookmarkDesignDto[]) {
		const chosen = all.find((d) => d.owned && d.productId === current);
		return chosen ? chosen.productId === design.productId : design.isDefault;
	}

	function useAsDefault(design: BookmarkDesignDto) {
		void preferences.update({ bookmarkDesignProductId: design.productId });
		snackbars.show(`New bookmarks use ${design.name}`);
	}
</script>

<svelte:head><title>Bookmark designs · Book Reader</title></svelte:head>

<div class="page">
	<PageHeader
		title="Bookmark designs"
		subtitle="Ribbons for your bookmarks. They work in every book."
		back={{ href: resolve('/you'), label: 'Back to You' }}
	>
		<Badge tone="simulated" icon="science">Simulated: no real money</Badge>
	</PageHeader>

	<StatusView resource={designs} what="Bookmark designs">
		{#snippet loading()}<p>Loading designs…</p>{/snippet}
		{#snippet children(all)}
			<ul class="designs">
				{#each all as design (design.productId)}
					{@const chosen = isDefault(design, all)}
					<li class={['design', { chosen }]} data-testid="bookmark-design">
						<BookmarkRibbon look={design.look} size={64} />
						<div class="about">
							<span class="name">{design.name}</span>
							<span class="by">By {design.creatorName}</span>
							<p class="description">{design.description}</p>
						</div>
						<div class="get">
							{#if chosen}
								<span class="in-use"><Icon name="check_circle" size={18} /> Your default</span>
							{:else if design.owned}
								<Button variant="tonal" onclick={() => useAsDefault(design)}>Use as default</Button>
							{:else}
								<Button
									onclick={() => {
										buying = design;
										checkoutOpen = true;
									}}>Buy · {formatPrice(design.price)}</Button
								>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
			<p class="hint">
				To give one bookmark its own design, open Contents in the reader, then Bookmarks.
			</p>
		{/snippet}
	</StatusView>
</div>

<CheckoutSheet
	bind:open={checkoutOpen}
	{offer}
	book={null}
	items={buying ? [{ productId: buying.productId, label: buying.name, owned: false }] : []}
	ondone={() => {
		if (buying) void preferences.update({ bookmarkDesignProductId: buying.productId });
	}}
/>

<style>
	.page {
		display: grid;
		gap: var(--space-5);
		max-width: 48rem;
	}

	.designs {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.design {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4);
		border-radius: var(--md-sys-shape-corner-large);
		background: var(--md-sys-color-surface-container-low);
	}

	.design.chosen {
		outline: 2px solid var(--md-sys-color-primary);
	}

	.about {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.name {
		font-size: var(--md-sys-typescale-title-medium-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.by,
	.hint {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.description {
		margin: var(--space-1) 0 0;
	}

	.in-use {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--md-sys-color-primary);
	}

	@media (max-width: 480px) {
		.design {
			grid-template-columns: auto 1fr;
		}

		.get {
			grid-column: 2;
		}
	}
</style>
