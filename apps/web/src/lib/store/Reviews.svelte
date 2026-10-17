<script lang="ts">
	import type { ReviewDto } from '@book/core';
	import { Badge, Button, Icon, Skeleton } from '@book/ui';
	import ReportDialog from '$lib/community/ReportDialog.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { describeError } from '$lib/errors';
	import { formatDay, reviewProgress } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import ReviewDialog from './ReviewDialog.svelte';
	import ReviewStars from './ReviewStars.svelte';

	/**
	 * Reviews on a Book page (P1-STO-07; plan §6 Phase 1.18 UX notes): the average, the reader's own
	 * review (write one once they own the Book), then everyone else's, newest first, each with
	 * how far its writer had read. A review marked as having spoilers keeps its words behind "Show
	 * review" (D-042). Each can be reported to the moderators.
	 */
	interface Props {
		book: { id: string; title: string };
	}

	let { book }: Props = $props();

	const reviews = resource(
		async () => {
			const bookId = book.id;
			return (await getBackend()).reviews.list(bookId);
		},
		{ topics: ['reviews', 'entitlements', 'session'] }
	);

	/** Further pages, after the first. */
	let more = $state.raw<ReviewDto[]>([]);
	let cursor = $state<string | null | undefined>(undefined);
	let loadingMore = $state(false);
	$effect(() => {
		// A fresh first page starts the list again.
		void reviews.data;
		more = [];
		cursor = undefined;
	});
	const nextCursor = $derived(cursor === undefined ? (reviews.data?.nextCursor ?? null) : cursor);

	async function showMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const page = await (await getBackend()).reviews.list(book.id, { cursor: nextCursor });
			more = [...more, ...page.items];
			cursor = page.nextCursor;
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		} finally {
			loadingMore = false;
		}
	}

	let writing = $state(false);
	let reporting = $state(false);
	let reported = $state.raw<ReviewDto | null>(null);
	/** Spoiler reviews the reader chose to read. */
	let shown = $state<Record<string, boolean>>({});
</script>

{#snippet review(r: ReviewDto)}
	<article class="review" data-testid="review" aria-labelledby={`review-${r.id}`}>
		<header>
			<ReviewStars stars={r.stars} />
			<h3 id={`review-${r.id}`} class="name">{r.mine ? 'Your review' : r.reviewerName}</h3>
			<span class="meta">{formatDay(r.updatedAt)}</span>
			<div class="review-actions">
				{#if r.mine}
					<Button variant="text" icon="edit" onclick={() => (writing = true)}>Change</Button>
				{:else}
					<Button
						variant="text"
						icon="flag"
						onclick={() => {
							reported = r;
							reporting = true;
						}}>Report</Button
					>
				{/if}
			</div>
		</header>
		<p class="progress" data-testid="review-read">
			<Icon name="auto_stories" size={16} />
			{reviewProgress(r.progression)}
		</p>
		{#if r.hidden}
			<p class="hidden-note">
				<Icon name="visibility_off" size={16} /> A moderator hid this review after a report, so only you
				can see it. Your inbox says why.
			</p>
		{/if}
		{#if r.text}
			{#if r.spoilers && !shown[r.id] && !r.mine}
				<p class="spoiler">
					<Badge tone="tertiary" icon="warning">Spoilers</Badge>
					This review gives away some of the story.
					<Button variant="text" onclick={() => (shown[r.id] = true)}>Show review</Button>
				</p>
			{:else}
				{#if r.spoilers}<Badge tone="tertiary" icon="warning">Spoilers</Badge>{/if}
				<p class="text">{r.text}</p>
			{/if}
		{/if}
	</article>
{/snippet}

<section class="reviews" aria-labelledby="reviews-heading" data-testid="reviews">
	<h2 id="reviews-heading">Reviews</h2>
	<StatusView resource={reviews} what="Reviews">
		{#snippet loading()}<Skeleton height="6rem" shape="block" />{/snippet}
		{#snippet children(data)}
			<div class="summary" data-testid="review-summary">
				{#if data.summary}
					<ReviewStars stars={Math.round(data.summary.average)} size={22} />
					<span
						><strong>{data.summary.average.toFixed(1)}</strong> out of 5 · {data.summary.count}
						{data.summary.count === 1 ? 'review' : 'reviews'}</span
					>
				{:else}
					<span>No reviews yet.</span>
				{/if}
				{#if data.canReview && !data.mine}
					<Button variant="tonal" icon="rate_review" onclick={() => (writing = true)}
						>Write a review</Button
					>
				{:else if !data.canReview && !data.mine}
					<span class="muted">Get the book to review it.</span>
				{/if}
			</div>
			{#if data.mine}{@render review(data.mine)}{/if}
			{#each [...data.items, ...more] as r (r.id)}{@render review(r)}{/each}
			{#if nextCursor}
				<Button variant="text" pending={loadingMore} onclick={() => void showMore()}
					>Show more reviews</Button
				>
			{/if}
			<ReviewDialog bind:open={writing} {book} existing={data.mine} />
		{/snippet}
	</StatusView>
	<ReportDialog
		bind:open={reporting}
		target={reported
			? { type: 'review', id: reported.id, title: `${reported.reviewerName}’s review` }
			: null}
	/>
</section>

<style>
	.reviews {
		display: grid;
		gap: var(--space-3);
		/* Lines a comfortable length to read, however wide the window. */
		max-width: 48rem;
	}

	h2 {
		margin: var(--space-4) 0 0;
		font-size: var(--md-sys-typescale-title-large-size);
	}

	.summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}

	.review {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.review header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
	}

	.name {
		margin: 0;
		font-size: var(--md-sys-typescale-title-small-size);
	}

	.meta,
	.progress,
	.muted {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.progress,
	.hidden-note {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin: 0;
	}

	.hidden-note {
		color: var(--md-sys-color-on-surface-variant);
	}

	.spoiler {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
	}

	.text {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.review-actions {
		display: flex;
		margin-inline-start: auto;
	}
</style>
