<script lang="ts">
	import { resolve } from '$app/paths';
	import type { SubscriptionDto } from '@book/core';
	import { Badge, Button, Dialog } from '@book/ui';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { describeError } from '$lib/errors';
	import { formatDate, formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';

	// Purchases and subscriptions (P1-STO-02, P1-STO-04): orders, Creator Subscriptions (with
	// cancel) and Tips, newest first. Everything is simulated; nothing here involved money.
	const history = resource(
		async () => {
			const backend = await getBackend();
			const [orders, subscriptions, tips] = await Promise.all([
				backend.checkout.listOrders({ limit: 100 }),
				backend.support.listSubscriptions(),
				backend.support.listTips()
			]);
			return { orders: orders.items, subscriptions, tips };
		},
		{ topics: ['entitlements', 'support'] }
	);

	let cancelling = $state.raw<SubscriptionDto | null>(null);

	async function cancel() {
		const sub = cancelling;
		cancelling = null;
		if (!sub) return;
		try {
			const done = await (await getBackend()).support.cancel(sub.id);
			snackbars.show(`Cancelled. Early access lasts until ${formatDate(done.currentPeriodEnd)}.`);
		} catch (error) {
			snackbars.show(describeError(error).title, { tone: 'error' });
		}
	}

	const statusLabels = { paid: 'Bought', claimed: 'Added free', refunded: 'Refunded' } as const;
</script>

<svelte:head><title>Purchases and subscriptions · Book Reader</title></svelte:head>

<div class="page">
	<PageHeader
		title="Purchases and subscriptions"
		back={{ href: resolve('/you'), label: 'Back to You' }}
	>
		<Badge tone="simulated" icon="science">Simulated: no real money</Badge>
	</PageHeader>

	<StatusView
		resource={history}
		what="Your purchases"
		isEmpty={(h) => !h.orders.length && !h.subscriptions.length && !h.tips.length}
	>
		{#snippet loading()}<p>Loading…</p>{/snippet}
		{#snippet empty()}
			<EmptyState
				icon="shopping_bag"
				title="Nothing yet"
				message="Books, add-ons, Tips and subscriptions you get appear here."
			/>
		{/snippet}
		{#snippet children({ orders, subscriptions, tips })}
			{#if subscriptions.length}
				<section aria-labelledby="subs-heading">
					<h2 id="subs-heading">Subscriptions</h2>
					<ul class="list">
						{#each subscriptions as sub (sub.id)}
							<li data-testid="subscription">
								<div class="main">
									<span class="name">{sub.plan.name}</span>
									<span class="meta">
										{sub.plan.creatorName} · {formatPrice(sub.plan.price)} a month ·
										{#if sub.status === 'active'}
											renews {formatDate(sub.currentPeriodEnd)}
										{:else if sub.status === 'cancelled'}
											cancelled; benefits until {formatDate(sub.currentPeriodEnd)}
										{:else}
											ended {formatDate(sub.endedAt ?? sub.currentPeriodEnd)}
										{/if}
									</span>
								</div>
								{#if sub.status === 'active'}
									<Button variant="text" onclick={() => (cancelling = sub)}>Cancel</Button>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
			{#if orders.length}
				<section aria-labelledby="orders-heading">
					<h2 id="orders-heading">Purchases</h2>
					<ul class="list">
						{#each orders as order (order.id)}
							<li data-testid="order">
								<div class="main">
									<span class="name">{order.items.map((i) => i.title).join(', ')}</span>
									<span class="meta"
										>{statusLabels[order.status]}
										{formatDate(order.createdAt)} · {formatPrice(order.total)}</span
									>
								</div>
								{#if order.bookId && order.status !== 'refunded'}
									<Button variant="text" href={resolve('/read/[bookId]', { bookId: order.bookId })}
										>Read</Button
									>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
			{#if tips.length}
				<section aria-labelledby="tips-heading">
					<h2 id="tips-heading">Tips</h2>
					<ul class="list">
						{#each tips as tip (tip.id)}
							<li data-testid="tip">
								<div class="main">
									<span class="name">{formatPrice(tip.amount)} to {tip.creatorName}</span>
									<span class="meta"
										>{formatDate(tip.createdAt)}{tip.message ? ` · “${tip.message}”` : ''}</span
									>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/snippet}
	</StatusView>
</div>

<Dialog
	open={cancelling !== null}
	title="Cancel this subscription?"
	description={cancelling
		? `You keep its benefits until ${formatDate(cancelling.currentPeriodEnd)}, and everything you bought stays yours.`
		: ''}
	onclose={() => (cancelling = null)}
>
	{#snippet actions()}
		<Button variant="text" onclick={() => (cancelling = null)}>Keep it</Button>
		<Button onclick={() => void cancel()}>Cancel subscription</Button>
	{/snippet}
</Dialog>

<style>
	.page {
		display: grid;
		gap: var(--space-5);
		max-width: 48rem;
	}

	h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--md-sys-typescale-title-medium-size);
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--md-sys-color-outline-variant);
	}

	.main {
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
</style>
