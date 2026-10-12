<script lang="ts">
	import { Switch } from 'bits-ui';
	import { uid } from './motion';

	interface Props {
		label: string;
		/** A second line under the label. */
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

	const id = uid('switch');
	const descriptionId = `${id}-description`;
</script>

<div class={['switch-field', className]}>
	<label for={id}>
		<span class="label">{label}</span>
		{#if description}<span class="description" id={descriptionId}>{description}</span>{/if}
	</label>
	<Switch.Root
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
			<button {...props} class={['switch', { on }]}>
				<span class="handle"></span>
			</button>
		{/snippet}
	</Switch.Root>
</div>

<style>
	.switch-field {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		min-height: var(--touch-target);
	}

	label {
		display: grid;
		gap: 2px;
		cursor: pointer;
	}

	.label {
		font-size: var(--md-sys-typescale-body-large-size);
		color: var(--md-sys-color-on-surface);
	}

	.description {
		font-size: var(--md-sys-typescale-body-medium-size);
		color: var(--md-sys-color-on-surface-variant);
	}

	.switch {
		position: relative;
		flex: none;
		width: 52px;
		height: 32px;
		padding: 0;
		border: 2px solid var(--md-sys-color-outline);
		border-radius: var(--md-sys-shape-corner-full);
		background: var(--md-sys-color-surface-container-highest);
		cursor: pointer;
		transition: background-color var(--duration-fast) var(--easing-standard);
	}

	.switch::after {
		content: '';
		position: absolute;
		inset: -8px -2px;
	}

	.handle {
		position: absolute;
		top: 50%;
		left: 6px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--md-sys-color-outline);
		transform: translateY(-50%);
		transition:
			left var(--duration-fast) var(--easing-standard),
			width var(--duration-fast) var(--easing-standard),
			height var(--duration-fast) var(--easing-standard);
	}

	.on {
		border-color: var(--md-sys-color-primary);
		background: var(--md-sys-color-primary);
	}

	.on .handle {
		left: 22px;
		width: 24px;
		height: 24px;
		background: var(--md-sys-color-on-primary);
	}

	.switch:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 2px;
	}

	.switch:disabled {
		cursor: default;
		opacity: 0.38;
	}
</style>
