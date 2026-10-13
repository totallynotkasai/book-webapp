<script lang="ts">
	import type { FlagTargetType, ReportReason } from '@book/core';
	import { Button, Dialog, RadioGroup, TextField } from '@book/ui';
	import { untrack } from 'svelte';
	import { describeError } from '$lib/errors';
	import { getBackend } from '$lib/services';
	import { snackbars } from '$lib/state/snackbar.svelte';

	/**
	 * A reader's report (DESIGN.md §10.6, P1-ADM-02): a reason is required; it goes to the
	 * moderators' review queue, and more reports raise its priority.
	 */
	interface Props {
		open: boolean;
		target: { type: Exclude<FlagTargetType, 'creator'>; id: string; title: string } | null;
	}

	let { open = $bindable(), target }: Props = $props();

	let reason = $state<ReportReason | null>(null);
	let details = $state('');
	let sending = $state(false);
	let problem = $state<string | null>(null);

	$effect(() => {
		if (!open) return;
		untrack(() => {
			reason = null;
			details = '';
			problem = null;
		});
	});

	const needsDetails = $derived(reason === 'other' && !details.trim());

	async function send() {
		if (!target || !reason || needsDetails || sending) return;
		sending = true;
		problem = null;
		try {
			await (
				await getBackend()
			).community.report({
				targetType: target.type,
				targetId: target.id,
				reason,
				details: details.trim()
			});
			open = false;
			snackbars.show('Reported. A moderator will look at it.');
		} catch (error) {
			problem = describeError(error).message;
		} finally {
			sending = false;
		}
	}
</script>

<Dialog
	bind:open
	title={target ? `Report “${target.title}”` : 'Report'}
	description="Moderators look at every report. Say what’s wrong."
	size="medium"
>
	<div class="form" data-testid="report-dialog">
		<RadioGroup
			label="What’s wrong?"
			value={reason ?? ('' as ReportReason)}
			onchange={(v) => (reason = v)}
			options={[
				{ value: 'ai_unlabelled', label: 'Made with AI but not labelled' },
				{ value: 'inappropriate', label: 'Inappropriate or harmful' },
				{ value: 'copyright', label: 'Copied from someone else' },
				{ value: 'spam', label: 'Spam or misleading' },
				{ value: 'other', label: 'Something else' }
			]}
		/>
		<TextField
			label={reason === 'other' ? 'Tell us more' : 'Details (optional)'}
			bind:value={details}
			multiline
			rows={3}
		/>
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	</div>
	{#snippet actions()}
		<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
		<Button
			icon="flag"
			disabled={!reason || needsDetails}
			pending={sending}
			onclick={() => void send()}>Report</Button
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
