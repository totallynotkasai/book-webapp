<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';
	import { uid } from './motion';

	interface Props extends Omit<HTMLInputAttributes, 'class' | 'value'> {
		label: string;
		value: string;
		/** Help under the field. Replaced by `error` when there is one. */
		supportingText?: string;
		/** Says what's wrong and how to fix it (§11.6). */
		error?: string;
		leadingIcon?: IconName;
		/** E.g. a clear button. */
		trailing?: Snippet;
		/** A multi-line field (notes). */
		multiline?: boolean;
		rows?: number;
		class?: string;
		element?: HTMLInputElement | HTMLTextAreaElement;
	}

	let {
		label,
		value = $bindable(),
		supportingText,
		error,
		leadingIcon,
		trailing,
		multiline = false,
		rows = 4,
		class: className,
		id = uid('field'),
		element = $bindable(),
		...rest
	}: Props = $props();

	const helpId = $derived(`${id}-help`);
	const help = $derived(error ?? supportingText);
</script>

<div class={['text-field', className, { invalid: !!error, multiline }]}>
	<label for={id}>{label}</label>
	<div class="control">
		{#if leadingIcon}<Icon name={leadingIcon} size={20} class="leading" />{/if}
		{#if multiline}
			<textarea
				{id}
				{rows}
				bind:value
				bind:this={element}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={help ? helpId : undefined}
				placeholder={rest.placeholder}
				disabled={rest.disabled}
				required={rest.required}
				maxlength={rest.maxlength}
				oninput={rest.oninput as never}
				onkeydown={rest.onkeydown as never}></textarea>
		{:else}
			<input
				{id}
				bind:value
				bind:this={element}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={help ? helpId : undefined}
				{...rest}
			/>
		{/if}
		{#if trailing}<span class="trailing">{@render trailing()}</span>{/if}
	</div>
	{#if help}
		<p class="help" id={helpId} role={error ? 'alert' : undefined}>
			{#if error}<Icon name="error" size={16} />{/if}
			{help}
		</p>
	{/if}
</div>

<style>
	.text-field {
		display: grid;
		gap: var(--space-1);
	}

	label {
		font-size: var(--md-sys-typescale-body-medium-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		color: var(--md-sys-color-on-surface-variant);
	}

	.control {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 56px;
		padding: 0 var(--space-3);
		border-radius: var(--md-sys-shape-corner-extra-small);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline);
		background: transparent;
		color: var(--md-sys-color-on-surface);
	}

	.multiline .control {
		align-items: flex-start;
		padding: var(--space-3);
	}

	.control:focus-within {
		box-shadow: inset 0 0 0 2px var(--md-sys-color-primary);
	}

	.invalid .control {
		box-shadow: inset 0 0 0 2px var(--md-sys-color-error);
	}

	.control :global(.leading) {
		color: var(--md-sys-color-on-surface-variant);
	}

	input,
	textarea {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: var(--md-sys-typescale-body-large-size);
	}

	textarea {
		resize: vertical;
		line-height: var(--md-sys-typescale-body-large-line-height);
	}

	.help {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin: 0;
		font-size: var(--md-sys-typescale-body-small-size);
		color: var(--md-sys-color-on-surface-variant);
	}

	.invalid .help {
		color: var(--md-sys-color-error);
	}
</style>
