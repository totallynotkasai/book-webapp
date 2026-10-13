<script lang="ts">
	import { resolve } from '$app/paths';
	import type { CuratedLayerDto } from '@book/core';
	import { Badge, Button, Dialog, Icon, Skeleton, Switch, TextField } from '@book/ui';
	import StarRating from '$lib/community/StarRating.svelte';
	import AiLabel from '$lib/components/AiLabel.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { describeError } from '$lib/errors';
	import { flagRuleLabels, formatDate } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import { listingStateLabels, listingStateTones } from './summaries';

	/**
	 * The author's curation view for one of their Books (DESIGN.md §10.6, P1-ADM-02): community
	 * submissions to approve or decline, community Layers to endorse or hide, and the Flags and
	 * reports on the Book and its Layers.
	 */
	interface Props {
		bookId: string;
	}

	let { bookId }: Props = $props();

	const curation = resource(async () => (await getBackend()).studio.curation(bookId), {
		topics: ['studio', 'community', 'moderation']
	});

	const policyText = {
		closed: 'Community work isn’t accepted. Change this in Details.',
		approval: 'You approve each community submission before readers see it.',
		open: 'Community work is listed straight away; you can hide anything.'
	} as const;

	let deciding = $state.raw<{ layer: CuratedLayerDto; approve: boolean } | null>(null);
	let decideOpen = $state(false);
	let reason = $state('');
	let busy = $state(false);

	function decide(layer: CuratedLayerDto, approve: boolean) {
		deciding = { layer, approve };
		reason = '';
		decideOpen = true;
	}

	async function run(work: () => Promise<unknown>, done: string) {
		if (busy) return;
		busy = true;
		try {
			await work();
			snackbars.show(done);
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		} finally {
			busy = false;
		}
	}

	async function confirmDecision() {
		const d = deciding;
		if (!d) return;
		await run(
			async () =>
				(await getBackend()).studio.decide(d.layer.id, d.approve ? 'approve' : 'decline', reason),
			d.approve ? `“${d.layer.name}” is listed.` : `“${d.layer.name}” was declined.`
		);
		decideOpen = false;
	}

	const kindLabel = (l: CuratedLayerDto) =>
		l.kind === 'audio_track'
			? `Narration · ${l.items} chapters`
			: `Illustration pack · ${l.items} pictures`;
</script>

<StatusView resource={curation} what="Community for this book">
	{#snippet loading()}<Skeleton height="6rem" shape="block" />{/snippet}
	{#snippet children(c)}
		<div class="panel" data-testid="curation">
			<p class="policy"><Icon name="info" size={18} /> {policyText[c.policy]}</p>

			<section aria-labelledby="pending-heading">
				<h3 id="pending-heading">Waiting for you ({c.pending.length})</h3>
				{#if !c.pending.length}<p class="muted">No submissions to look at.</p>{/if}
				<ul class="layers">
					{#each c.pending as layer (layer.id)}
						<li data-testid="pending-layer">
							<div class="text">
								<span class="name">{layer.name}</span>
								<span class="meta"
									>{kindLabel(layer)} · by
									<a href={resolve('/(app)/creator/[handle]', { handle: layer.creatorHandle })}
										>{layer.creatorName}</a
									></span
								>
								<AiLabel aiUse={layer.aiUse ?? 'none'} />
							</div>
							<div class="actions">
								<Button onclick={() => decide(layer, true)}>Approve</Button>
								<Button variant="outlined" onclick={() => decide(layer, false)}>Decline</Button>
							</div>
						</li>
					{/each}
				</ul>
			</section>

			<section aria-labelledby="community-heading">
				<h3 id="community-heading">Community work on this book</h3>
				{#if !c.layers.length}<p class="muted">None yet.</p>{/if}
				<ul class="layers">
					{#each c.layers as layer (layer.id)}
						<li data-testid="curated-layer">
							<div class="text">
								<span class="name">{layer.name}</span>
								<span class="meta">{kindLabel(layer)} · by {layer.creatorName}</span>
								<span class="badges">
									<Badge tone={listingStateTones[layer.state]}
										>{listingStateLabels[layer.state]}</Badge
									>
									<AiLabel aiUse={layer.aiUse ?? 'none'} />
								</span>
								<StarRating name={layer.name} rating={layer.rating} />
							</div>
							<div class="actions">
								<Switch
									label="Author-endorsed"
									checked={layer.endorsed}
									disabled={busy || layer.state !== 'listed'}
									onchange={(on) =>
										void run(
											async () => (await getBackend()).studio.endorse(layer.id, on),
											on ? 'Endorsed.' : 'No longer endorsed.'
										)}
								/>
								{#if layer.state === 'listed'}
									<Button
										variant="text"
										icon="visibility_off"
										onclick={() =>
											void run(
												async () =>
													(await getBackend()).studio.setCommunityListing(layer.id, false),
												'Hidden from the store.'
											)}>Hide</Button
									>
								{:else if layer.state === 'delisted'}
									<Button
										variant="text"
										icon="visibility"
										onclick={() =>
											void run(
												async () => (await getBackend()).studio.setCommunityListing(layer.id, true),
												'Listed again.'
											)}>List again</Button
									>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</section>

			<section aria-labelledby="flags-heading">
				<h3 id="flags-heading">Flags and reports</h3>
				{#if !c.flags.length}<p class="muted">None.</p>{/if}
				<ul class="flags">
					{#each c.flags as flag, i (i)}
						<li>
							<Badge tone={flag.rule === 'report' ? 'error' : 'tertiary'}
								>{flagRuleLabels[flag.rule]}</Badge
							>
							<span><strong>{flag.targetTitle}</strong>: {flag.details}</span>
							<span class="muted">{formatDate(flag.createdAt)}</span>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	{/snippet}
</StatusView>

<Dialog
	bind:open={decideOpen}
	title={deciding ? `${deciding.approve ? 'Approve' : 'Decline'} “${deciding.layer.name}”?` : ''}
	description={deciding?.approve
		? 'It will be listed in this book’s community hub. Its creator is told.'
		: 'It won’t be listed. Tell its creator why, so they can improve it.'}
>
	<TextField
		label={deciding?.approve ? 'A note for the creator (optional)' : 'Why (sent to the creator)'}
		bind:value={reason}
		multiline
		rows={2}
	/>
	{#snippet actions()}
		<Button variant="text" onclick={() => (decideOpen = false)}>Cancel</Button>
		<Button pending={busy} onclick={() => void confirmDecision()}
			>{deciding?.approve ? 'Approve' : 'Decline'}</Button
		>
	{/snippet}
</Dialog>

<style>
	.panel {
		display: grid;
		gap: var(--space-5);
		padding-top: var(--space-4);
	}

	.policy {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	h3 {
		margin: 0 0 var(--space-2);
		font-size: var(--md-sys-typescale-title-medium-size);
	}

	.layers,
	.flags {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.layers li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--space-2);
		align-items: center;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	@media (max-width: 599.98px) {
		.layers li {
			grid-template-columns: 1fr;
		}
	}

	.flags li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.text {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.name {
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.meta,
	.muted {
		margin: 0;
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
</style>
