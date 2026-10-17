<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Anchor } from '@book/core';
	import type { StoryAt } from '@book/domain';
	import { Button, Skeleton } from '@book/ui';
	import AiLabel from '$lib/components/AiLabel.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import type { BookStory } from './story.svelte';

	/**
	 * "Story so far" in the Contents sheet (P1-RDR-13; plan §6 Phase 1.14 UX notes): the recap of
	 * every Chapter the reader has finished, then the glossary entries they've met, alphabetically.
	 * Nothing from ahead of them (Invariant 6). Empty states say why.
	 */
	interface Props {
		story: BookStory;
		/** What the reader has reached; null until the story has loaded. */
		at: StoryAt | null;
		/** The reader hides AI-generated content, and this was (§10.6). */
		hidden: boolean;
		/** A Chapter's title, as the contents name it. */
		titleOf: (chapterId: string) => string;
		/** The title of the part of the Book an Ordinal is in. */
		titleAt: (ordinal: number) => string;
		onjump: (anchor: Anchor) => void;
	}

	let { story, at, hidden, titleOf, titleAt, onjump }: Props = $props();
</script>

<h2 class="visually-hidden">The story so far</h2>
{#if story.status === 'loading'}
	<div class="loading" aria-busy="true">
		<Skeleton height="1.5rem" width="40%" />
		<Skeleton height="4rem" shape="block" />
	</div>
{:else if story.status === 'error' && story.error}
	<div class="error">
		<ErrorState error={story.error} what="The story so far" onretry={() => void story.load()} />
	</div>
{:else if hidden}
	<p class="empty">
		The author wrote this with AI, and you’ve chosen to hide AI-generated content. You can change
		that in <a href={resolve('/(app)/you/settings')}>Settings</a>.
	</p>
{:else if story.story && at}
	<div class="intro">
		<p>Written by the author. Only what you’ve already read.</p>
		<AiLabel aiUse={story.story.aiUse} />
	</div>
	{#if !at.recaps.length && !at.glossary.length}
		<p class="empty">
			Nothing yet. A chapter’s recap appears here once you’ve read to its end, and characters,
			places and things join the glossary once you’ve met them.
		</p>
	{:else}
		<section aria-labelledby="story-recaps">
			<h3 id="story-recaps">Recaps</h3>
			{#if at.recaps.length}
				<ol class="recaps">
					{#each at.recaps as recap (recap.chapterId)}
						<li data-testid="story-recap">
							<h4>{titleOf(recap.chapterId)}</h4>
							<p>{recap.text}</p>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="empty">A chapter’s recap appears here once you’ve read to its end.</p>
			{/if}
		</section>
		<section aria-labelledby="story-glossary">
			<h3 id="story-glossary">Glossary</h3>
			{#if at.glossary.length}
				<ul class="glossary">
					{#each at.glossary as entry (entry.id)}
						<li data-testid="story-entry">
							{#if entry.picture}
								<img
									class="thumb"
									src={entry.picture.url}
									alt={entry.picture.alt}
									width={entry.picture.width}
									height={entry.picture.height}
									style:background={entry.picture.dominant}
								/>
							{/if}
							<div class="entry">
								<h4>{entry.name}</h4>
								{#if entry.alsoCalled.length}
									<span class="also">Also called {entry.alsoCalled.join(', ')}</span>
								{/if}
								<p>{entry.description}</p>
								<Button
									variant="text"
									icon="arrow_forward"
									aria-label={`Go to where ${entry.name} first appears, in ${titleAt(entry.firstAppearance.startOrdinal)}`}
									onclick={() => onjump(entry.firstAppearance)}
									>First appears in {titleAt(entry.firstAppearance.startOrdinal)}</Button
								>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty">Characters, places and things join the glossary once you’ve met them.</p>
			{/if}
		</section>
	{/if}
{:else}
	<p class="empty">
		The author hasn’t written recaps or a glossary for this book. When they do, you’ll find them
		here.
	</p>
{/if}

<style>
	.loading,
	.error {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3);
	}

	.intro {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		padding: var(--space-3) var(--space-3) 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.intro p {
		margin: 0;
	}

	section {
		margin-top: var(--space-4);
	}

	h3 {
		margin: 0 0 var(--space-2);
		padding-inline: var(--space-3);
		color: var(--md-sys-color-primary);
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	h4 {
		margin: 0;
		color: var(--md-sys-color-on-surface);
		font-size: var(--md-sys-typescale-body-large-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	ol,
	ul {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0 var(--space-3);
		list-style: none;
	}

	.recaps p,
	.entry p {
		margin: var(--space-1) 0 0;
		color: var(--md-sys-color-on-surface-variant);
		font-family: var(--font-literata);
		line-height: 1.5;
	}

	.glossary li {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
	}

	.thumb {
		flex: none;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: var(--md-sys-shape-corner-small);
		object-fit: cover;
	}

	.entry {
		display: grid;
		justify-items: start;
		min-width: 0;
	}

	.also {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.empty {
		margin: var(--space-3);
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
