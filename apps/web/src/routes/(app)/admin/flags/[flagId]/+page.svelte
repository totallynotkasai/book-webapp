<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { ModerationAction } from '@book/core';
	import { Badge, Button, Dialog, Skeleton, TextField } from '@book/ui';
	import AiLabel from '$lib/components/AiLabel.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { describeError } from '$lib/errors';
	import { flagRuleLabels, formatDate } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';

	// A Flag's detail (DESIGN.md §10.6, P1-ADM-02): the content, the rule that fired, the evidence
	// (detector score, readers' reports) and the creator's history, with actions that each need a
	// reason. Every action is logged, and the creator is told in their inbox how to appeal.
	const flagId = $derived(page.params.flagId ?? '');
	const detail = resource(async () => (await getBackend()).moderation.getFlag(flagId), {
		topics: ['moderation']
	});

	const ACTIONS: { action: ModerationAction; label: string; help: string; content: boolean }[] = [
		{
			action: 'approve',
			label: 'Approve',
			help: 'It’s fine. Held content is listed again.',
			content: false
		},
		{
			action: 'require_relabel',
			label: 'Require relabelling',
			help: 'Keep it private until the creator corrects its AI label; then approve.',
			content: true
		},
		{
			action: 'hide',
			label: 'Hide',
			help: 'Take it out of the store; owners keep it.',
			content: true
		},
		{ action: 'remove', label: 'Remove', help: 'Take it down for everyone.', content: true },
		{
			action: 'warn',
			label: 'Warn',
			help: 'Tell the creator, change nothing else.',
			content: false
		},
		{
			action: 'suspend',
			label: 'Suspend account',
			help: 'Stop the creator publishing.',
			content: false
		}
	];

	const targetLabels = {
		book: 'Book',
		illustration_pack: 'Illustration pack',
		audio_track: 'Narration',
		creator: 'Creator'
	} as const;

	const stateLabels: Record<string, string> = {
		draft: 'Draft',
		pending: 'Waiting for the author',
		listed: 'Listed',
		held: 'Held for review',
		declined: 'Declined by the author',
		delisted: 'Hidden',
		removed: 'Removed'
	};

	const reasonLabels = {
		ai_unlabelled: 'Made with AI but not labelled',
		inappropriate: 'Inappropriate or harmful',
		copyright: 'Copied from someone else',
		spam: 'Spam or misleading',
		other: 'Something else'
	} as const;

	let open = $state(false);
	let choice = $state.raw<(typeof ACTIONS)[number] | null>(null);
	let reason = $state('');
	let acting = $state(false);

	function start(action: (typeof ACTIONS)[number]) {
		choice = action;
		reason = '';
		open = true;
	}

	async function act() {
		if (!choice || reason.trim().length < 3 || acting) return;
		acting = true;
		try {
			await (await getBackend()).moderation.act(flagId, { action: choice.action, reason });
			open = false;
			snackbars.show(`${choice.label}: done. The creator has been told.`);
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		} finally {
			acting = false;
		}
	}
</script>

<svelte:head><title>Flag · Review queue · Book Reader</title></svelte:head>

<div class="page">
	<StatusView resource={detail} what="This Flag">
		{#snippet loading()}<Skeleton height="10rem" shape="block" />{/snippet}
		{#snippet children(d)}
			<PageHeader
				title={`${targetLabels[d.target.type]}: ${d.target.title}`}
				back={{ href: resolve('/(app)/admin'), label: 'Back to the review queue' }}
			>
				<div class="badges">
					<Badge tone={d.flag.rule === 'report' ? 'error' : 'tertiary'}
						>{flagRuleLabels[d.flag.rule]}</Badge
					>
					<Badge
						>{d.flag.state === 'open'
							? 'Open'
							: d.flag.state === 'cleared'
								? 'Cleared'
								: 'Actioned'}</Badge
					>
					{#if d.target.state}<Badge>{stateLabels[d.target.state]}</Badge>{/if}
					{#if d.target.relabelRequired}<Badge tone="error">Relabelling requested</Badge>{/if}
				</div>
			</PageHeader>

			<section class="card" aria-labelledby="what-heading">
				<h2 id="what-heading">What fired</h2>
				<p>{d.flag.details}</p>
				<dl>
					<dt>Creator</dt>
					<dd>{d.target.creatorName || '—'}</dd>
					{#if d.target.bookTitle}
						<dt>For</dt>
						<dd>{d.target.bookTitle}</dd>
					{/if}
					{#if d.target.type !== 'creator'}
						<dt>AI label</dt>
						<dd>
							{#if d.target.aiUse && d.target.aiUse !== 'none'}<AiLabel
									aiUse={d.target.aiUse}
								/>{:else}Not labelled AI{/if}
						</dd>
					{/if}
					{#if d.detectorScore !== null}
						<dt>Detector score</dt>
						<dd>
							{d.detectorScore.toFixed(2)}
							<span class="muted">(evidence for you, never a verdict; simulated)</span>
						</dd>
					{/if}
					<dt>Raised</dt>
					<dd>{formatDate(d.flag.createdAt)} · priority {d.flag.priority}</dd>
				</dl>
			</section>

			{#if d.reports.length}
				<section class="card" aria-labelledby="reports-heading">
					<h2 id="reports-heading">Reports ({d.reports.length})</h2>
					<ul class="plain">
						{#each d.reports as report, i (i)}
							<li>
								<strong>{reasonLabels[report.reason]}</strong>
								{#if report.details}— “{report.details}”{/if}
								<span class="muted">{formatDate(report.createdAt)}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if d.flag.state === 'open'}
				<section class="card" aria-labelledby="actions-heading">
					<h2 id="actions-heading">Decide</h2>
					<ul class="actions">
						{#each ACTIONS.filter((a) => d.target.type !== 'creator' || !a.content) as a (a.action)}
							<li>
								<Button
									variant={a.action === 'approve' ? 'filled' : 'outlined'}
									danger={a.action === 'remove' || a.action === 'suspend'}
									onclick={() => start(a)}>{a.label}</Button
								>
								<span class="muted">{a.help}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section class="card" aria-labelledby="history-heading">
				<h2 id="history-heading">The creator’s history</h2>
				{#if !d.history.flags.length && !d.history.actions.length}
					<p class="muted">Nothing before this.</p>
				{/if}
				<ul class="plain">
					{#each d.history.actions as action (action.id)}
						<li>
							<strong>{ACTIONS.find((a) => a.action === action.action)?.label}</strong>
							“{action.targetTitle}” — {action.reason}
							<span class="muted">by {action.moderatorName}, {formatDate(action.createdAt)}</span>
						</li>
					{/each}
					{#each d.history.flags as flag (flag.id)}
						<li>
							<strong>{flagRuleLabels[flag.rule]}</strong> on “{flag.targetTitle}” ({flag.state})
							<span class="muted">{formatDate(flag.createdAt)}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/snippet}
	</StatusView>
</div>

<Dialog
	bind:open
	title={choice ? `${choice.label}?` : ''}
	description={choice ? `${choice.help} The reason goes in the log and to the creator.` : ''}
	size="medium"
>
	<TextField label="Reason" bind:value={reason} multiline rows={3} required />
	{#snippet actions()}
		<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
		<Button
			disabled={reason.trim().length < 3}
			pending={acting}
			danger={choice?.action === 'remove' || choice?.action === 'suspend'}
			onclick={() => void act()}>{choice?.label ?? 'Confirm'}</Button
		>
	{/snippet}
</Dialog>

<style>
	.page {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		max-width: 48rem;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.card {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	h2 {
		margin: 0;
		font-size: var(--md-sys-typescale-title-medium-size);
	}

	p {
		margin: 0;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-1) var(--space-3);
		margin: 0;
	}

	dt {
		color: var(--md-sys-color-on-surface-variant);
	}

	dd {
		margin: 0;
	}

	.plain,
	.actions {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.actions li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.muted {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}
</style>
