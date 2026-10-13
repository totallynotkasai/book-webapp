<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge, Icon, Skeleton } from '@book/ui';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { formatAmount } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';

	// Simulated earnings (P1-STU-04): what sales, Tips and subscriptions would earn, split by
	// placeholder rules from one config (OPEN-08 stays open). Every figure is labelled simulated.
	const earnings = resource(async () => (await getBackend()).studio.earnings(), {
		topics: ['studio', 'entitlements', 'support']
	});

	const kindLabels = { sales: 'Sale', tips: 'Tips', subscriptions: 'Subscription' } as const;
</script>

<svelte:head><title>Earnings · Studio · Book Reader</title></svelte:head>

<div class="page">
	<PageHeader
		title="Earnings"
		back={{ href: resolve('/(app)/studio'), label: 'Back to the Studio' }}
	>
		<Badge tone="simulated" icon="science">Simulated: every figure here is made up</Badge>
	</PageHeader>

	<StatusView resource={earnings} what="Your earnings" isEmpty={(e) => e.lines.length === 0}>
		{#snippet loading()}<Skeleton height="10rem" shape="block" />{/snippet}
		{#snippet empty()}
			<EmptyState
				icon="payments"
				title="Nothing yet"
				message="When readers buy, tip or subscribe (simulated), it shows here."
			/>
		{/snippet}
		{#snippet children(e)}
			<div class="totals" data-testid="earnings-total">
				<div>
					<span class="label">Your share</span>
					<span class="value">{formatAmount(e.total.yours)}</span>
				</div>
				<div>
					<span class="label">Readers paid</span>
					<span class="value small">{formatAmount(e.total.gross)}</span>
				</div>
				<div>
					<span class="label">Platform fee</span>
					<span class="value small">{formatAmount(e.total.platform)}</span>
				</div>
				<div>
					<span class="label">Subscribers now</span>
					<span class="value small">{e.activeSubscribers}</span>
				</div>
			</div>

			<div class="table-wrap">
				<table>
					<caption class="visually-hidden">Earnings by source (simulated)</caption>
					<thead>
						<tr>
							<th scope="col">From</th>
							<th scope="col">Count</th>
							<th scope="col">Paid</th>
							<th scope="col">Platform</th>
							<th scope="col">Others</th>
							<th scope="col">Yours</th>
						</tr>
					</thead>
					<tbody>
						{#each e.lines as line (line.kind + line.label)}
							<tr>
								<th scope="row">
									<span class="kind">{kindLabels[line.kind]}</span>
									{line.label}
								</th>
								<td>{line.count}</td>
								<td>{formatAmount(line.split.gross)}</td>
								<td>{formatAmount(line.split.platform)}</td>
								<td>{formatAmount(line.split.others)}</td>
								<td>{formatAmount(line.split.yours)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<section class="notes" aria-labelledby="splits-heading">
				<h2 id="splits-heading"><Icon name="info" size={20} /> How it’s split (placeholders)</h2>
				<ul>
					{#each e.splitNotes as note (note)}<li>{note}</li>{/each}
				</ul>
				<p>The real splits aren’t decided yet. Nothing here is money.</p>
			</section>
		{/snippet}
	</StatusView>
</div>

<style>
	.page {
		display: grid;
		/* The column never grows wider than the screen to fit wide content (tabs, tables). */
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		max-width: 56rem;
	}

	.totals {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: var(--space-3);
	}

	.totals > div {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.label {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.value {
		font-size: var(--md-sys-typescale-headline-small-size);
	}

	.value.small {
		font-size: var(--md-sys-typescale-title-large-size);
	}

	.table-wrap {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}

	th,
	td {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--md-sys-color-outline-variant);
		text-align: right;
		white-space: nowrap;
	}

	th:first-child {
		text-align: left;
		white-space: normal;
	}

	thead th {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.kind {
		display: block;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
		font-weight: normal;
	}

	.notes h2 {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 0 var(--space-2);
		font-size: var(--md-sys-typescale-title-medium-size);
	}

	.notes ul,
	.notes p {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
