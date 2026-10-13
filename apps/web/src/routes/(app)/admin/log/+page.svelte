<script lang="ts">
	import { resolve } from '$app/paths';
	import { Skeleton } from '@book/ui';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { formatDate } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';

	// The append-only moderation action log (DESIGN.md §10.6, P1-ADM-02): every action with its
	// reason, who took it and when. Nothing in it is ever changed or deleted.
	const log = resource(async () => (await getBackend()).moderation.listActions({ limit: 100 }), {
		topics: ['moderation']
	});

	const actionLabels = {
		approve: 'Approved',
		require_relabel: 'Asked to relabel',
		hide: 'Hid',
		remove: 'Removed',
		warn: 'Warned',
		suspend: 'Suspended'
	} as const;
</script>

<svelte:head><title>Moderation log · Book Reader</title></svelte:head>

<div class="page">
	<PageHeader
		title="Moderation log"
		subtitle="Every action, with its reason. Entries are never changed or deleted."
		back={{ href: resolve('/(app)/admin'), label: 'Back to the review queue' }}
	/>
	<StatusView resource={log} what="The moderation log">
		{#snippet loading()}<Skeleton height="6rem" shape="block" />{/snippet}
		{#snippet empty()}
			<EmptyState icon="gavel" title="No actions yet" message="Actions on Flags appear here." />
		{/snippet}
		{#snippet children(list)}
			<ol class="log">
				{#each list.items as entry (entry.id)}
					<li data-testid="log-entry">
						<span class="what"
							><strong>{actionLabels[entry.action]}</strong> “{entry.targetTitle}”{entry.creatorName
								? ` by ${entry.creatorName}`
								: ''}</span
						>
						<span class="reason">{entry.reason}</span>
						<span class="meta">{entry.moderatorName} · {formatDate(entry.createdAt)}</span>
					</li>
				{/each}
			</ol>
		{/snippet}
	</StatusView>
</div>

<style>
	.page {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		max-width: 48rem;
	}

	.log {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.log li {
		display: grid;
		gap: 2px;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.meta {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}
</style>
