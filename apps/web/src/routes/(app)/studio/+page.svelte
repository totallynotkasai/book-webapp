<script lang="ts">
	import { resolve } from '$app/paths';
	import type { StudioBookDetailDto } from '@book/core';
	import { Badge, Button, Card, Icon, Skeleton } from '@book/ui';
	import AiLabel from '$lib/components/AiLabel.svelte';
	import BookCover from '$lib/components/BookCover.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { formatAmount, formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';
	import { bookStateLabel } from '$lib/studio/summaries';
	import UploadDialog from '$lib/studio/UploadDialog.svelte';

	// The Studio dashboard (P1-STU-01 to P1-STU-04; plan §6 Phase 1.7 UX notes): your Books and
	// their state, simulated earnings, and suggested next steps. The backend refuses non-Creators
	// with FORBIDDEN itself (§10.6); the navigation only hides the link.
	const books = resource(async () => (await getBackend()).studio.listBooks({ limit: 100 }), {
		topics: ['studio', 'session']
	});
	const earnings = resource(async () => (await getBackend()).studio.earnings(), {
		topics: ['studio', 'entitlements', 'support']
	});
	/** What to do next, from each Book's details (a Creator has a handful, so this is cheap). */
	const nextSteps = resource(
		async () => {
			const studio = (await getBackend()).studio;
			const [list, plans] = await Promise.all([
				studio.listBooks({ limit: 20 }),
				studio.listPlans()
			]);
			const details = await Promise.all(list.items.map((b) => studio.getBook(b.id)));
			return { steps: suggestions(details), plans: plans.length };
		},
		{ topics: ['studio'] }
	);

	interface Step {
		text: string;
		href: string;
	}

	function suggestions(details: StudioBookDetailDto[]): Step[] {
		const steps: Step[] = [];
		for (const book of details) {
			const href = resolve('/(app)/studio/books/[bookId]', { bookId: book.id });
			const title = `“${book.settings.title}”`;
			if (book.revisions.some((r) => r.state === 'ready')) {
				steps.push({ text: `Publish the new version of ${title}`, href });
			}
			for (const pack of book.packs) {
				if (pack.missingAlt)
					steps.push({ text: `Add alt text to pictures in “${pack.name}”`, href });
				if (pack.orphaned) {
					steps.push({ text: `Re-attach pictures whose text changed in “${pack.name}”`, href });
				}
			}
			for (const track of book.tracks) {
				const trackHref = resolve('/(app)/studio/tracks/[trackId]', { trackId: track.id });
				if (track.needsReview) {
					steps.push({ text: `Review narration in “${track.name}”`, href: trackHref });
				}
				if (track.stale) {
					steps.push({
						text: `Re-align narration for chapters that changed in “${track.name}”`,
						href: trackHref
					});
				}
			}
			if (book.listingState === 'listed' && !book.packs.length) {
				steps.push({ text: `Add illustrations to ${title}`, href });
			}
			if (book.listingState === 'listed' && !book.tracks.length) {
				steps.push({ text: `Add narration to ${title}`, href });
			}
		}
		return steps.slice(0, 6);
	}

	let uploadOpen = $state(false);
</script>

<svelte:head><title>Studio · Book Reader</title></svelte:head>

<div>
	<PageHeader title="Creator Studio" subtitle="Your books, their Illustrations and Narration.">
		<Badge tone="simulated" icon="science">Simulated: nothing leaves this device</Badge>
		{#snippet actions()}
			<Button icon="upload" onclick={() => (uploadOpen = true)}>Upload a book</Button>
		{/snippet}
	</PageHeader>

	<section aria-labelledby="earnings-heading" class="tiles">
		<h2 id="earnings-heading" class="visually-hidden">Earnings</h2>
		{#each [{ label: 'Sales', kind: 'sales' }, { label: 'Tips', kind: 'tips' }, { label: 'Subscriptions', kind: 'subscriptions' }] as tile (tile.kind)}
			<Card
				variant="outlined"
				href={resolve('/(app)/studio/earnings')}
				label={`${tile.label}: see earnings`}
			>
				<div class="tile">
					<span class="tile-label">{tile.label}</span>
					<span class="tile-value">
						{#if earnings.data}
							{formatAmount(
								earnings.data.lines
									.filter((l) => l.kind === tile.kind)
									.reduce(
										(sum, l) => ({
											...sum,
											amountMinor: sum.amountMinor + l.split.yours.amountMinor
										}),
										{ amountMinor: 0, currency: earnings.data.currency }
									)
							)}
						{:else}—{/if}
					</span>
					<span class="tile-note">
						{tile.kind === 'subscriptions' && earnings.data
							? `${earnings.data.activeSubscribers} active · simulated`
							: 'Your share · simulated'}
					</span>
				</div>
			</Card>
		{/each}
	</section>

	<div class="links">
		<Button variant="text" icon="payments" href={resolve('/(app)/studio/earnings')}>Earnings</Button
		>
		<Button variant="text" icon="card_membership" href={resolve('/(app)/studio/plans')}
			>Subscription plans</Button
		>
	</div>

	{#if nextSteps.data?.steps.length}
		<section aria-labelledby="next-heading">
			<h2 id="next-heading">Next steps</h2>
			<ul class="steps">
				{#each nextSteps.data.steps as step (step.text)}
					<li>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- steps hold resolved hrefs -->
						<a href={step.href}><Icon name="arrow_forward" size={20} /><span>{step.text}</span></a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<h2>Your books</h2>
	<StatusView resource={books} what="Your books">
		{#snippet loading()}
			{#each [1, 2] as i (i)}<Skeleton height="5rem" shape="block" />{/each}
		{/snippet}
		{#snippet empty()}
			<EmptyState
				icon="upload"
				title="No books yet"
				message="Upload an EPUB to publish your first book. A chapter of your own novel works; nothing leaves your device."
			>
				{#snippet actions()}
					<Button icon="upload" onclick={() => (uploadOpen = true)}>Upload a book</Button>
				{/snippet}
			</EmptyState>
		{/snippet}
		{#snippet children(list)}
			<ul class="books">
				{#each list.items as book (book.id)}
					<li data-testid="studio-book">
						<BookCover
							title={book.title}
							creatorName={book.creatorName}
							coverUrl={book.coverUrl}
							size="small"
						/>
						<div class="book-text">
							<a href={resolve('/(app)/studio/books/[bookId]', { bookId: book.id })}>{book.title}</a
							>
							<span class="meta">
								<Badge
									tone={book.pendingRevision === 'failed'
										? 'error'
										: book.listingState === 'listed' && !book.pendingRevision
											? 'primary'
											: 'neutral'}
								>
									{bookStateLabel(book)}
								</Badge>
								<AiLabel aiUse={book.aiUse} />
								<span>{formatPrice(book.price)}</span>
							</span>
						</div>
					</li>
				{/each}
			</ul>
		{/snippet}
	</StatusView>
</div>

<UploadDialog bind:open={uploadOpen} />

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: var(--space-3);
	}

	.tile {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-4);
	}

	.tile-label,
	.tile-note {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.tile-value {
		font-size: var(--md-sys-typescale-headline-small-size);
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}

	h2 {
		margin: var(--space-6) 0 var(--space-3);
		font-family: var(--font-display);
		font-size: var(--md-sys-typescale-title-large-size);
		font-weight: var(--md-sys-typescale-weight-regular);
	}

	.steps {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.steps a {
		display: inline-flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding-block: var(--space-2);
		min-height: var(--touch-target);
		color: var(--md-sys-color-primary);
	}

	.books {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.books li {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.book-text {
		display: grid;
		gap: var(--space-1);
		min-width: 0;
	}

	.book-text a {
		color: var(--md-sys-color-on-surface);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		color: var(--md-sys-color-on-surface-variant);
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
