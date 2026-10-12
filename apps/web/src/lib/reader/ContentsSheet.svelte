<script lang="ts">
	import type { Anchor, Annotation, HighlightColour, PlacedBookmark, TocEntry } from '@book/core';
	import { highlightLabels } from '@book/tokens';
	import { AdaptiveSheet, Chip, IconButton, Menu, Tabs } from '@book/ui';
	import { tick } from 'svelte';
	import type { BookNotes } from './notes.svelte';

	/**
	 * Contents, notes and bookmarks in one sheet (§4.1, §9.3; plan §6 Phase 1.3 UX notes): a side
	 * sheet from the start edge on wider screens, full height on phones. One button opens it, so a
	 * phone's top bar keeps room for the Bookmark, Illustrations and Aa buttons.
	 */
	export type ContentsTab = 'contents' | 'notes' | 'bookmarks';

	interface Props {
		open: boolean;
		tab: ContentsTab;
		entries: readonly TocEntry[];
		currentIndex: number;
		onselecttoc: (entry: TocEntry) => void;
		notes: BookNotes | undefined;
		titleAt: (ordinal: number) => string;
		onjump: (anchor: Anchor) => void;
		oneditnote: (annotation: Annotation) => void;
		onremovenote: (annotation: Annotation) => void;
		onrenamebookmark: (bookmark: PlacedBookmark) => void;
		onremovebookmark: (bookmark: PlacedBookmark) => void;
		onexport: (format: 'md' | 'txt') => void;
	}

	let {
		open = $bindable(),
		tab = $bindable(),
		entries,
		currentIndex,
		onselecttoc,
		notes,
		titleAt,
		onjump,
		oneditnote,
		onremovenote,
		onrenamebookmark,
		onremovebookmark,
		onexport
	}: Props = $props();

	let filter = $state<HighlightColour | null>(null);
	let list = $state<HTMLElement>();
	const COLOURS: HighlightColour[] = [1, 2, 3, 4, 5];

	const shown = $derived((notes?.live ?? []).filter((a) => filter === null || a.colour === filter));
	const groups = $derived.by(() => {
		const out: { title: string; items: Annotation[] }[] = [];
		for (const a of shown) {
			const title = titleAt(a.anchor.startOrdinal);
			const last = out.at(-1);
			if (last?.title === title) last.items.push(a);
			else out.push({ title, items: [a] });
		}
		return out;
	});
	const orphans = $derived([...(notes?.orphaned ?? []), ...(notes?.orphanedBookmarks ?? [])]);

	$effect(() => {
		if (!open || tab !== 'contents') return;
		void tick().then(() => {
			const current = list?.querySelector<HTMLElement>('[aria-current="location"]');
			current?.scrollIntoView({ block: 'center' });
			current?.focus();
		});
	});

	function jump(anchor: Anchor) {
		open = false;
		onjump(anchor);
	}
</script>

<AdaptiveSheet bind:open title="Contents and notes" hideTitle side="start" height="full">
	<Tabs
		label="Contents and notes"
		bind:value={tab}
		items={[
			{ value: 'contents', label: 'Contents' },
			{ value: 'notes', label: 'Notes' },
			{ value: 'bookmarks', label: 'Bookmarks' }
		]}
	>
		{#snippet panel(value)}
			{#if value === 'contents'}
				<ol class="toc" bind:this={list}>
					{#each entries as entry, i (i)}
						<li style:--depth={entry.depth}>
							<button
								type="button"
								class="row"
								aria-current={i === currentIndex ? 'location' : undefined}
								onclick={() => {
									open = false;
									onselecttoc(entry);
								}}
							>
								{entry.label || 'Untitled'}
							</button>
						</li>
					{/each}
				</ol>
			{:else if value === 'notes'}
				<div class="tools">
					<div class="filters" role="group" aria-label="Show highlights">
						<Chip
							kind="filter"
							label="All"
							selected={filter === null}
							onclick={() => (filter = null)}
						/>
						{#each COLOURS as c (c)}
							<Chip
								kind="filter"
								label={highlightLabels[c]}
								swatch={`var(--md-sys-color-highlight-${c})`}
								selected={filter === c}
								onclick={() => (filter = filter === c ? null : c)}
							/>
						{/each}
					</div>
					<Menu
						label="Export notes"
						icon="download"
						align="end"
						items={[
							{ label: 'Markdown (.md)', onselect: () => onexport('md') },
							{ label: 'Plain text (.txt)', onselect: () => onexport('txt') }
						]}
					/>
				</div>
				<h2 class="visually-hidden">Notes and highlights</h2>
				{#if !notes?.live.length && !orphans.length}
					<p class="empty">
						No highlights yet. Select some text to highlight it or add a note; they’ll be listed
						here by chapter.
					</p>
				{:else if !groups.length && filter !== null}
					<p class="empty">No {highlightLabels[filter].toLowerCase()} highlights.</p>
				{/if}
				{#each groups as group, g (g)}
					<section class="group" aria-label={group.title}>
						<h3>{group.title}</h3>
						<ul>
							{#each group.items as a (a.id)}
								<li class="item" style:--swatch={`var(--md-sys-color-highlight-${a.colour})`}>
									<button type="button" class="row note" onclick={() => jump(a.anchor)}>
										<span class="quote">{a.anchor.quote.exact}</span>
										{#if a.note}<span class="text">{a.note}</span>{/if}
										<span class="visually-hidden">, {highlightLabels[a.colour]} highlight</span>
									</button>
									<div class="actions">
										<IconButton
											size="small"
											icon="edit_note"
											label={a.note ? 'Edit note' : 'Add note'}
											onclick={() => oneditnote(a)}
										/>
										<IconButton
											size="small"
											icon="delete"
											label="Delete highlight"
											onclick={() => onremovenote(a)}
										/>
									</div>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
				{#if orphans.length}
					<section class="group orphaned" aria-labelledby="orphaned-heading">
						<h3 id="orphaned-heading">Orphaned</h3>
						<p class="hint">
							The text these were on changed in a newer version of the book, so they’re no longer on
							the page. Here’s what they said.
						</p>
						<ul>
							{#each orphans as r (r.id)}
								<li class="item">
									<div class="row note static">
										<span class="quote">{r.anchor.quote.exact}</span>
										{#if 'note' in r && r.note}<span class="text">{r.note}</span>{/if}
										{#if 'label' in r && r.label}<span class="text">Bookmark: {r.label}</span>{/if}
									</div>
									<div class="actions">
										<IconButton
											size="small"
											icon="delete"
											label="Delete"
											onclick={() =>
												'colour' in r ? onremovenote(r) : onremovebookmark(r as PlacedBookmark)}
										/>
									</div>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			{:else}
				<h2 class="visually-hidden">Bookmarks</h2>
				{#if !notes?.liveBookmarks.length}
					<p class="empty">
						No bookmarks yet. Use the bookmark button at the top, or press B, to mark the page
						you’re on.
					</p>
				{:else}
					<ul>
						{#each notes.liveBookmarks as b (b.id)}
							<li class="item">
								<button type="button" class="row note" onclick={() => jump(b.anchor)}>
									<span class="where">{titleAt(b.anchor.ordinal)}</span>
									{#if b.label}<span class="label">{b.label}</span>{/if}
									<span class="quote">{b.anchor.quote.exact} {b.anchor.quote.suffix}…</span>
								</button>
								<div class="actions">
									<IconButton
										size="small"
										icon="edit_note"
										label={b.label ? 'Rename bookmark' : 'Label bookmark'}
										onclick={() => onrenamebookmark(b)}
									/>
									<IconButton
										size="small"
										icon="delete"
										label="Delete bookmark"
										onclick={() => onremovebookmark(b)}
									/>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		{/snippet}
	</Tabs>
</AdaptiveSheet>

<style>
	ol,
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.toc {
		padding-top: var(--space-2);
	}

	.row {
		display: block;
		width: 100%;
		min-height: var(--touch-target);
		padding: var(--space-2) var(--space-3) var(--space-2)
			calc(var(--space-3) + var(--depth, 0) * var(--space-5));
		border: none;
		border-radius: var(--md-sys-shape-corner-large);
		background: transparent;
		color: var(--md-sys-color-on-surface-variant);
		font: inherit;
		font-size: var(--md-sys-typescale-body-large-size);
		text-align: start;
		cursor: pointer;
	}

	.row.static {
		cursor: default;
	}

	button.row:hover {
		background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
	}

	button.row:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: -3px;
	}

	.row[aria-current='location'] {
		background: var(--md-sys-color-secondary-container);
		color: var(--md-sys-color-on-secondary-container);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.tools {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-block: var(--space-3);
	}

	.filters {
		display: flex;
		flex: 1;
		gap: var(--space-2);
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.group {
		margin-top: var(--space-3);
	}

	h3 {
		margin: 0 0 var(--space-1);
		padding-inline: var(--space-3);
		color: var(--md-sys-color-primary);
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.item {
		display: flex;
		align-items: flex-start;
		gap: var(--space-1);
	}

	.note {
		display: grid;
		gap: var(--space-1);
		padding-inline-start: var(--space-4);
		border-inline-start: 4px solid var(--swatch, var(--md-sys-color-outline-variant));
		border-radius: 0 var(--md-sys-shape-corner-large) var(--md-sys-shape-corner-large) 0;
	}

	.quote {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		color: var(--md-sys-color-on-surface);
		font-family: var(--font-literata);
	}

	.text,
	.label {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-medium-size);
		white-space: pre-line;
	}

	.label {
		color: var(--md-sys-color-on-surface);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.where {
		color: var(--md-sys-color-primary);
		font-size: var(--md-sys-typescale-label-medium-size);
	}

	.actions {
		display: flex;
		flex: none;
		padding-top: var(--space-1);
	}

	.empty,
	.hint {
		margin: var(--space-3);
		color: var(--md-sys-color-on-surface-variant);
	}

	.hint {
		margin-top: 0;
		font-size: var(--md-sys-typescale-body-small-size);
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
