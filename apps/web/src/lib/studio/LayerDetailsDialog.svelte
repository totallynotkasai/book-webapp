<script lang="ts" module>
	import type { AiUse, Money } from '@book/core';

	export interface LayerDetails {
		name: string;
		narrator?: string;
		description: string;
		credit: string;
		price: Money;
		aiUse: AiUse | null;
	}
</script>

<script lang="ts">
	import { Button, Dialog, TextField } from '@book/ui';
	import { untrack } from 'svelte';
	import { describeError } from '$lib/errors';
	import { getBackend } from '$lib/services';
	import AiQuestion from './AiQuestion.svelte';
	import { parsePrice, priceText } from './price';

	/**
	 * A pack's or narration's details (P1-LAY-05, P1-STU-03): name, narrator, description, credit,
	 * price (simulated) and the AI answer (§10.6). Creates one, or edits one that exists.
	 */
	interface Props {
		open: boolean;
		kind: 'pack' | 'track';
		bookId: string;
		/** The one being edited; a new one when absent. */
		existing?: (LayerDetails & { id: string }) | null;
		onsaved: (id: string) => void;
	}

	let { open = $bindable(), kind, bookId, existing = null, onsaved }: Props = $props();

	let name = $state('');
	let narrator = $state('');
	let description = $state('');
	let credit = $state('');
	let price = $state('0.00');
	let aiUse = $state<AiUse | null>(null);
	let saving = $state(false);
	let problem = $state<string | null>(null);

	// A fresh form each time the dialog opens, not whenever the page behind it refreshes.
	$effect(() => {
		if (open) untrack(fill);
	});

	function fill() {
		name = existing?.name ?? (kind === 'pack' ? 'Illustrations' : 'Narration');
		narrator = existing?.narrator ?? '';
		description = existing?.description ?? '';
		credit = existing?.credit ?? '';
		price = existing ? priceText(existing.price) : '0.00';
		aiUse = existing?.aiUse ?? null;
		problem = null;
	}

	const parsed = $derived(parsePrice(price));

	async function save() {
		if (saving || !parsed) return;
		saving = true;
		problem = null;
		try {
			const studio = (await getBackend()).studio;
			const details = {
				name: name.trim(),
				description,
				credit,
				price: parsed,
				aiUse,
				...(kind === 'track' && narrator.trim() ? { narrator: narrator.trim() } : {})
			};
			const id =
				kind === 'pack'
					? existing
						? (await studio.updatePack(existing.id, details)).id
						: (await studio.createPack(bookId, details)).id
					: existing
						? (await studio.updateTrack(existing.id, details)).id
						: (await studio.createTrack(bookId, details)).id;
			open = false;
			onsaved(id);
		} catch (error) {
			problem = describeError(error).message;
		} finally {
			saving = false;
		}
	}
</script>

<Dialog
	bind:open
	title={existing ? 'Details' : kind === 'pack' ? 'New illustration pack' : 'New narration'}
	size="medium"
>
	<div class="form" data-testid="layer-details">
		<TextField label="Name" bind:value={name} required />
		{#if kind === 'track'}
			<TextField label="Narrator" bind:value={narrator} supportingText="Who reads it." />
		{/if}
		<TextField label="Description" bind:value={description} multiline rows={2} />
		<TextField label="Credit" bind:value={credit} supportingText="Shown with it in the reader." />
		<TextField
			label="Price (£, simulated)"
			bind:value={price}
			inputmode="decimal"
			error={parsed ? undefined : 'A price like 0.00 or 1.49'}
			supportingText="0.00 makes it free. No money moves in this preview."
		/>
		<AiQuestion
			value={aiUse}
			onchange={(v) => (aiUse = v)}
			what={kind === 'pack' ? 'these pictures' : 'this narration'}
		/>
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	</div>
	{#snippet actions()}
		<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
		<Button disabled={!name.trim() || !parsed} pending={saving} onclick={() => void save()}
			>{existing ? 'Save' : 'Create'}</Button
		>
	{/snippet}
</Dialog>

<style>
	.form {
		display: grid;
		gap: var(--space-3);
	}

	.problem {
		margin: 0;
		color: var(--md-sys-color-error);
	}
</style>
