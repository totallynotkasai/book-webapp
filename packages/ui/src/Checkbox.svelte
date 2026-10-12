<script lang="ts">
	import { Checkbox } from 'bits-ui';
	import Icon from './Icon.svelte';
	import { uid } from './motion';

	interface Props {
		label: string;
		description?: string;
		checked: boolean;
		onchange?: (checked: boolean) => void;
		disabled?: boolean;
		class?: string;
	}

	let {
		label,
		description,
		checked = $bindable(),
		onchange,
		disabled = false,
		class: className
	}: Props = $props();

	const id = uid('checkbox');
	const descriptionId = `${id}-description`;
</script>

<div class={['checkbox-field', className]}>
	<Checkbox.Root
		{id}
		{checked}
		{disabled}
		aria-describedby={description ? descriptionId : undefined}
		onCheckedChange={(next) => {
			checked = next;
			onchange?.(next);
		}}
	>
		{#snippet child({ props, checked: on })}
			<button {...props} class={['box', { on }]}>
				{#if on}<Icon name="check" size={18} />{/if}
			</button>
		{/snippet}
	</Checkbox.Root>
	<label for={id}>
		<span>{label}</span>
		{#if description}<span class="description" id={descriptionId}>{description}</span>{/if}
	</label>
</div>

<style>
	.checkbox-field {
		display: flex;
		align-items: center;
		gap: var(--space-3);
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

	.box {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		width: 18px;
		height: 18px;
		padding: 0;
		margin: 15px;
		border: 2px solid var(--md-sys-color-on-surface-variant);
		border-radius: 2px;
		background: transparent;
		color: var(--md-sys-color-on-primary);
		cursor: pointer;
	}

	.box::after {
		content: '';
		position: absolute;
		inset: -15px;
	}

	.on {
		border-color: var(--md-sys-color-primary);
		background: var(--md-sys-color-primary);
	}

	.box:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 4px;
	}

	.box:disabled {
		cursor: default;
		opacity: 0.38;
	}
</style>
