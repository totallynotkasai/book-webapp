<script lang="ts">
	import { normaliseHex, PLACEHOLDER_SEED, seedPresets } from '@book/tokens';
	import { Icon, TextField } from '@book/ui';

	interface Props {
		/** The chosen seed; undefined means the default (the placeholder brand seed). */
		value: string | undefined;
		onchange: (seed: string) => void;
	}

	let { value, onchange }: Props = $props();

	const current = $derived((value ?? PLACEHOLDER_SEED).toLowerCase());
	const preset = $derived(seedPresets.find((p) => p.seed.toLowerCase() === current));
	// What the field shows: the current seed, until the reader types over it.
	let typed = $derived(current);
	let typedError = $state<string>();

	function commitTyped() {
		const hex = normaliseHex(typed);
		if (!hex) {
			typedError = 'Enter a colour like #00696b.';
			return;
		}
		typedError = undefined;
		onchange(hex);
	}
</script>

<!-- Native radios keep arrow-key movement and screen-reader semantics; they're drawn as swatches. -->
<fieldset class="seed-picker">
	<legend>Colour</legend>
	<div class="swatches">
		{#each seedPresets as option (option.id)}
			<label class="swatch" style:--swatch={option.seed} title={option.label}>
				<input
					type="radio"
					name="seed"
					value={option.seed}
					checked={preset?.id === option.id}
					onchange={() => onchange(option.seed.toLowerCase())}
				/>
				<span class="dot" aria-hidden="true">
					{#if preset?.id === option.id}<Icon name="check" size={20} />{/if}
				</span>
				<span class="visually-hidden">{option.label}</span>
			</label>
		{/each}
		<label class="swatch custom" style:--swatch={current} title="Custom colour">
			<input
				type="radio"
				name="seed"
				value="custom"
				checked={!preset}
				onchange={(e) =>
					(
						e.currentTarget.parentElement?.querySelector(
							'input[type=color]'
						) as HTMLInputElement | null
					)?.click()}
			/>
			<span class="dot" aria-hidden="true"><Icon name="palette" size={20} /></span>
			<span class="visually-hidden">Custom colour</span>
			<input
				class="colour-input"
				type="color"
				value={current}
				tabindex="-1"
				aria-hidden="true"
				oninput={(e) => onchange(e.currentTarget.value.toLowerCase())}
			/>
		</label>
	</div>
	<div class="custom-field">
		<TextField
			label="Custom colour (hex)"
			bind:value={typed}
			error={typedError}
			supportingText="Any colour works: the theme keeps text readable."
			onkeydown={(e) => {
				if (e.key === 'Enter') commitTyped();
			}}
			onblur={commitTyped}
			spellcheck={false}
			autocomplete="off"
		/>
	</div>
</fieldset>

<style>
	.seed-picker {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		margin-bottom: var(--space-2);
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		color: var(--md-sys-color-on-surface-variant);
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.swatch {
		position: relative;
		display: grid;
		place-items: center;
		width: var(--touch-target);
		height: var(--touch-target);
		cursor: pointer;
	}

	.swatch input[type='radio'] {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.dot {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--swatch);
		color: #fff;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, #000 20%, transparent);
	}

	.custom .dot {
		background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);
	}

	.swatch:has(input[type='radio']:checked) .dot {
		box-shadow:
			0 0 0 3px var(--md-sys-color-surface),
			0 0 0 5px var(--md-sys-color-on-surface);
	}

	.swatch:has(input[type='radio']:focus-visible) .dot {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 5px;
	}

	.colour-input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.custom-field {
		max-width: 20rem;
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
