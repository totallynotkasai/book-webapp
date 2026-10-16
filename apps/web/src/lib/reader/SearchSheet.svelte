<script lang="ts">
	import { AdaptiveSheet, Button, Progress, TextField } from '@book/ui';
	import { tick, untrack } from 'svelte';
	import type { SearchHit } from './search';
	import type { BookSearch } from './search.svelte';

	/**
	 * Search in the Book (P1-RDR-10; plan §6 Phase 1.12 UX notes): a sheet from the top bar or `/`,
	 * with results grouped by Chapter, each with its line of context. Enter jumps to the first;
	 * ↓ and ↑ move through the results. The reader's Back chip returns to where they were.
	 */
	interface Props {
		open: boolean;
		search: BookSearch;
		onresult: (hit: SearchHit) => void;
	}

	let { open = $bindable(), search, onresult }: Props = $props();

	/** Results are shown a page at a time: "the" finds thousands. */
	const PAGE = 200;
	let shownCount = $state(PAGE);
	let field = $state<HTMLInputElement | HTMLTextAreaElement>();
	let list = $state<HTMLElement>();
	// The field's own text; the last search's when the sheet opens again.
	let value = $state(untrack(() => search.query));

	$effect(() => {
		if (!open) return;
		void tick().then(() => {
			field?.focus();
			field?.select();
		});
	});

	/** The groups, cut to the first `shownCount` results. */
	const shown = $derived.by(() => {
		let left = shownCount;
		const out: { chapterId: string; title: string; count: number; hits: SearchHit[] }[] = [];
		for (const group of search.groups) {
			if (left <= 0) break;
			out.push({ ...group, count: group.hits.length, hits: group.hits.slice(0, left) });
			left -= group.hits.length;
		}
		return out;
	});

	const status = $derived.by(() => {
		if (!search.query.trim()) return 'Type a word or a phrase. Capitals and accents don’t matter.';
		const chapters = search.groups.length;
		const found = `${search.total.toLocaleString()} ${search.total === 1 ? 'result' : 'results'} in ${chapters} ${chapters === 1 ? 'chapter' : 'chapters'}`;
		if (search.searching) {
			return search.total
				? `${found} so far…`
				: `Searching… (chapter ${search.searched + 1} of ${search.chapterCount})`;
		}
		return search.total ? found : `No results for “${search.query.trim()}”.`;
	});

	function input(next: string) {
		value = next;
		shownCount = PAGE;
		search.set(next);
	}

	function choose(hit: SearchHit) {
		open = false;
		onresult(hit);
	}

	async function onFieldKey(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			// What was typed last counts, even before its search has run.
			const first = await search.first(value);
			if (first && open) choose(first);
		} else if (event.key === 'ArrowDown') {
			const first = list?.querySelector<HTMLElement>('button.hit');
			if (first) {
				event.preventDefault();
				first.focus();
			}
		}
	}

	function onListKey(event: KeyboardEvent) {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const buttons = [...(list?.querySelectorAll<HTMLElement>('button.hit') ?? [])];
		const i = buttons.indexOf(document.activeElement as HTMLElement);
		if (i < 0) return;
		event.preventDefault();
		if (event.key === 'ArrowUp' && i === 0) field?.focus();
		else
			buttons[
				Math.min(buttons.length - 1, Math.max(0, i + (event.key === 'ArrowDown' ? 1 : -1)))
			]?.focus();
	}
</script>

<AdaptiveSheet bind:open title="Search in this book" height="full">
	<form class="search" role="search" onsubmit={(e) => e.preventDefault()}>
		<TextField
			label="Search in this book"
			type="search"
			leadingIcon="search"
			autocomplete="off"
			spellcheck="false"
			enterkeyhint="search"
			bind:element={field}
			bind:value={() => value, input}
			onkeydown={onFieldKey}
		/>
	</form>
	<div class="status">
		{#if search.searching}
			<Progress
				kind="linear"
				label="Searching"
				value={search.chapterCount ? search.searched / search.chapterCount : undefined}
			/>
		{/if}
		<p role="status" data-testid="search-status">{status}</p>
		{#if search.error}<p class="error">{search.error}</p>{/if}
	</div>
	<!-- Arrow keys move between the results’ buttons. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="results" bind:this={list} onkeydown={onListKey} data-testid="search-results">
		{#each shown as group (group.chapterId)}
			<section class="group" aria-labelledby={`search-${group.chapterId}`}>
				<h3 id={`search-${group.chapterId}`}>
					{group.title} <span class="count">{group.count}</span>
				</h3>
				<ul>
					{#each group.hits as hit (hit.startOrdinal)}
						<li>
							<button
								type="button"
								class="hit"
								data-ordinal={hit.startOrdinal}
								onclick={() => choose(hit)}
							>
								{hit.before}<mark>{hit.match}</mark>{hit.after}
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
		{#if search.total > shownCount}
			<div class="more">
				<Button variant="text" onclick={() => (shownCount += PAGE)}
					>Show more ({(search.total - shownCount).toLocaleString()} left)</Button
				>
			</div>
		{/if}
	</div>
</AdaptiveSheet>

<style>
	.search {
		position: sticky;
		top: 0;
		z-index: 1;
		padding-block: var(--space-2);
		background: inherit;
	}

	.status {
		display: grid;
		gap: var(--space-1);
		margin-bottom: var(--space-2);
	}

	.status p {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-medium-size);
	}

	.status .error {
		color: var(--md-sys-color-error);
	}

	.group {
		margin-top: var(--space-3);
	}

	h3 {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		margin: 0 0 var(--space-1);
		padding-inline: var(--space-3);
		color: var(--md-sys-color-primary);
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.count {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-label-medium-size);
		font-weight: normal;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.hit {
		display: block;
		width: 100%;
		min-height: var(--touch-target);
		padding: var(--space-2) var(--space-3);
		border: none;
		border-radius: var(--md-sys-shape-corner-large);
		background: transparent;
		color: var(--md-sys-color-on-surface);
		font: inherit;
		font-family: var(--font-literata);
		font-size: var(--md-sys-typescale-body-medium-size);
		line-height: 1.45;
		text-align: start;
		cursor: pointer;
	}

	.hit:hover {
		background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
	}

	.hit:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: -3px;
	}

	mark {
		border-radius: 3px;
		padding-inline: 1px;
		background: var(--md-sys-color-tertiary-container);
		color: var(--md-sys-color-on-tertiary-container);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.more {
		display: flex;
		justify-content: center;
		padding-block: var(--space-3);
	}
</style>
