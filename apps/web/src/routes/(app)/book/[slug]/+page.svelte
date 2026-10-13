<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { BookPageDto, LayerSummaryDto, OfferDto, PlanDto } from '@book/core';
	import { Badge, Button, Icon, Skeleton } from '@book/ui';
	import AiLabel from '$lib/components/AiLabel.svelte';
	import BookCover from '$lib/components/BookCover.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { contentRatingLabels, formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { preferences } from '$lib/state/preferences.svelte';
	import { resource } from '$lib/state/resource.svelte';
	import CheckoutSheet from '$lib/store/CheckoutSheet.svelte';
	import IllustrationPreviews from '$lib/store/IllustrationPreviews.svelte';
	import NarrationSample from '$lib/store/NarrationSample.svelte';
	import SubscribeSheet from '$lib/store/SubscribeSheet.svelte';
	import TipSheet from '$lib/store/TipSheet.svelte';

	// A Book page (P1-STO-01, P1-STO-02; plan §6 Phase 1.6 UX notes). The primary button is the
	// Complete edition when there is one, "Book only" the second choice; the Layers section says
	// what's included, so the Bundle explains itself. Tip and Subscribe sit by the author's name.
	const book = resource(
		async () => {
			const slug = page.params.slug ?? '';
			const backend = await getBackend();
			const detail = await backend.catalogue.getBook(slug);
			const [sample, plans, subscriptions] = await Promise.all([
				detail.hasNarration ? backend.layers.narrationSample(detail.id) : Promise.resolve(null),
				detail.planIds.length
					? backend.support.listPlans(detail.creator.handle)
					: Promise.resolve([] as PlanDto[]),
				detail.planIds.length ? backend.support.listSubscriptions() : Promise.resolve([])
			]);
			const subscribed = new Set(
				subscriptions.filter((s) => s.status !== 'ended').map((s) => s.plan.id)
			);
			return { detail, sample, plans, subscribed };
		},
		{ topics: ['catalogue', 'entitlements'] }
	);

	let checkoutOpen = $state(false);
	let checkout = $state.raw<OfferDto | null>(null);
	let tipOpen = $state(false);
	let subscribeOpen = $state(false);
	let plan = $state.raw<PlanDto | null>(null);

	function labelOf(detail: BookPageDto, productId: string): string {
		if (detail.offers.some((o) => o.kind === 'book' && o.productId === productId))
			return 'The book';
		return detail.layers.find((l) => l.productId === productId)?.name ?? 'Add-on';
	}

	function ownedProduct(detail: BookPageDto, productId: string): boolean {
		const book = detail.offers.find((o) => o.kind === 'book' && o.productId === productId);
		if (book) return book.owned;
		return detail.layers.some((l) => l.productId === productId && l.entitled);
	}

	function buy(offer: OfferDto) {
		checkout = offer;
		checkoutOpen = true;
	}

	/** A single Layer bought on its own ("its Layers show as available to get"). */
	function layerOffer(layer: LayerSummaryDto): OfferDto {
		return {
			productId: layer.productId,
			kind: 'book',
			label: layer.name,
			includes: [layer.productId],
			price: layer.price,
			priceForYou: layer.price,
			owned: layer.entitled
		};
	}

	const hideAi = $derived(preferences.current.hideAiGenerated);
	const label = (offer: OfferDto) =>
		offer.priceForYou.amountMinor === 0
			? 'Add to library'
			: `${offer.kind === 'bundle' ? 'Get the complete edition' : 'Buy'} · ${formatPrice(offer.priceForYou)}`;
</script>

<svelte:head><title>{book.data?.detail.title ?? 'Book'} · Book Reader</title></svelte:head>

<div>
	<StatusView resource={book} what="This book">
		{#snippet loading()}
			<div class="layout">
				<Skeleton shape="block" width="min(220px, 40vw)" height="auto" class="cover-skeleton" />
				<div class="details">
					<Skeleton width="70%" height="2rem" />
					<Skeleton width="40%" />
					<Skeleton width="100%" height="5rem" />
				</div>
			</div>
		{/snippet}
		{#snippet children({ detail, sample, plans, subscribed })}
			{@const [primary, ...others] = detail.offers.filter((o) => !o.owned)}
			{@const bundle = detail.offers.find((o) => o.kind === 'bundle')}
			{@const layers = detail.layers.filter((l) => !(hideAi && l.aiUse === 'generated'))}
			<PageHeader
				title={detail.title}
				back={{ href: resolve('/store'), label: 'Back to the store' }}
			>
				<div class="byline">
					<span
						>by <a href={resolve('/(app)/creator/[handle]', { handle: detail.creator.handle })}
							>{detail.creator.displayName}</a
						></span
					>
					<Button variant="text" icon="volunteer_activism" onclick={() => (tipOpen = true)}
						>Tip</Button
					>
					{#each plans as p (p.id)}
						{#if subscribed.has(p.id)}
							<Badge tone="primary" icon="card_membership">Subscribed</Badge>
						{:else}
							<Button
								variant="text"
								icon="card_membership"
								onclick={() => {
									plan = p;
									subscribeOpen = true;
								}}>Subscribe</Button
							>
						{/if}
					{/each}
				</div>
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
						<Badge>{contentRatingLabels[detail.contentRating]}</Badge>
						{#if detail.isSerial}<Badge tone="primary" icon="schedule">Serial</Badge>{/if}
						<Badge tone="simulated" icon="science">Simulated store</Badge>
					</div>
					{#if detail.contentWarnings.length}
						<p class="warnings">
							<Icon name="warning" size={18} /> Contains: {detail.contentWarnings.join(', ')}
						</p>
					{/if}
					<p class="description">{detail.description}</p>

					<div class="actions">
						{#if detail.inLibrary}
							<Button icon="auto_stories" href={resolve('/read/[bookId]', { bookId: detail.id })}
								>Read now</Button
							>
						{/if}
						{#if primary}
							<Button variant={detail.inLibrary ? 'tonal' : 'filled'} onclick={() => buy(primary)}
								>{label(primary)}</Button
							>
						{/if}
						{#each others as offer (offer.productId)}
							<Button variant="outlined" onclick={() => buy(offer)}
								>{offer.label} · {formatPrice(offer.priceForYou)}</Button
							>
						{/each}
						{#if detail.hasSample}
							<Button
								variant="text"
								icon="menu_book"
								href={`${resolve('/read/[bookId]', { bookId: detail.id })}?sample=1`}
								>Read sample</Button
							>
						{/if}
					</div>
					{#if detail.inLibrary && !primary}
						<p class="note">
							<Icon name="check_circle" size={18} /> In your library{bundle?.owned
								? ', with everything in the Complete edition'
								: ''}.
						</p>
					{/if}

					{#if layers.length}
						<h2>Illustrations and narration</h2>
						{#if detail.hasIllustrations}<IllustrationPreviews bookId={detail.id} />{/if}
						{#if sample}<NarrationSample {sample} />{/if}
						<ul class="layers" data-testid="book-layers">
							{#each layers as layer (layer.id)}
								{@const inBundle = !!bundle && bundle.includes.includes(layer.productId)}
								<li>
									<Icon name={layer.kind === 'audio_track' ? 'headphones' : 'photo_library'} />
									<div class="layer-text">
										<span class="layer-name">{layer.name}</span>
										<span class="layer-meta">
											{layer.kind === 'audio_track'
												? `Read by ${layer.narrator} · ${layer.chapterCount} chapters`
												: `${layer.illustrationCount} pictures`}
											· {layer.isOfficial ? 'Official' : `Community: ${layer.creatorName}`}
										</span>
										<span class="layer-badges"><AiLabel aiUse={layer.aiUse} /></span>
									</div>
									<div class="layer-get">
										{#if layer.entitled}
											<span class="have"><Icon name="check" size={18} /> You have this</span>
										{:else}
											{#if inBundle}<span class="in-bundle">In the Complete edition</span>{/if}
											<Button variant="text" onclick={() => buy(layerOffer(layer))}
												>{layer.price.amountMinor
													? `Get · ${formatPrice(layer.price)}`
													: 'Get'}</Button
											>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}
					{#if detail.isSerial && plans.length}
						<p class="note">
							<Icon name="lock" size={18} /> The newest chapters are early access for {detail
								.creator.displayName}’s subscribers, then free for everyone who owns the book.
						</p>
					{/if}
				</div>
			</div>

			<CheckoutSheet
				bind:open={checkoutOpen}
				offer={checkout}
				book={{ id: detail.id, title: detail.title }}
				items={(checkout?.includes ?? []).map((productId) => ({
					productId,
					label: labelOf(detail, productId),
					owned: ownedProduct(detail, productId)
				}))}
			/>
			<TipSheet bind:open={tipOpen} creator={detail.creator} bookId={detail.id} />
			<SubscribeSheet bind:open={subscribeOpen} {plan} />
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
		max-width: 44rem;
		min-width: 0;
	}

	.byline {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		margin-top: var(--space-1);
		color: var(--md-sys-color-on-surface-variant);
	}

	.badges,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.warnings,
	.note {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.description {
		margin: 0;
		font-size: var(--md-sys-typescale-body-large-size);
		line-height: var(--md-sys-typescale-body-large-line-height);
	}

	h2 {
		margin: var(--space-4) 0 0;
		font-size: var(--md-sys-typescale-title-medium-size);
	}

	.layers {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.layers li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--md-sys-color-outline-variant);
		color: var(--md-sys-color-on-surface-variant);
	}

	.layer-text {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.layer-name {
		color: var(--md-sys-color-on-surface);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.layer-meta,
	.in-bundle {
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.layer-get {
		display: grid;
		justify-items: end;
	}

	.have {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--md-sys-color-primary);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	@media (max-width: 420px) {
		.layers li {
			grid-template-columns: auto 1fr;
		}

		.layer-get {
			grid-column: 2;
			justify-items: start;
		}
	}
</style>
