<script lang="ts" generics="V extends string">
	import { RadioGroup } from 'bits-ui';
	import { uid } from './motion';

	interface Option {
		value: V;
		label: string;
		description?: string;
		disabled?: boolean;
	}

	interface Props {
		/** The group's visible name. */
		label: string;
		options: readonly Option[];
		value: V;
		onchange?: (value: V) => void;
		orientation?: 'vertical' | 'horizontal';
		disabled?: boolean;
		class?: string;
	}

	let {
		label,
		options,
		value = $bindable(),
		onchange,
		orientation = 'vertical',
		disabled = false,
		class: className
	}: Props = $props();

	const labelId = uid('radio-label');
</script>

<div class={['radio-field', className]}>
	<span class="group-label" id={labelId}>{label}</span>
	<RadioGroup.Root
		{value}
		{orientation}
		{disabled}
		aria-labelledby={labelId}
		onValueChange={(next) => {
			value = next as V;
			onchange?.(next as V);
		}}
	>
		{#snippet child({ props })}
			<div {...props} class={['options', orientation]}>
				{#each options as option (option.value)}
					{@const id = `${labelId}-${option.value}`}
					<div class="option">
						<RadioGroup.Item value={option.value} disabled={option.disabled} {id}>
							{#snippet child({ props: itemProps, checked })}
								<button {...itemProps} class={['radio', { checked }]}>
									<span class="dot"></span>
								</button>
							{/snippet}
						</RadioGroup.Item>
						<label for={id}>
							<span>{option.label}</span>
							{#if option.description}<span class="description">{option.description}</span>{/if}
						</label>
					</div>
				{/each}
			</div>
		{/snippet}
	</RadioGroup.Root>
</div>

<style>
	.radio-field {
		display: grid;
		gap: var(--space-1);
	}

	.group-label {
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		color: var(--md-sys-color-on-surface-variant);
	}

	.options {
		display: flex;
		flex-direction: column;
	}

	.options.horizontal {
		flex-flow: row wrap;
		column-gap: var(--space-4);
	}

	.option {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--touch-target);
	}

	label {
		display: grid;
		gap: 2px;
		cursor: pointer;
		color: var(--md-sys-color-on-surface);
	}

	.description {
		font-size: var(--md-sys-typescale-body-medium-size);
		color: var(--md-sys-color-on-surface-variant);
	}

	.radio {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		width: 20px;
		height: 20px;
		margin: 14px;
		padding: 0;
		border: 2px solid var(--md-sys-color-on-surface-variant);
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
	}

	.radio::after {
		content: '';
		position: absolute;
		inset: -14px;
	}

	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--md-sys-color-primary);
		transform: scale(0);
		transition: transform var(--duration-fast) var(--easing-standard);
	}

	.checked {
		border-color: var(--md-sys-color-primary);
	}

	.checked .dot {
		transform: scale(1);
	}

	.radio:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 4px;
	}

	.radio:disabled {
		cursor: default;
		opacity: 0.38;
	}
</style>
