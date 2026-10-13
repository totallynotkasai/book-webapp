<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayerSummaryDto, OfferDto } from '@book/core';
	import { Badge, Button, Card, Icon, Skeleton } from '@book/ui';
	import ReportDialog from '$lib/community/ReportDialog.svelte';
	import StarRating from '$lib/community/StarRating.svelte';
	import AiLabel from '$lib/components/AiLabel.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { describeError } from '$lib/errors';
	import { formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { preferences } from '$lib/state/preferences.svelte';
	import { resource } from '$lib/state/resource.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import CheckoutSheet from '$lib/store/CheckoutSheet.svelte';
	import LayerDetailsDialog from '$lib/studio/LayerDetailsDialog.svelte';

	// A Book's community hub (P1-COM-02, DESIGN.md §4.8): community illustrations and narration,
	// endorsed by the author first, then top-rated. Readers get, rate and report them; Creators
	// make their own where the author's policy allows (Invariant 19).
	const hub = resource(
		async () => {
			const backend = await getBackend();
			const book = await backend.catalogue.getBook(page.params.slug ?? '');
			return { book, hub: await backend.community.hub(book.id) };
		},
		{ topics: ['community', 'entitlements', 'catalogue'] }
	);

	const hideAi = $derived(preferences.current.hideAiGenerated);
	const policyText = {
		closed: 'The author doesn’t take community illustrations or narration for this book.',
		approval: 'The author approves community work before it’s listed here.',
		open: 'Community work is listed straight away. The author and moderators can remove it.'
	} as const;

	let checkoutOpen = $state(false);
	let checkout = $state.raw<OfferDto | null>(null);
	let reportOpen = $state(false);
	let reporting = $state.raw<LayerSummaryDto | null>(null);
	let makeOpen = $state(false);
	let makeKind = $state<'pack' | 'track'>('pack');

	function get(layer: LayerSummaryDto) {
		checkout = {
			productId: layer.productId,
			kind: 'book',
			label: layer.name,
			includes: [layer.productId],
			price: layer.price,
			priceForYou: layer.price,
			owned: layer.entitled
		};
		checkoutOpen = true;
	}

	async function rate(layer: LayerSummaryDto, stars: number) {
		try {
			await (await getBackend()).community.rate(layer.id, stars);
			snackbars.show(`Rated ${stars} ${stars === 1 ? 'star' : 'stars'}.`);
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		}
	}

	async function made(id: string, bookId: string) {
		if (makeKind === 'pack') {
			const reader = resolve('/read/[bookId]', { bookId });
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved, plus a query
			await goto(`${reader}?mode=creator&pack=${encodeURIComponent(id)}`);
		} else {
			await goto(resolve('/(app)/studio/tracks/[trackId]', { trackId: id }));
		}
	}
</script>

<svelte:head><title>Community · {hub.data?.book.title ?? 'Book'} · Book Reader</title></svelte:head>

<div class="page">
	<StatusView resource={hub} what="This book’s community">
		{#snippet loading()}
			<Skeleton width="60%" height="2rem" />
			<Skeleton height="8rem" shape="block" />
		{/snippet}
		{#snippet children({ book, hub: h })}
			{@const layers = h.layers.filter((l) => !(hideAi && l.aiUse === 'generated'))}
			<PageHeader
				title="Community"
				subtitle={`Illustrations and narration for “${book.title}” by other creators.`}
				back={{
					href: resolve('/(app)/book/[slug]', { slug: book.slug }),
					label: 'Back to the book'
				}}
			/>
			<p class="policy">
				<Icon name="info" size={18} />
				<span
					>{policyText[h.policy]}{h.policy !== 'closed' && h.communityAi === 'refused'
						? ' AI-generated work isn’t accepted.'
						: ''}</span
				>
			</p>

			{#if h.canSubmit}
				<Card variant="outlined">
					<div class="make">
						<p><strong>Make something for this book.</strong> Readers can get it free or buy it.</p>
						<div class="actions">
							<Button
								variant="tonal"
								icon="add_photo_alternate"
								onclick={() => {
									makeKind = 'pack';
									makeOpen = true;
								}}>New illustration pack</Button
							>
							<Button
								variant="tonal"
								icon="mic"
								onclick={() => {
									makeKind = 'track';
									makeOpen = true;
								}}>New narration</Button
							>
						</div>
					</div>
				</Card>
				<LayerDetailsDialog
					bind:open={makeOpen}
					kind={makeKind}
					bookId={h.bookId}
					onsaved={(id) => void made(id, h.bookId)}
				/>
			{/if}

			{#if layers.length}
				<ul class="layers" data-testid="community-layers">
					{#each layers as layer (layer.id)}
						<li data-testid="community-layer">
							<div class="head">
								<Icon name={layer.kind === 'audio_track' ? 'headphones' : 'photo_library'} />
								<div class="text">
									<span class="name">{layer.name}</span>
									<span class="meta">
										by <a href={resolve('/(app)/creator/[handle]', { handle: layer.creatorHandle })}
											>{layer.creatorName}</a
										>
										·
										{layer.kind === 'audio_track'
											? `${layer.chapterCount} chapters`
											: `${layer.illustrationCount} pictures`}
									</span>
									<span class="badges">
										{#if layer.endorsed}<Badge tone="primary" icon="verified">Author-endorsed</Badge
											>{/if}
										<AiLabel aiUse={layer.aiUse} />
									</span>
								</div>
							</div>
							<StarRating
								name={layer.name}
								rating={layer.rating}
								mine={layer.myRating}
								onrate={layer.entitled ? (stars) => void rate(layer, stars) : undefined}
							/>
							<div class="actions">
								{#if layer.entitled}
									<span class="have"><Icon name="check" size={18} /> You have this</span>
								{:else}
									<Button variant="tonal" onclick={() => get(layer)}
										>{layer.price.amountMinor ? `Get · ${formatPrice(layer.price)}` : 'Get'}</Button
									>
								{/if}
								<Button
									variant="text"
									icon="flag"
									onclick={() => {
										reporting = layer;
										reportOpen = true;
									}}>Report</Button
								>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<EmptyState
					icon="photo_library"
					title="No community work yet"
					message={h.canSubmit
						? 'Be the first: make an illustration pack or a narration.'
						: hideAi && h.layers.length
							? 'AI-generated work is hidden by your settings.'
							: 'When creators make illustrations or narration for this book, they appear here.'}
				/>
			{/if}

			<CheckoutSheet
				bind:open={checkoutOpen}
				offer={checkout}
				book={{ id: book.id, title: book.title }}
				items={checkout
					? [{ productId: checkout.productId, label: checkout.label, owned: checkout.owned }]
					: []}
			/>
			<ReportDialog
				bind:open={reportOpen}
				target={reporting
					? { type: reporting.kind, id: reporting.id, title: reporting.name }
					: null}
			/>
		{/snippet}
	</StatusView>
</div>

<style>
	.page {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		max-width: 48rem;
	}

	.policy {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.make {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-4);
	}

	.make p {
		margin: 0;
	}

	.layers {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.layers li {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.head {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
	}

	.text {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.name {
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.meta {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.badges,
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.have {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--md-sys-color-primary);
		font-size: var(--md-sys-typescale-body-small-size);
	}
</style>
