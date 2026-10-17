<script lang="ts">
	import { Slider } from 'bits-ui';

	/**
	 * The scrubber (§4.1, §9.2): progression across the Book with Chapter ticks. While dragging it
	 * shows the Chapter, percentage and time left in the Book (P1-RDR-14); it jumps only on release. It works in progression and Chapter
	 * boundaries, so no whole-Book page map is needed.
	 */
	interface Props {
		/** 0..1 */
		progression: number;
		/** Where each Chapter starts (0..1), with its title. */
		chapters: readonly { title: string; start: number }[];
		/** Time left in the Book from a point (0..1), at the reader's pace; absent when it's off. */
		timeLeftAt?: (fraction: number) => string;
		oncommit: (progression: number) => void;
	}

	let { progression, chapters, timeLeftAt, oncommit }: Props = $props();

	const STEPS = 1000;
	let dragging = $state<number | null>(null);
	const shown = $derived(dragging ?? Math.round(progression * STEPS));
	const fraction = $derived(shown / STEPS);
	const chapterAt = (f: number) => {
		let title = chapters[0]?.title ?? '';
		for (const chapter of chapters) if (chapter.start <= f + 1e-9) title = chapter.title;
		return title;
	};
	const percent = $derived(Math.round(fraction * 100));
	const timeLeft = $derived(timeLeftAt?.(fraction) ?? null);
	const label = $derived(`${percent}%, ${chapterAt(fraction)}${timeLeft ? `, ${timeLeft}` : ''}`);
</script>

<div class="scrubber">
	{#if dragging !== null}
		<div class="bubble" style:left={`${fraction * 100}%`} aria-hidden="true">
			<span class="chapter">{chapterAt(fraction)}</span>
			<span>{percent}%</span>
			{#if timeLeft}<span data-testid="scrubber-time-left">{timeLeft}</span>{/if}
		</div>
	{/if}
	<Slider.Root
		type="single"
		value={shown}
		min={0}
		max={STEPS}
		step={1}
		onValueChange={(v) => (dragging = v)}
		onValueCommit={(v) => {
			dragging = null;
			oncommit(v / STEPS);
		}}
	>
		{#snippet child({ props })}
			<span {...props} class="root">
				<span class="track">
					{#each chapters as chapter, i (i)}
						{#if chapter.start > 0}
							<span class="tick" style:left={`${chapter.start * 100}%`}></span>
						{/if}
					{/each}
					<Slider.Range>
						{#snippet child({ props: rangeProps })}<span {...rangeProps} class="range"
							></span>{/snippet}
					</Slider.Range>
				</span>
				<Slider.Thumb index={0}>
					{#snippet child({ props: thumbProps })}
						<span {...thumbProps} class="thumb" aria-label="Position in book" aria-valuetext={label}
						></span>
					{/snippet}
				</Slider.Thumb>
			</span>
		{/snippet}
	</Slider.Root>
</div>

<style>
	.scrubber {
		position: relative;
		flex: 1;
		min-width: 0;
	}

	.root {
		position: relative;
		display: flex;
		align-items: center;
		height: var(--touch-target);
		touch-action: none;
		cursor: pointer;
	}

	.track {
		position: relative;
		flex: 1;
		height: 4px;
		border-radius: var(--md-sys-shape-corner-full);
		background: var(--md-sys-color-surface-container-highest);
	}

	.range {
		position: absolute;
		height: 100%;
		border-radius: inherit;
		background: var(--md-sys-color-primary);
	}

	.tick {
		position: absolute;
		top: -3px;
		width: 2px;
		height: 10px;
		margin-left: -1px;
		border-radius: 1px;
		background: var(--md-sys-color-outline);
		z-index: 1;
	}

	.thumb {
		display: block;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--md-sys-color-primary);
		box-shadow: var(--md-sys-elevation-1);
	}

	.thumb::after {
		content: '';
		position: absolute;
		inset: -15px;
	}

	.thumb:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 3px;
	}

	.bubble {
		position: absolute;
		bottom: calc(100% + 4px);
		display: grid;
		max-width: 60vw;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--md-sys-shape-corner-small);
		background: var(--md-sys-color-inverse-surface);
		color: var(--md-sys-color-inverse-on-surface);
		font-size: var(--md-sys-typescale-body-small-size);
		text-align: center;
		transform: translateX(-50%);
		white-space: nowrap;
		pointer-events: none;
	}

	.chapter {
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: var(--md-sys-typescale-weight-medium);
	}
</style>
