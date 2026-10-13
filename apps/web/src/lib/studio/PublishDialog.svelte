<script lang="ts">
	import type { AiUse, StudioBookDetailDto, StudioRevisionDto } from '@book/core';
	import { Button, Dialog } from '@book/ui';
	import { untrack } from 'svelte';
	import { describeError } from '$lib/errors';
	import { getBackend } from '$lib/services';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import AiQuestion from './AiQuestion.svelte';
	import { changeSummary } from './summaries';

	/**
	 * Publishing a version is a deliberate step (plan §6 Phase 1.7 UX notes): a confirmation that
	 * says what changed, the AI question (required, §10.6), then a "Published" snackbar.
	 */
	interface Props {
		open: boolean;
		book: StudioBookDetailDto;
		revision: StudioRevisionDto | null;
	}

	let { open = $bindable(), book, revision }: Props = $props();

	let aiUse = $state<AiUse | null>(null);
	let publishing = $state(false);
	let problem = $state<string | null>(null);

	$effect(() => {
		if (!open) return;
		untrack(() => {
			// A new version starts from the answer the Book has now; a first version has none.
			aiUse = book.aiUse;
			problem = null;
		});
	});

	const summary = $derived(revision ? changeSummary(revision, book) : '');

	async function publish() {
		if (!revision || !aiUse || publishing) return;
		publishing = true;
		problem = null;
		try {
			await (
				await getBackend()
			).studio.publishRevision(book.id, {
				revisionId: revision.id,
				aiUse
			});
			open = false;
			snackbars.show(
				book.listingState === 'draft' ? 'Published. It’s in the store now.' : 'Published.'
			);
		} catch (error) {
			problem = describeError(error).message;
		} finally {
			publishing = false;
		}
	}
</script>

<Dialog bind:open title="Publish this version?" description={summary} size="medium">
	<div class="form" data-testid="publish-dialog">
		<AiQuestion value={aiUse} onchange={(v) => (aiUse = v)} what="this version" />
		{#if !aiUse}<p class="muted">Answer this to publish.</p>{/if}
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	</div>
	{#snippet actions()}
		<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
		<Button icon="publish" disabled={!aiUse} pending={publishing} onclick={() => void publish()}
			>Publish version</Button
		>
	{/snippet}
</Dialog>

<style>
	.form {
		display: grid;
		gap: var(--space-3);
	}

	.muted {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.problem {
		margin: 0;
		color: var(--md-sys-color-error);
	}
</style>
