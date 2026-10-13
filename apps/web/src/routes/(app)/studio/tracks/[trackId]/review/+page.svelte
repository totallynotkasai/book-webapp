<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { ReviewRegionDto } from '@book/core';
	import { Badge, Button, Checkbox, Skeleton } from '@book/ui';
	import { onDestroy } from 'svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { describeError } from '$lib/errors';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';

	// The narration review screen (P1-STU-03, DESIGN.md §7.2 step 6): every stretch whose words
	// weren't heard clearly (their timing was guessed) is one tap away. Listen, and tick it when
	// the highlighting would follow the voice; to fix one, re-align and import the chapter again.
	const trackId = $derived(page.params.trackId ?? '');
	const chapterId = $derived(page.url.searchParams.get('chapter') ?? '');
	const review = resource(
		async () => (await getBackend()).studio.reviewChapter(trackId, chapterId),
		{ topics: ['studio'] }
	);

	let audio = $state<HTMLAudioElement>();
	let playing = $state<number | null>(null);
	let stopAt = 0;

	/** A little before and after, so the creator hears the words around it. */
	const LEAD_MS = 1500;
	const TAIL_MS = 750;

	function play(region: ReviewRegionDto) {
		if (!audio) return;
		if (playing === region.index) {
			audio.pause();
			playing = null;
			return;
		}
		audio.currentTime = Math.max(0, region.startMs - LEAD_MS) / 1000;
		stopAt = (region.endMs + TAIL_MS) / 1000;
		playing = region.index;
		void audio.play().catch(() => {
			playing = null;
			snackbars.show('The audio couldn’t play here.', { tone: 'error' });
		});
	}

	function ontimeupdate() {
		if (audio && playing !== null && audio.currentTime >= stopAt) {
			audio.pause();
			playing = null;
		}
	}

	async function mark(region: ReviewRegionDto, reviewed: boolean) {
		try {
			await (await getBackend()).studio.markReviewed(trackId, chapterId, region.index, reviewed);
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		}
	}

	const time = (ms: number) => {
		const s = Math.floor(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	};

	onDestroy(() => audio?.pause());
</script>

<svelte:head><title>Review narration · Studio · Book Reader</title></svelte:head>

<div class="page">
	<StatusView resource={review} what="This chapter’s narration">
		{#snippet loading()}
			<Skeleton width="60%" height="2rem" />
			<Skeleton height="10rem" shape="block" />
		{/snippet}
		{#snippet children(r)}
			<PageHeader
				title={`Review “${r.chapterTitle || r.chapterId}”`}
				back={{
					href: resolve('/(app)/studio/tracks/[trackId]', { trackId }),
					label: 'Back to the narration'
				}}
			>
				<div class="badges">
					<Badge tone={r.status === 'ready' ? 'primary' : 'tertiary'}>
						{r.status === 'ready' ? 'Reviewed' : 'Needs review'}
					</Badge>
					<span class="meta"
						>{Math.round(r.coverage * 100)}% of words heard clearly · {r.regions.filter(
							(x) => x.reviewed
						).length} of {r.regions.length} checked</span
					>
				</div>
			</PageHeader>

			<p class="intro">
				The highlighting guessed the timing of these words. Play each one: if the highlight would
				keep up with the voice, tick it. If not, re-align the audio with
				<code>tools/align</code> and add the chapter again.
			</p>

			<audio bind:this={audio} src={r.audioUrl} preload="metadata" {ontimeupdate}></audio>

			<ol class="regions" data-testid="review-regions">
				{#each r.regions as region (region.index)}
					<li data-testid="review-region" data-reviewed={region.reviewed}>
						<div class="region-head">
							<Button
								variant="tonal"
								icon={playing === region.index ? 'pause' : 'play_arrow'}
								onclick={() => play(region)}
								>{playing === region.index ? 'Pause' : `Play ${time(region.startMs)}`}</Button
							>
							<Checkbox
								label="Sounds right"
								checked={region.reviewed}
								onchange={(v) => void mark(region, v)}
							/>
						</div>
						<p class="text">
							<span class="context">…{region.before}</span>
							<mark>{region.text}</mark>
							<span class="context">{region.after}…</span>
						</p>
					</li>
				{/each}
			</ol>
		{/snippet}
	</StatusView>
</div>

<style>
	.page {
		display: grid;
		/* The column never grows wider than the screen to fit wide content (tabs, tables). */
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		max-width: 48rem;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.meta,
	.intro {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.meta {
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.regions {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.regions li {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.region-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.text {
		margin: 0;
		font-family: var(--font-reading, serif);
		line-height: 1.6;
	}

	.context {
		color: var(--md-sys-color-on-surface-variant);
	}

	mark {
		padding: 0 2px;
		border-radius: 3px;
		background: var(--md-sys-color-tertiary-container);
		color: var(--md-sys-color-on-tertiary-container);
	}
</style>
