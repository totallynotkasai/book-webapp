<script lang="ts">
	import { resolve } from '$app/paths';
	import type { OfferDto, OrderDto } from '@book/core';
	import { AdaptiveSheet, Badge, Button, Icon } from '@book/ui';
	import { describeError } from '$lib/errors';
	import { formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { newKey } from './keys';

	/**
	 * Simulated checkout (P1-STO-02, plan §6 Phase 1.6 UX notes): a sheet over the current page,
	 * labelled Simulated, with no card fields. It lists what the reader gets, says what they
	 * already own, and pays (or adds a free Product) in one press. The idempotency key is made
	 * once per attempt, so a double press buys once; a declined payment can be tried again.
	 */
	interface Props {
		open: boolean;
		offer: OfferDto | null;
		/** What it's for, for the title and "Read now". */
		book: { id: string; title: string } | null;
		/** What each included Product is called, and whether the reader has it already. */
		items: { productId: string; label: string; owned: boolean }[];
		ondone?: (order: OrderDto) => void;
	}

	let { open = $bindable(), offer, book, items, ondone }: Props = $props();

	type Step =
		| { kind: 'review' }
		| { kind: 'paying' }
		| { kind: 'done'; order: OrderDto }
		| { kind: 'failed'; title: string; message: string };
	let step = $state<Step>({ kind: 'review' });
	let key = '';

	$effect(() => {
		if (open) {
			step = { kind: 'review' };
			key = newKey();
		}
	});

	const free = $derived(offer?.priceForYou.amountMinor === 0);

	async function pay() {
		if (!offer || step.kind === 'paying') return;
		step = { kind: 'paying' };
		try {
			const backend = await getBackend();
			const order = free
				? await backend.checkout.claim(offer.productId)
				: await backend.checkout.purchase(offer.productId, key);
			step = { kind: 'done', order };
			ondone?.(order);
		} catch (error) {
			const described = describeError(error);
			step = { kind: 'failed', title: described.title, message: described.message };
			// A new attempt is a new payment.
			key = newKey();
		}
	}
</script>

<AdaptiveSheet
	bind:open
	title={step.kind === 'done' ? 'Added to your library' : free ? 'Add to library' : 'Checkout'}
	height="auto"
>
	<div class="checkout" data-testid="checkout">
		{#if step.kind === 'done'}
			<div class="done" role="status">
				<Icon name="check_circle" size={40} />
				{#if book}
					<p>
						<strong>{book.title}</strong>
						{offer?.kind === 'bundle' ? '(Complete edition) is' : 'is'} in your library.
					</p>
				{:else}
					<p><strong>{items[0]?.label ?? offer?.label}</strong> is yours, in every book.</p>
				{/if}
			</div>
		{:else if offer}
			<Badge tone="simulated" icon="science">Simulated: no card, no money</Badge>
			<p class="what">
				{offer.label}{#if book}: <strong>{book.title}</strong>{/if}
			</p>
			<ul class="items">
				{#each items as item (item.productId)}
					<li>
						<Icon name={item.owned ? 'check_circle' : 'add'} size={20} />
						<span>{item.label}</span>
						{#if item.owned}<span class="owned">You have this</span>{/if}
					</li>
				{/each}
			</ul>
			<div class="total">
				<span>Total</span>
				<span data-testid="checkout-total">{formatPrice(offer.priceForYou)}</span>
			</div>
			{#if offer.priceForYou.amountMinor < offer.price.amountMinor && !free}
				<p class="note">
					{formatPrice(offer.price)} less what you already have.
				</p>
			{/if}
			{#if step.kind === 'failed'}
				<div class="failed" role="alert">
					<strong>{step.title}</strong>
					<span>{step.message}</span>
				</div>
			{/if}
		{/if}
	</div>
	{#snippet footer()}
		{#if step.kind === 'done'}
			<Button variant="text" onclick={() => (open = false)}>Done</Button>
			{#if book}
				<Button icon="auto_stories" href={resolve('/read/[bookId]', { bookId: book.id })}
					>Read now</Button
				>
			{/if}
		{:else}
			<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
			<Button disabled={step.kind === 'paying' || !offer} onclick={pay}>
				{#if step.kind === 'paying'}
					{free ? 'Adding…' : 'Paying…'}
				{:else if step.kind === 'failed'}
					Try again
				{:else if free}
					Add to library
				{:else}
					Pay {offer ? formatPrice(offer.priceForYou) : ''} (simulated)
				{/if}
			</Button>
		{/if}
	{/snippet}
</AdaptiveSheet>

<style>
	.checkout {
		display: grid;
		gap: var(--space-3);
		min-width: min(24rem, 100%);
	}

	.what {
		margin: 0;
		font-size: var(--md-sys-typescale-title-medium-size);
	}

	.items {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.items li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.owned {
		margin-left: auto;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.total {
		display: flex;
		justify-content: space-between;
		padding-top: var(--space-3);
		border-top: 1px solid var(--md-sys-color-outline-variant);
		font-size: var(--md-sys-typescale-title-medium-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.note {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.failed {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-error-container);
		color: var(--md-sys-color-on-error-container);
	}

	.done {
		display: grid;
		justify-items: center;
		gap: var(--space-2);
		padding-block: var(--space-4);
		color: var(--md-sys-color-primary);
		text-align: center;
	}

	.done p {
		margin: 0;
		color: var(--md-sys-color-on-surface);
	}
</style>
