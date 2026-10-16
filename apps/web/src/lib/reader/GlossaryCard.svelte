<script lang="ts">
	import type { GlossaryEntryAt } from '@book/domain';
	import { Button, Dialog } from '@book/ui';

	/**
	 * A glossary entry, from "In the glossary" in the selection toolbar (P1-RDR-13): offered only
	 * for a name the reader has already met, with only the names they've met (Invariant 6).
	 */
	interface Props {
		open: boolean;
		entry: GlossaryEntryAt | null;
		/** Where it first appears, by title. */
		where: string;
		onfirst: () => void;
	}

	let { open = $bindable(), entry, where, onfirst }: Props = $props();
</script>

<Dialog
	bind:open
	title={entry?.name ?? 'In the glossary'}
	description={entry?.alsoCalled.length ? `Also called ${entry.alsoCalled.join(', ')}` : undefined}
>
	{#if entry}
		<div class="card" data-testid="glossary-card">
			{#if entry.picture}
				<img
					src={entry.picture.url}
					alt={entry.picture.alt}
					width={entry.picture.width}
					height={entry.picture.height}
					style:background={entry.picture.dominant}
				/>
			{/if}
			<p>{entry.description}</p>
			<p class="where">First appears in {where}</p>
		</div>
	{/if}
	{#snippet actions()}
		<Button
			variant="text"
			onclick={() => {
				open = false;
				onfirst();
			}}>Go there</Button
		>
		<Button onclick={() => (open = false)}>Close</Button>
	{/snippet}
</Dialog>

<style>
	.card {
		display: grid;
		gap: var(--space-3);
	}

	img {
		justify-self: center;
		width: auto;
		max-width: 100%;
		height: auto;
		max-height: 14rem;
		border-radius: var(--md-sys-shape-corner-medium);
	}

	p {
		margin: 0;
		font-family: var(--font-literata);
		line-height: 1.5;
	}

	.where {
		color: var(--md-sys-color-on-surface-variant);
		font-family: var(--font-ui);
		font-size: var(--md-sys-typescale-body-small-size);
	}
</style>
