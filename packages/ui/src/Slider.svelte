<script lang="ts">
	import { Slider } from 'bits-ui';
	import { uid } from './motion';

	interface Props {
		/** Visible label, also the slider's accessible name. */
		label: string;
		value: number;
		min?: number;
		max?: number;
		step?: number;
		/** How the value reads aloud and on screen ("110%"). */
		format?: (value: number) => string;
		/** Called as the value changes. */
		oninput?: (value: number) => void;
		/** Called when the reader lets go (or presses a key). */
		onchange?: (value: number) => void;
		disabled?: boolean;
		showValue?: boolean;
		class?: string;
	}

	let {
		label,
		value = $bindable(),
		min = 0,
		max = 100,
		step = 1,
		format = (v: number) => String(v),
		oninput,
		onchange,
		disabled = false,
		showValue = true,
		class: className
	}: Props = $props();

	const labelId = uid('slider-label');
	/**
	 * Whether the reader is moving it. Bits UI also reports a change when it clamps the value to
	 * a new `max` (narration's next, shorter Chapter), which isn't the reader's; `oninput` is.
	 */
	let interacting = false;
</script>

<div
	class={['slider-field', className]}
	onpointerdowncapture={() => (interacting = true)}
	onkeydowncapture={() => (interacting = true)}
	onpointerupcapture={() => (interacting = false)}
	onkeyupcapture={() => (interacting = false)}
>
	<div class="heading">
		<span id={labelId} class="label">{label}</span>
		{#if showValue}<span class="value" aria-hidden="true">{format(value)}</span>{/if}
	</div>
	<Slider.Root
		type="single"
		{value}
		{min}
		{max}
		{step}
		{disabled}
		onValueChange={(next) => {
			value = next;
			if (interacting) oninput?.(next);
		}}
		onValueCommit={(next) => onchange?.(next)}
	>
		{#snippet child({ props })}
			<span {...props} class="slider">
				<span class="track">
					<Slider.Range>
						{#snippet child({ props: rangeProps })}
							<span {...rangeProps} class="range"></span>
						{/snippet}
					</Slider.Range>
				</span>
				<Slider.Thumb index={0}>
					{#snippet child({ props: thumbProps })}
						<span
							{...thumbProps}
							class="thumb"
							aria-labelledby={labelId}
							aria-valuetext={format(value)}
						></span>
					{/snippet}
				</Slider.Thumb>
			</span>
		{/snippet}
	</Slider.Root>
</div>

<style>
	.slider-field {
		display: grid;
		gap: var(--space-1);
		min-width: 12rem;
	}

	.heading {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: var(--md-sys-typescale-body-medium-size);
		color: var(--md-sys-color-on-surface);
	}

	.value {
		color: var(--md-sys-color-on-surface-variant);
		font-variant-numeric: tabular-nums;
	}

	.slider {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		height: var(--touch-target);
		touch-action: none;
		user-select: none;
		cursor: pointer;
	}

	.track {
		position: relative;
		flex: 1;
		height: 4px;
		border-radius: var(--md-sys-shape-corner-full);
		background: var(--md-sys-color-secondary-container);
	}

	.range {
		position: absolute;
		height: 100%;
		border-radius: inherit;
		background: var(--md-sys-color-primary);
	}

	.thumb {
		display: block;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--md-sys-color-primary);
		box-shadow: var(--md-sys-elevation-1);
		cursor: grab;
	}

	/* 48 px touch target around the 20 px thumb (§11.7). */
	.thumb::after {
		content: '';
		position: absolute;
		inset: -14px;
	}

	.thumb:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 3px;
	}

	.slider[data-disabled] {
		cursor: default;
		opacity: 0.38;
	}
</style>
