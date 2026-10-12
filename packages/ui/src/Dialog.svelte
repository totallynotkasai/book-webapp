<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		title: string;
		/** A line under the title, read when the dialog opens. */
		description?: string;
		children?: Snippet;
		/** Buttons at the bottom (confirm last, per M3). */
		actions?: Snippet;
		/** Called when the dialog closes by Esc, the scrim or a close action. */
		onclose?: () => void;
		/** Wider dialogs for forms. */
		size?: 'small' | 'medium';
		class?: string;
	}

	let {
		open = $bindable(),
		title,
		description,
		children,
		actions,
		onclose,
		size = 'small',
		class: className
	}: Props = $props();
</script>

<Dialog.Root
	{open}
	onOpenChange={(next) => {
		open = next;
		if (!next) onclose?.();
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="scrim"></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content>
			{#snippet child({ props })}
				<div {...props} class={['dialog', size, className]}>
					<Dialog.Title>
						{#snippet child({ props: titleProps })}
							<h2 {...titleProps} class="title">{title}</h2>
						{/snippet}
					</Dialog.Title>
					{#if description}
						<Dialog.Description>
							{#snippet child({ props: descriptionProps })}
								<p {...descriptionProps} class="description">{description}</p>
							{/snippet}
						</Dialog.Description>
					{/if}
					{#if children}<div class="body">{@render children()}</div>{/if}
					{#if actions}<div class="actions">{@render actions()}</div>{/if}
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: color-mix(in srgb, var(--md-sys-color-scrim) 32%, transparent);
		animation: fade-in var(--duration-base) var(--easing-standard);
	}

	.dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 41;
		display: grid;
		gap: var(--space-4);
		width: min(calc(100vw - 2 * var(--space-5)), 560px);
		max-height: calc(100dvh - 2 * var(--space-6));
		overflow: auto;
		padding: var(--space-5);
		border-radius: var(--md-sys-shape-corner-extra-large);
		background: var(--md-sys-color-surface-container-high);
		color: var(--md-sys-color-on-surface);
		box-shadow: var(--md-sys-elevation-3);
		transform: translate(-50%, -50%);
		animation: pop-in var(--duration-base) var(--easing-emphasized-decelerate);
	}

	.dialog.small {
		width: min(calc(100vw - 2 * var(--space-5)), 400px);
	}

	.dialog:focus-visible {
		outline: none;
	}

	.title {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--md-sys-typescale-headline-small-size);
		line-height: var(--md-sys-typescale-headline-small-line-height);
		font-weight: var(--md-sys-typescale-weight-regular);
	}

	.description {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-medium-size);
		line-height: var(--md-sys-typescale-body-medium-line-height);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}

	@keyframes pop-in {
		from {
			opacity: 0;
			transform: translate(-50%, -48%) scale(0.96);
		}
	}
</style>
