<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PlanDto } from '@book/core';
	import { Badge, Button, Card, Icon, Skeleton } from '@book/ui';
	import StarRating from '$lib/community/StarRating.svelte';
	import BookCard from '$lib/components/BookCard.svelte';
	import BookGrid from '$lib/components/BookGrid.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { describeError } from '$lib/errors';
	import { formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { preferences } from '$lib/state/preferences.svelte';
	import { resource } from '$lib/state/resource.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import SubscribeSheet from '$lib/store/SubscribeSheet.svelte';
	import TipSheet from '$lib/store/TipSheet.svelte';

	// A Creator profile (P1-APP-01, P1-STO-04, P1-COM-02): follow them, Tip, their Creator
	// Subscription plans, their Books, and their portfolio of illustrations and narration.
	const profile = resource(
		async () => {
			const handle = page.params.handle ?? '';
			const backend = await getBackend();
			const [about, plans, subscriptions] = await Promise.all([
				backend.community.profile(handle),
				backend.support.listPlans(handle),
				backend.support.listSubscriptions()
			]);
			const subscribed = new Set(
				subscriptions.filter((s) => s.status !== 'ended').map((s) => s.plan.id)
			);
			return { creator: about.creator, about, plans, subscribed };
		},
		{ topics: ['catalogue', 'entitlements', 'community'] }
	);
	const books = resource(
		() => {
			const handle = page.params.handle ?? '';
			return getBackend().then((b) => b.catalogue.listCreatorBooks(handle, { limit: 100 }));
		},
		{ topics: ['catalogue', 'entitlements'] }
	);

	let tipOpen = $state(false);
	let subscribeOpen = $state(false);
	let plan = $state.raw<PlanDto | null>(null);
	const hideAi = $derived(preferences.current.hideAiGenerated);

	let following = $state(false);
	async function follow(handle: string, on: boolean) {
		if (following) return;
		following = true;
		try {
			await (await getBackend()).community.follow(handle, on);
			snackbars.show(on ? 'Following.' : 'Unfollowed.');
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		} finally {
			following = false;
		}
	}
</script>

<svelte:head
	><title>{profile.data?.creator.displayName ?? 'Creator'} · Book Reader</title></svelte:head
>

<div>
	<StatusView resource={profile} what="This creator">
		{#snippet loading()}
			<Skeleton width="50%" height="2rem" />
			<Skeleton width="80%" />
		{/snippet}
		{#snippet children({ creator, about, plans, subscribed })}
			<PageHeader
				title={creator.displayName}
				subtitle={creator.bio}
				back={{ href: resolve('/store'), label: 'Back to the store' }}
			>
				<p class="followers" data-testid="followers">
					{about.followers}
					{about.followers === 1 ? 'follower' : 'followers'}
				</p>
				{#snippet actions()}
					<Button
						variant={about.following ? 'outlined' : 'filled'}
						icon={about.following ? 'check' : 'person_add'}
						pending={following}
						aria-pressed={about.following}
						onclick={() => void follow(creator.handle, !about.following)}
						>{about.following ? 'Following' : 'Follow'}</Button
					>
					<Button variant="tonal" icon="volunteer_activism" onclick={() => (tipOpen = true)}
						>Tip</Button
					>
				{/snippet}
			</PageHeader>
			{#if about.layers.filter((l) => !(hideAi && l.aiUse === 'generated')).length}
				<h2>Illustrations and narration</h2>
				<ul class="portfolio" data-testid="portfolio">
					{#each about.layers.filter((l) => !(hideAi && l.aiUse === 'generated')) as layer (layer.id)}
						<li>
							<Icon name={layer.kind === 'audio_track' ? 'headphones' : 'photo_library'} />
							<div class="layer-text">
								<span class="layer-name">{layer.name}</span>
								<span class="layer-meta">
									for <a href={resolve('/(app)/book/[slug]', { slug: layer.bookSlug })}
										>{layer.bookTitle}</a
									>
									{#if layer.endorsed}· Author-endorsed{/if}
								</span>
								<StarRating name={layer.name} rating={layer.rating} />
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			{#if plans.length}
				<h2>Support {creator.displayName}</h2>
				<div class="plans">
					{#each plans as p (p.id)}
						<Card>
							<div class="plan" data-testid="plan">
								<div class="plan-head">
									<span class="plan-name">{p.name}</span>
									<span class="plan-price">{formatPrice(p.price)} a month</span>
								</div>
								<p>{p.description}</p>
								<ul>
									{#each p.benefits as b (b.bookId)}
										<li><Icon name="lock_open" size={18} /> {b.description}</li>
									{/each}
								</ul>
								{#if subscribed.has(p.id)}
									<Badge tone="primary" icon="card_membership">You subscribe</Badge>
								{:else}
									<Button
										icon="card_membership"
										onclick={() => {
											plan = p;
											subscribeOpen = true;
										}}>Subscribe</Button
									>
								{/if}
							</div>
						</Card>
					{/each}
				</div>
			{/if}
			<TipSheet bind:open={tipOpen} {creator} />
			<SubscribeSheet bind:open={subscribeOpen} {plan} />
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
				{#each list.items.filter((b) => !(hideAi && b.aiUse === 'generated')) as book (book.id)}
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

	.followers {
		margin: var(--space-1) 0 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.portfolio {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.portfolio li {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.layer-text {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.layer-name {
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.layer-meta {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.plans {
		display: grid;
		gap: var(--space-4);
		max-width: 36rem;
	}

	.plan {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}

	.plan-head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-2);
		width: 100%;
	}

	.plan-name {
		font-size: var(--md-sys-typescale-title-medium-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.plan-price {
		color: var(--md-sys-color-on-surface-variant);
	}

	.plan p,
	.plan ul {
		margin: 0;
	}

	.plan ul {
		padding: 0;
		list-style: none;
	}

	.plan li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
</style>
