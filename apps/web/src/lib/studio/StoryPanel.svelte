<script lang="ts">
	import type { AiUse, StudioGlossaryEntryDto, StudioRecapDto, StudioStoryDto } from '@book/core';
	import { Badge, Button, Dialog, Icon, IconButton, Skeleton, TextField } from '@book/ui';
	import AiLabel from '$lib/components/AiLabel.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { describeError } from '$lib/errors';
	import { formatDate } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import AiQuestion from './AiQuestion.svelte';
	import GlossaryEntryDialog from './GlossaryEntryDialog.svelte';

	/**
	 * The "Story so far" tab of a Book in the Studio (P1-STU-05; plan §6 Phase 1.14 UX notes): a
	 * recap per Chapter and glossary entries, each showing where it first appears. Changes are a
	 * draft until published; readers then see each recap and entry only once they've reached it.
	 */
	interface Props {
		bookId: string;
	}

	let { bookId }: Props = $props();

	const story = resource(async () => (await getBackend()).studio.getStory(bookId), {
		topics: ['studio']
	});

	// ---- recaps ----

	/** What's typed in each recap box, by Chapter, while it differs from what's saved. */
	let typed = $state<Record<string, string>>({});
	let savingRecap = $state<string | null>(null);
	const textOf = (recap: StudioRecapDto) => typed[recap.chapterId] ?? recap.text;
	const isDirty = (recap: StudioRecapDto) =>
		typed[recap.chapterId] !== undefined && typed[recap.chapterId]!.trim() !== recap.text;

	async function saveRecap(recap: StudioRecapDto) {
		if (savingRecap) return;
		savingRecap = recap.chapterId;
		try {
			story.data = await (
				await getBackend()
			).studio.saveRecap(bookId, { chapterId: recap.chapterId, text: textOf(recap) });
			delete typed[recap.chapterId];
			snackbars.show(textOf(recap).trim() ? 'Recap saved.' : 'Recap removed.');
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		} finally {
			savingRecap = null;
		}
	}

	// ---- glossary ----

	let entryOpen = $state(false);
	let editing = $state.raw<StudioGlossaryEntryDto | null>(null);

	function edit(entry: StudioGlossaryEntryDto | null) {
		editing = entry;
		entryOpen = true;
	}

	async function remove(entry: StudioGlossaryEntryDto) {
		try {
			story.data = await (await getBackend()).studio.removeGlossaryEntry(bookId, entry.id);
			snackbars.show(`“${entry.name}” removed.`);
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		}
	}

	// ---- publishing ----

	let publishOpen = $state(false);
	let aiUse = $state<AiUse | null>(null);
	let publishing = $state(false);
	let publishProblem = $state<string | null>(null);

	function openPublish(current: StudioStoryDto) {
		aiUse = current.aiUse;
		publishProblem = null;
		publishOpen = true;
	}

	async function publish() {
		if (!aiUse || publishing) return;
		publishing = true;
		publishProblem = null;
		try {
			story.data = await (await getBackend()).studio.publishStory(bookId, { aiUse });
			publishOpen = false;
			snackbars.show('Published. Readers see each part once they’ve reached it.');
		} catch (error) {
			publishProblem = describeError(error).message;
		} finally {
			publishing = false;
		}
	}

	function status(s: StudioStoryDto): string {
		if (!s.publishedAt) return 'Not published yet';
		const when = `Published ${formatDate(s.publishedAt)}`;
		return s.unpublishedChanges ? `${when} · changes not published yet` : when;
	}

	const unsaved = $derived((story.data?.recaps ?? []).filter((r) => isDirty(r)).length);
</script>

<StatusView resource={story} what="The story so far">
	{#snippet loading()}<Skeleton height="10rem" shape="block" />{/snippet}
	{#snippet children(s)}
		<div class="panel" data-testid="story-panel">
			<p class="intro">
				Readers find these in Contents, under Story so far: the recap of each chapter they’ve
				finished, and each glossary entry once its name has appeared. Nothing from ahead of them.
			</p>
			<div class="publish-row">
				<div class="state">
					<Badge tone={s.publishedAt && !s.unpublishedChanges ? 'primary' : 'neutral'}>
						{status(s)}
					</Badge>
					{#if s.publishedAt && s.aiUse}<AiLabel aiUse={s.aiUse} />{/if}
				</div>
				<Button
					icon="publish"
					disabled={!s.unpublishedChanges || unsaved > 0}
					onclick={() => openPublish(s)}>Publish…</Button
				>
			</div>
			{#if unsaved > 0}
				<p class="muted">Save or undo your recap changes before publishing.</p>
			{/if}
			{#if s.problems.length && s.unpublishedChanges}
				<ul class="problems" aria-label="Before publishing">
					{#each s.problems as problem (problem)}
						<li><Icon name="warning" size={18} /><span>{problem}</span></li>
					{/each}
				</ul>
			{/if}

			<section aria-labelledby="recaps-heading">
				<h2 id="recaps-heading">Recaps</h2>
				<p class="muted">
					A few sentences per chapter, for readers coming back after a break. Leave a chapter empty
					to skip it.
				</p>
				<ol class="recaps">
					{#each s.recaps as recap (recap.chapterId)}
						<li data-testid="recap">
							<TextField
								label={recap.title || 'Untitled chapter'}
								value={textOf(recap)}
								oninput={(e) => (typed[recap.chapterId] = e.currentTarget.value)}
								multiline
								rows={3}
								maxlength={2000}
								supportingText={recap.changed
									? 'This chapter changed in a newer version since you wrote its recap. Check it still fits, then save it.'
									: undefined}
							/>
							{#if recap.changed && !isDirty(recap)}
								<Badge tone="tertiary" icon="warning">Chapter changed since</Badge>
							{/if}
							{#if isDirty(recap) || recap.changed}
								<div class="actions">
									{#if isDirty(recap)}
										<Button variant="text" onclick={() => delete typed[recap.chapterId]}
											>Undo</Button
										>
									{/if}
									<Button
										variant="tonal"
										pending={savingRecap === recap.chapterId}
										onclick={() => void saveRecap(recap)}>Save recap</Button
									>
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			</section>

			<section aria-labelledby="glossary-heading">
				<h2 id="glossary-heading">Glossary</h2>
				<p class="muted">
					Characters, places and things, in the order they first appear. Each is shown to a reader
					once one of its names has appeared.
				</p>
				<Button icon="add" onclick={() => edit(null)}>Add an entry</Button>
				{#if s.glossary.length}
					<ul class="entries">
						{#each s.glossary as entry (entry.id)}
							<li data-testid="glossary-entry">
								{#if entry.picture}
									<img
										class="thumb"
										src={entry.picture.url}
										alt={entry.picture.alt}
										style:background={entry.picture.dominant}
									/>
								{/if}
								<div class="entry-text">
									<span class="name">{entry.name}</span>
									{#if entry.aliases.length}
										<span class="meta">Also called {entry.aliases.join(', ')}</span>
									{/if}
									<span class="description">{entry.description}</span>
									{#each entry.names as n, i (i)}
										{#if n.firstAppearance}
											{#if i === 0 || n.chapterId !== entry.names[0]!.chapterId}
												<span class="where">
													{i === 0 ? 'First appears' : `“${n.name}” first appears`} in
													{n.chapterTitle || 'a chapter'}:
													<q>{n.context}</q>
												</span>
											{/if}
										{:else}
											<span class="missing">
												<Icon name="warning" size={16} />
												{i === 0
													? 'Not in the book’s text, so it can’t be published. Check the spelling.'
													: `“${n.name}” isn’t in the text yet, so it isn’t used.`}
											</span>
										{/if}
									{/each}
								</div>
								<div class="entry-actions">
									<IconButton
										icon="edit"
										label={`Edit ${entry.name}`}
										onclick={() => edit(entry)}
									/>
									<IconButton
										icon="delete"
										label={`Remove ${entry.name}`}
										onclick={() => void remove(entry)}
									/>
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="muted">No entries yet.</p>
				{/if}
			</section>
		</div>

		<GlossaryEntryDialog
			bind:open={entryOpen}
			{bookId}
			entry={editing}
			onsaved={(next) => (story.data = next)}
		/>
		<Dialog
			bind:open={publishOpen}
			title="Publish the story so far?"
			description="Readers will see each recap and entry once they’ve reached it, never before."
			size="medium"
		>
			<div class="form" data-testid="publish-story-dialog">
				<AiQuestion value={aiUse} onchange={(v) => (aiUse = v)} what="these recaps and entries" />
				{#if !aiUse}<p class="muted">Answer this to publish.</p>{/if}
				{#if publishProblem}<p class="problem" role="alert">{publishProblem}</p>{/if}
			</div>
			{#snippet actions()}
				<Button variant="text" onclick={() => (publishOpen = false)}>Cancel</Button>
				<Button icon="publish" disabled={!aiUse} pending={publishing} onclick={() => void publish()}
					>Publish</Button
				>
			{/snippet}
		</Dialog>
	{/snippet}
</StatusView>

<style>
	.panel {
		display: grid;
		gap: var(--space-4);
		padding-top: var(--space-4);
	}

	.intro,
	.muted,
	.problem {
		margin: 0;
	}

	.intro {
		max-width: 40rem;
	}

	.muted {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.problem {
		color: var(--md-sys-color-error);
	}

	.publish-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		justify-content: space-between;
	}

	.state {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.problems {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: var(--space-3);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-error-container);
		color: var(--md-sys-color-on-error-container);
		list-style: none;
	}

	.problems li,
	.missing {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
	}

	section {
		display: grid;
		gap: var(--space-3);
		justify-items: start;
	}

	h2 {
		margin: var(--space-2) 0 0;
		font-size: var(--md-sys-typescale-title-medium-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.recaps,
	.entries {
		display: grid;
		gap: var(--space-3);
		width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.recaps > li {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}

	.recaps > li > :global(:first-child) {
		width: 100%;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.entries > li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: var(--space-3);
		align-items: start;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.entries > li:not(:has(.thumb)) {
		grid-template-columns: 1fr auto;
	}

	.thumb {
		width: 3.5rem;
		height: 3.5rem;
		border-radius: var(--md-sys-shape-corner-small);
		object-fit: cover;
	}

	.entry-text {
		display: grid;
		gap: var(--space-1);
		min-width: 0;
	}

	.name {
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.meta,
	.where {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.missing {
		color: var(--md-sys-color-error);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.entry-actions {
		display: flex;
	}

	.form {
		display: grid;
		gap: var(--space-3);
	}
</style>
