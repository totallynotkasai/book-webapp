<script lang="ts">
	import { Dialog } from 'bits-ui';
	import { keepOpenForSnackbar } from './outside';
	import type { Snippet } from 'svelte';

	/**
	 * A modal without a dialog's title bar and buttons: the reader's pop-up picture card and the
	 * lightbox (§8.2). Focus is trapped inside; Esc and a tap outside close it. The accessible
	 * name comes from `label`.
	 */
	interface Props {
		open: boolean;
		label: string;
		variant?: 'card' | 'fullscreen';
		children: Snippet;
		onclose?: () => void;
		class?: string;
	}

	let {
		open = $bindable(),
		label,
		variant = 'card',
		children,
		onclose,
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
				<div {...props} class={['scrim', variant]}></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content aria-label={label} onInteractOutside={keepOpenForSnackbar}>
			{#snippet child({ props })}
				<div {...props} class={['overlay', variant, className]}>
					{@render children()}
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
		background: color-mix(in srgb, var(--md-sys-color-scrim) 40%, transparent);
		animation: fade-in var(--duration-base) var(--easing-standard);
	}

	.scrim.fullscreen {
		background: color-mix(in srgb, var(--md-sys-color-scrim) 88%, transparent);
	}

	.overlay {
		position: fixed;
		z-index: 41;
		outline: none;
	}

	.overlay.card {
		top: 50%;
		left: 50%;
		width: min(calc(100vw - 2 * var(--space-4)), 640px);
		max-height: calc(100dvh - 2 * var(--space-5));
		overflow: auto;
		border-radius: var(--md-sys-shape-corner-extra-large);
		background: var(--md-sys-color-surface-container-high);
		color: var(--md-sys-color-on-surface);
		box-shadow: var(--md-sys-elevation-3);
		transform: translate(-50%, -50%);
		animation: pop-in var(--duration-base) var(--easing-emphasized-decelerate);
	}

	.overlay.fullscreen {
		inset: 0;
		color: #fff;
		animation: fade-in var(--duration-base) var(--easing-standard);
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

	@media (prefers-reduced-motion: reduce) {
		.scrim,
		.overlay {
			animation: none;
		}
	}
</style>
