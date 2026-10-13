<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { StudioTrackChapterDto } from '@book/core';
	import { Badge, Button, Skeleton } from '@book/ui';
	import AiLabel from '$lib/components/AiLabel.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { describeError } from '$lib/errors';
	import { formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import ChapterNarrationDialog from '$lib/studio/ChapterNarrationDialog.svelte';
	import LayerDetailsDialog from '$lib/studio/LayerDetailsDialog.svelte';

	// The narration manager (P1-STU-03, DESIGN.md §7.2): per Chapter, audio and a Sync Map from
	// tools/align; coverage and status (ready, needs review, out of date); a review screen for
	// each Chapter with low-confidence regions.
	const trackId = $derived(page.params.trackId ?? '');
	const track = resource(async () => (await getBackend()).studio.getTrack(trackId), {
		topics: ['studio']
	});

	let narrationOpen = $state(false);
	let chapter = $state.raw<StudioTrackChapterDto | null>(null);
	let detailsOpen = $state(false);
	let publishing = $state(false);

	const statusLabels: Record<StudioTrackChapterDto['status'], string> = {
		missing: 'No narration yet',
		ready: 'Ready',
		needs_review: 'Needs review',
		stale: 'Out of date'
	};

	const minutes = (ms: number) => {
		const s = Math.round(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	};

	const reviewHref = (chapterId: string) =>
		`${resolve('/(app)/studio/tracks/[trackId]/review', { trackId })}?chapter=${encodeURIComponent(chapterId)}`;

	async function publish() {
		if (publishing) return;
		publishing = true;
		try {
			await (await getBackend()).studio.publishTrack(trackId);
			snackbars.show('Published. Readers with this narration can listen now.');
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		} finally {
			publishing = false;
		}
	}
</script>

<svelte:head><title>{track.data?.name ?? 'Narration'} · Studio · Book Reader</title></svelte:head>

<div class="page">
	<StatusView resource={track} what="This narration">
		{#snippet loading()}
			<Skeleton width="60%" height="2rem" />
			<Skeleton height="10rem" shape="block" />
		{/snippet}
		{#snippet children(detail)}
			<PageHeader
				title={detail.name}
				subtitle={`Read by ${detail.narrator}`}
				back={{
					href: resolve('/(app)/studio/books/[bookId]', { bookId: detail.bookId }),
					label: 'Back to the book'
				}}
			>
				<div class="badges">
					<Badge tone={detail.listingState === 'listed' ? 'primary' : 'neutral'}>
						{detail.listingState === 'listed' ? 'Published' : 'Draft'}
					</Badge>
					{#if detail.aiUse}<AiLabel aiUse={detail.aiUse} />{/if}
					<span class="meta">{formatPrice(detail.price)} · simulated</span>
				</div>
				{#snippet actions()}
					<Button variant="text" icon="edit" onclick={() => (detailsOpen = true)}>Details</Button>
					{#if detail.listingState !== 'listed'}
						<Button icon="publish" pending={publishing} onclick={() => void publish()}
							>Publish narration</Button
						>
					{/if}
				{/snippet}
			</PageHeader>

			<p class="intro">
				For each chapter, add its audio and the Sync Map <code>tools/align</code> made from it (<code
					>npm run narration</code
				>). Below 90% of words heard clearly, a chapter needs review.
			</p>

			<ul class="chapters">
				{#each detail.chapters as c (c.chapterId)}
					<li data-testid="track-chapter" data-status={c.status}>
						<div class="chapter-text">
							<span class="name">{c.title || c.chapterId}</span>
							<span class="meta">
								{c.wordCount.toLocaleString()} words{#if c.durationMs !== null}
									· {minutes(c.durationMs)}{/if}{#if c.coverage !== null}
									· {Math.round(c.coverage * 100)}% heard{/if}
							</span>
							<span class="badges">
								<Badge
									tone={c.status === 'ready'
										? 'primary'
										: c.status === 'stale'
											? 'error'
											: c.status === 'needs_review'
												? 'tertiary'
												: 'neutral'}
								>
									{statusLabels[c.status]}
								</Badge>
								{#if c.regions}
									<span class="meta">{c.reviewed} of {c.regions} checked</span>
								{/if}
							</span>
						</div>
						<div class="actions">
							{#if c.regions}
								<Button variant="text" href={reviewHref(c.chapterId)}>Review</Button>
							{/if}
							<Button
								variant="tonal"
								icon="upload"
								onclick={() => {
									chapter = c;
									narrationOpen = true;
								}}>{c.status === 'missing' ? 'Add narration' : 'Replace'}</Button
							>
						</div>
					</li>
				{/each}
			</ul>

			<ChapterNarrationDialog
				bind:open={narrationOpen}
				{trackId}
				chapter={chapter ? { chapterId: chapter.chapterId, title: chapter.title } : null}
				onsaved={(t) => {
					const saved = t.chapters.find((c) => c.chapterId === chapter?.chapterId);
					snackbars.show(
						saved?.status === 'needs_review'
							? `Added. ${saved.regions} ${saved.regions === 1 ? 'part needs' : 'parts need'} a listen.`
							: 'Added.'
					);
				}}
			/>
			<LayerDetailsDialog
				bind:open={detailsOpen}
				kind="track"
				bookId={detail.bookId}
				existing={{
					id: detail.id,
					name: detail.name,
					narrator: detail.narrator,
					description: detail.description,
					credit: detail.credit,
					price: detail.price,
					aiUse: detail.aiUse
				}}
				onsaved={() => snackbars.show('Saved.')}
			/>
		{/snippet}
	</StatusView>
</div>

<style>
	.page {
		display: grid;
		/* The column never grows wider than the screen to fit wide content (tabs, tables). */
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		max-width: 52rem;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.intro {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.chapters {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chapters li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--space-2);
		align-items: center;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	@media (max-width: 599.98px) {
		.chapters li {
			grid-template-columns: 1fr;
		}
	}

	.chapter-text {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.name {
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.meta {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
