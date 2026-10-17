<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge, Button, Skeleton } from '@book/ui';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { flagRuleLabels, formatDate } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';

	// The admin review queue (P1-APP-01, P1-ADM-02): open Flags, highest priority first, each
	// opening its detail and actions. Moderators only; backend-local enforces it (FORBIDDEN), as
	// the Phase 2 API will (§10.6).
	const queue = resource(async () => (await getBackend()).moderation.listQueue({ limit: 100 }), {
		topics: ['moderation', 'session']
	});

	const targetLabels = {
		book: 'Book',
		illustration_pack: 'Illustration pack',
		review: 'Review',
		audio_track: 'Narration',
		creator: 'Creator'
	} as const;
</script>

<svelte:head><title>Review queue · Book Reader</title></svelte:head>

<div>
	<PageHeader
		title="Review queue"
		subtitle="Flags and reports, highest priority first. Detector scores are evidence for you, never a verdict."
		back={{ href: resolve('/you'), label: 'Back to You' }}
	>
		{#snippet actions()}
			<Button variant="text" icon="gavel" href={resolve('/(app)/admin/log')}>Action log</Button>
		{/snippet}
	</PageHeader>

	<StatusView resource={queue} what="The review queue">
		{#snippet loading()}
			{#each [1, 2, 3] as i (i)}<Skeleton height="6rem" shape="block" />{/each}
		{/snippet}
		{#snippet empty()}
			<EmptyState
				icon="check_circle"
				title="Nothing to review"
				message="New Flags and reports will appear here."
			/>
		{/snippet}
		{#snippet children(list)}
			<ul class="flags">
				{#each list.items as flag (flag.id)}
					<li>
						<div class="heading">
							<Badge tone={flag.rule === 'report' ? 'error' : 'tertiary'}
								>{flagRuleLabels[flag.rule]}</Badge
							>
							<a class="target" href={resolve('/(app)/admin/flags/[flagId]', { flagId: flag.id })}
								>{targetLabels[flag.targetType]}: {flag.targetTitle}</a
							>
						</div>
						<p class="details">{flag.details}</p>
						<p class="meta">Priority {flag.priority} · {formatDate(flag.createdAt)}</p>
					</li>
				{/each}
			</ul>
		{/snippet}
	</StatusView>
</div>

<style>
	.flags {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.flags li {
		padding: var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.target {
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.details {
		margin: var(--space-2) 0;
	}

	.meta {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}
</style>
