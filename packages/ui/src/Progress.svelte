<script lang="ts">
	import { Progress } from 'bits-ui';

	interface Props {
		kind?: 'linear' | 'circular';
		/** 0 to 1. Leave out (or null) while the amount isn't known. */
		value?: number | null;
		/** What is in progress, for screen readers ("Importing book"). */
		label: string;
		/** Circular size in px. */
		size?: number;
		class?: string;
	}

	let { kind = 'linear', value = null, label, size = 40, class: className }: Props = $props();
	const indeterminate = $derived(value === null || value === undefined);
	const percent = $derived(indeterminate ? 0 : Math.round(Math.min(1, Math.max(0, value!)) * 100));
	const RADIUS = 18;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
</script>

<Progress.Root value={indeterminate ? null : percent} max={100} aria-label={label}>
	{#snippet child({ props })}
		{#if kind === 'linear'}
			<div {...props} class={['linear', className, { indeterminate }]}>
				<div class="bar" style:width={indeterminate ? undefined : `${percent}%`}></div>
			</div>
		{:else}
			<div
				{...props}
				class={['circular', className, { indeterminate }]}
				style:width={`${size}px`}
				style:height={`${size}px`}
			>
				<svg viewBox="0 0 44 44" aria-hidden="true">
					<circle class="track" cx="22" cy="22" r={RADIUS} />
					<circle
						class="arc"
						cx="22"
						cy="22"
						r={RADIUS}
						stroke-dasharray={CIRCUMFERENCE}
						stroke-dashoffset={indeterminate
							? CIRCUMFERENCE * 0.7
							: CIRCUMFERENCE * (1 - percent / 100)}
					/>
				</svg>
			</div>
		{/if}
	{/snippet}
</Progress.Root>

<style>
	.linear {
		position: relative;
		overflow: hidden;
		width: 100%;
		height: 4px;
		border-radius: var(--md-sys-shape-corner-full);
		background: var(--md-sys-color-secondary-container);
	}

	.bar {
		height: 100%;
		border-radius: inherit;
		background: var(--md-sys-color-primary);
		transition: width var(--duration-base) var(--easing-standard);
	}

	.linear.indeterminate .bar {
		width: 40%;
		animation: slide calc(var(--duration-slow) * 3) var(--easing-standard) infinite;
	}

	.circular {
		display: inline-grid;
		flex: none;
	}

	.circular svg {
		width: 100%;
		height: 100%;
		transform: rotate(-90deg);
	}

	.track {
		fill: none;
		stroke: var(--md-sys-color-secondary-container);
		stroke-width: 4;
	}

	.arc {
		fill: none;
		stroke: var(--md-sys-color-primary);
		stroke-width: 4;
		stroke-linecap: round;
		transition: stroke-dashoffset var(--duration-base) var(--easing-standard);
	}

	.circular.indeterminate svg {
		animation: spin calc(var(--duration-slow) * 3) linear infinite;
	}

	/* Reduced motion zeroes the durations (tokens.css), which would leave the sliding bar at its
	   last keyframe, out of view: it stays still, in the middle of the track, instead (P1-QA-02). */
	@media (prefers-reduced-motion: reduce) {
		.linear.indeterminate .bar {
			margin-inline: auto;
			animation: none;
		}

		.circular.indeterminate svg {
			animation: none;
		}
	}

	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(250%);
		}
	}

	@keyframes spin {
		from {
			transform: rotate(-90deg);
		}
		to {
			transform: rotate(270deg);
		}
	}
</style>
