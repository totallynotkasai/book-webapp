<script lang="ts">
	import type { RatingSummaryDto } from '@book/core';
	import { Icon } from '@book/ui';

	/**
	 * Readers' ratings of a Layer (P1-COM-02): the average and how many, and, with `onrate`, the
	 * reader's own as five stars to press (the one chosen is pressed).
	 */
	interface Props {
		rating: RatingSummaryDto | null;
		/** The reader's own rating. */
		mine?: number | null;
		/** Lets the reader rate; absent when they can't (they don't have it). */
		onrate?: (stars: number) => void;
		/** What's being rated, for screen readers. */
		name: string;
	}

	let { rating, mine = null, onrate, name }: Props = $props();
</script>

<div class="rating">
	<span class="summary">
		<Icon name="star-fill" size={16} />
		{#if rating}
			{rating.average.toFixed(1)}
			<span class="count">({rating.count} {rating.count === 1 ? 'rating' : 'ratings'})</span>
		{:else}
			<span class="count">No ratings yet</span>
		{/if}
	</span>
	{#if onrate}
		<div class="stars" role="group" aria-label={`Your rating for ${name}`}>
			{#each [1, 2, 3, 4, 5] as stars (stars)}
				<button
					type="button"
					aria-pressed={mine === stars}
					aria-label={`Rate ${stars} ${stars === 1 ? 'star' : 'stars'}`}
					class={['star', { on: mine !== null && stars <= mine }]}
					onclick={() => onrate(stars)}
				>
					<Icon name={mine !== null && stars <= mine ? 'star-fill' : 'star'} size={22} />
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.rating {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.summary {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--md-sys-color-on-surface);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.count {
		color: var(--md-sys-color-on-surface-variant);
	}

	.stars {
		display: inline-flex;
	}

	.star {
		display: grid;
		place-items: center;
		width: var(--touch-target);
		height: var(--touch-target);
		padding: 0;
		border: none;
		border-radius: var(--md-sys-shape-corner-full);
		background: transparent;
		color: var(--md-sys-color-on-surface-variant);
		cursor: pointer;
	}

	.star.on {
		color: var(--md-sys-color-primary);
	}

	.star:hover {
		background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
	}

	.star:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: -3px;
	}
</style>
