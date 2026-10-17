<script lang="ts">
	import { resolve } from '$app/paths';
	import type { BookFinish, ReadingDay } from '@book/core';
	import { achievements, lastSevenDays, localDate, STREAK_DAY_MS, streaks } from '@book/domain';
	import { Button, Card, Dialog, Icon, Skeleton, Switch } from '@book/ui';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { formatDate, formatReadingTime } from '$lib/format';
	import { getStores } from '$lib/services';
	import { preferences } from '$lib/state/preferences.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';

	// You → Your reading (P1-RDR-15, DESIGN.md §4.9): time read in the last week, Words, Books
	// finished, the daily streak and a few quiet achievements, worked out on this device from what
	// the reader stored. One switch hides it all and stops collecting (D-040); clearing the history
	// deletes it.
	let days = $state.raw<ReadingDay[] | null>(null);
	let finishes = $state.raw<BookFinish[]>([]);
	let confirmClear = $state(false);
	let clearing = $state(false);

	async function load() {
		const stores = await getStores();
		[days, finishes] = await Promise.all([
			stores.readingStats.listDays(),
			stores.readingStats.listFinishes()
		]);
	}
	onMount(() => void load());

	const on = $derived(preferences.current.readingStats);
	const today = localDate(Date.now());
	const week = $derived(days ? lastSevenDays(days, today) : null);
	const streak = $derived(days ? streaks(days, today) : null);
	const badges = $derived(days ? achievements(days, finishes) : []);
	const hasHistory = $derived(!!days?.length || finishes.length > 0);
	const plural = (n: number, one: string, many: string) =>
		`${n.toLocaleString()} ${n === 1 ? one : many}`;

	async function clear() {
		clearing = true;
		try {
			await (await getStores()).readingStats.clearHistory();
			confirmClear = false;
			await load();
			snackbars.show('Your reading history is cleared.');
		} finally {
			clearing = false;
		}
	}
</script>

<svelte:head><title>Your reading · Book Reader</title></svelte:head>

<div class="reading">
	<PageHeader title="Your reading" back={{ href: resolve('/you'), label: 'Back to You' }} />

	<Switch
		label="Keep reading stats"
		description="Time read, words, books finished, your streak and a few achievements, worked out on this device. Nothing about your reading leaves it. Turned off, they’re hidden and nothing new is kept."
		checked={on}
		onchange={(readingStats) => preferences.update({ readingStats })}
	/>

	{#if !on}
		<p class="off" data-testid="reading-off">
			Reading stats are off, so nothing new is kept.{hasHistory
				? ' What was kept before stays on this device until you clear it.'
				: ''}
		</p>
	{:else if !days || !week || !streak}
		<Skeleton height="8rem" shape="block" />
	{:else}
		<section aria-labelledby="week-heading">
			<h2 id="week-heading">The last 7 days</h2>
			<div class="figures">
				<Card>
					<div class="stat">
						<p class="figure" data-testid="week-time">{formatReadingTime(week.ms)}</p>
						<p class="caption">
							reading{week.listenedMs
								? `, ${formatReadingTime(week.listenedMs)} of it listening`
								: ''}
						</p>
					</div>
				</Card>
				<Card>
					<div class="stat">
						<p class="figure" data-testid="week-words">{week.words.toLocaleString()}</p>
						<p class="caption">{week.words === 1 ? 'word' : 'words'}</p>
					</div>
				</Card>
				<Card>
					<div class="stat">
						<p class="figure" data-testid="books-finished">{finishes.length.toLocaleString()}</p>
						<p class="caption">
							{finishes.length === 1 ? 'book finished' : 'books finished'}, in all
						</p>
					</div>
				</Card>
			</div>
		</section>

		<section aria-labelledby="streak-heading">
			<h2 id="streak-heading">Streak</h2>
			<p data-testid="streak">
				{#if streak.current}
					<strong>{plural(streak.current, 'day', 'days')} in a row.</strong>
				{:else}
					No streak yet.
				{/if}
				A day counts once you’ve read or listened for {formatReadingTime(STREAK_DAY_MS)}.
				{#if streak.longest > streak.current}Your longest: {plural(
						streak.longest,
						'day',
						'days'
					)}.{/if}
			</p>
		</section>

		<section aria-labelledby="achievements-heading">
			<h2 id="achievements-heading">Achievements</h2>
			<ul class="achievements">
				{#each badges as badge (badge.id)}
					<li
						data-testid="achievement"
						data-earned={!!badge.earnedOn}
						class={{ earned: !!badge.earnedOn }}
					>
						<Icon name={badge.earnedOn ? 'workspace_premium' : 'lock'} size={24} />
						<span class="text">
							<span class="name">{badge.title}</span>
							<span class="meta">
								{badge.description}
								{badge.earnedOn
									? `Earned ${formatDate(`${badge.earnedOn}T12:00:00`)}.`
									: 'Not yet.'}
							</span>
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if hasHistory}
		<div>
			<Button variant="outlined" icon="delete" danger onclick={() => (confirmClear = true)}
				>Clear reading history</Button
			>
		</div>
	{/if}
</div>

<Dialog
	bind:open={confirmClear}
	title="Clear your reading history?"
	description="Your time read, words, streak and books finished are deleted from this device. Your place in each book, notes and bookmarks stay."
>
	{#snippet actions()}
		<Button variant="text" onclick={() => (confirmClear = false)}>Cancel</Button>
		<Button danger pending={clearing} onclick={() => void clear()}>Clear history</Button>
	{/snippet}
</Dialog>

<style>
	.reading {
		display: grid;
		gap: var(--space-5);
		max-width: 44rem;
	}

	section {
		display: grid;
		gap: var(--space-3);
	}

	h2 {
		margin: 0;
		font-size: var(--md-sys-typescale-title-medium-size);
	}

	p {
		margin: 0;
	}

	.off {
		color: var(--md-sys-color-on-surface-variant);
	}

	.figures {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: var(--space-3);
	}

	.stat {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-4);
	}

	.figure {
		font-size: var(--md-sys-typescale-headline-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		font-variant-numeric: tabular-nums;
	}

	.caption,
	.meta {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.achievements {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.achievements li {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
		color: var(--md-sys-color-on-surface-variant);
	}

	.achievements li.earned {
		color: var(--md-sys-color-primary);
	}

	.text {
		display: grid;
		gap: 2px;
	}

	.name {
		color: var(--md-sys-color-on-surface);
		font-weight: var(--md-sys-typescale-weight-medium);
	}
</style>
