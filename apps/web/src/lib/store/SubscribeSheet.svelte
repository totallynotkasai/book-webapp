<script lang="ts">
	import type { PlanDto, SubscriptionDto } from '@book/core';
	import { AdaptiveSheet, Badge, Button, Icon } from '@book/ui';
	import { describeError } from '$lib/errors';
	import { formatDate, formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { newKey } from './keys';

	/**
	 * Subscribing to a Creator (P1-STO-04, DESIGN.md §6.5): a monthly plan whose benefits, such
	 * as early-access Chapters, last while it's paid. Cancel at any time; purchases are never
	 * affected. Simulated: no card, no money; renewals follow the dev panel's clock.
	 */
	interface Props {
		open: boolean;
		plan: PlanDto | null;
		ondone?: (subscription: SubscriptionDto) => void;
	}

	let { open = $bindable(), plan, ondone }: Props = $props();

	let busy = $state(false);
	let failure = $state<string | null>(null);
	let done = $state<SubscriptionDto | null>(null);
	let key = '';

	$effect(() => {
		if (open) {
			failure = null;
			done = null;
			key = newKey();
		}
	});

	async function subscribe() {
		if (!plan || busy) return;
		busy = true;
		failure = null;
		try {
			done = await (await getBackend()).support.subscribe(plan.id, key);
			ondone?.(done);
		} catch (error) {
			failure = describeError(error).message;
			key = newKey();
		} finally {
			busy = false;
		}
	}
</script>

<AdaptiveSheet
	bind:open
	title={done ? 'You’re subscribed' : (plan?.name ?? 'Subscribe')}
	height="auto"
>
	<div class="subscribe" data-testid="subscribe-sheet">
		{#if done}
			<div class="done" role="status">
				<Icon name="check_circle" size={40} />
				<p>
					Thank you for supporting {done.plan.creatorName}. Early access is open now. Your next
					payment is on {formatDate(done.currentPeriodEnd)}.
				</p>
			</div>
		{:else if plan}
			<Badge tone="simulated" icon="science">Simulated: no card, no money</Badge>
			<p class="lead">{plan.description}</p>
			<ul class="benefits">
				{#each plan.benefits as benefit (benefit.bookId)}
					<li><Icon name="lock_open" size={20} /> {benefit.description}</li>
				{/each}
			</ul>
			<p class="price">
				<strong>{formatPrice(plan.price)}</strong> a month. Cancel any time; you keep what you’ve bought.
			</p>
			{#if failure}<p class="failed" role="alert">{failure}</p>{/if}
		{/if}
	</div>
	{#snippet footer()}
		{#if done}
			<Button onclick={() => (open = false)}>Done</Button>
		{:else}
			<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
			<Button icon="card_membership" disabled={busy || !plan} onclick={subscribe}>
				{busy ? 'Subscribing…' : `Subscribe · ${plan ? formatPrice(plan.price) : ''} a month`}
			</Button>
		{/if}
	{/snippet}
</AdaptiveSheet>

<style>
	.subscribe {
		display: grid;
		gap: var(--space-3);
		min-width: min(24rem, 100%);
	}

	.lead,
	.price {
		margin: 0;
	}

	.benefits {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.benefits li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.failed {
		margin: 0;
		color: var(--md-sys-color-error);
	}

	.done {
		display: grid;
		justify-items: center;
		gap: var(--space-2);
		color: var(--md-sys-color-primary);
		text-align: center;
	}

	.done p {
		margin: 0;
		color: var(--md-sys-color-on-surface);
	}
</style>
