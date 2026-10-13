<script lang="ts">
	import { AdaptiveSheet, Badge, Button, Chip, TextField } from '@book/ui';
	import { describeError } from '$lib/errors';
	import { formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import { newKey } from './keys';

	/**
	 * A Tip to a Creator (P1-STO-04, DESIGN.md §6.5): a one-off payment, optionally for a Book,
	 * that grants nothing. Simulated: no card, no money.
	 */
	interface Props {
		open: boolean;
		creator: { id: string; displayName: string } | null;
		bookId?: string | null;
	}

	let { open = $bindable(), creator, bookId = null }: Props = $props();

	const AMOUNTS = [100, 300, 500, 1000];
	let amount = $state(300);
	let message = $state('');
	let sending = $state(false);
	let failure = $state<string | null>(null);
	let key = '';

	$effect(() => {
		if (open) {
			failure = null;
			key = newKey();
		}
	});

	const price = $derived({ amountMinor: amount, currency: 'GBP' });

	async function send() {
		if (!creator || sending) return;
		sending = true;
		failure = null;
		try {
			await (
				await getBackend()
			).support.tip({
				creatorId: creator.id,
				bookId,
				amount: price,
				message: message.trim() || null,
				idempotencyKey: key
			});
			open = false;
			message = '';
			snackbars.show(`Thank you! ${creator.displayName} got your ${formatPrice(price)} tip.`);
		} catch (error) {
			failure = describeError(error).message;
			key = newKey();
		} finally {
			sending = false;
		}
	}
</script>

<AdaptiveSheet bind:open title={creator ? `Tip ${creator.displayName}` : 'Tip'} height="auto">
	<div class="tip" data-testid="tip-sheet">
		<Badge tone="simulated" icon="science">Simulated: no card, no money</Badge>
		<p class="lead">A thank-you that goes to the author. It doesn’t unlock anything.</p>
		<div class="amounts" role="group" aria-label="Amount">
			{#each AMOUNTS as value (value)}
				<Chip
					kind="filter"
					label={formatPrice({ amountMinor: value, currency: 'GBP' })}
					selected={amount === value}
					onclick={() => (amount = value)}
				/>
			{/each}
		</div>
		<TextField label="Message (optional)" bind:value={message} maxlength={280} multiline rows={2} />
		{#if failure}<p class="failed" role="alert">{failure}</p>{/if}
	</div>
	{#snippet footer()}
		<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
		<Button icon="volunteer_activism" disabled={sending} onclick={send}>
			{sending ? 'Sending…' : `Send ${formatPrice(price)} (simulated)`}
		</Button>
	{/snippet}
</AdaptiveSheet>

<style>
	.tip {
		display: grid;
		gap: var(--space-3);
		min-width: min(24rem, 100%);
	}

	.lead {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.amounts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.failed {
		margin: 0;
		color: var(--md-sys-color-error);
	}
</style>
