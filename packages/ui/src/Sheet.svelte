<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import IconButton from './IconButton.svelte';
	import { motionDuration } from './motion';

	/**
	 * The shared sheet behind BottomSheet and SideSheet (§11.4): a modal surface from an edge,
	 * with focus trapped inside, Esc and the scrim to close, and swipe-down on bottom sheets.
	 */
	interface Props {
		open: boolean;
		title: string;
		placement: 'bottom' | 'end' | 'start';
		/** Hide the title visually (it is still the sheet's accessible name). */
		hideTitle?: boolean;
		children: Snippet;
		/** Sticky actions at the bottom of the sheet. */
		footer?: Snippet;
		/** Bottom sheets: `half` keeps the page visible behind (e.g. text re-flowing). */
		height?: 'auto' | 'half' | 'full';
		/** Dim the page behind. Off for sheets whose effect should stay visible. */
		scrim?: boolean;
		onclose?: () => void;
		/** The close button's label. */
		closeLabel?: string;
		class?: string;
	}

	let {
		open = $bindable(),
		title,
		placement,
		hideTitle = false,
		children,
		footer,
		height = 'auto',
		scrim = true,
		onclose,
		closeLabel = 'Close',
		class: className
	}: Props = $props();

	/** Swipe-down distance (px) that closes a bottom sheet. */
	const CLOSE_DISTANCE = 80;
	/** Movement (px) before a press becomes a drag, so taps on the header still reach buttons. */
	const DRAG_SLOP = 8;
	let dragStart: number | null = null;
	let dragging = false;
	let dragOffset = $state(0);
	let settling = $state(false);

	function close() {
		open = false;
		onclose?.();
	}

	function onpointerdown(event: PointerEvent) {
		if (placement !== 'bottom' || event.button !== 0) return;
		if ((event.target as Element).closest('button, a, input')) return;
		dragStart = event.clientY;
		dragging = false;
		settling = false;
	}

	function onpointermove(event: PointerEvent) {
		if (dragStart === null) return;
		const distance = event.clientY - dragStart;
		if (!dragging && distance > DRAG_SLOP) {
			dragging = true;
			(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
		}
		if (dragging) dragOffset = Math.max(0, distance);
	}

	function onpointerup() {
		if (dragStart === null) return;
		dragStart = null;
		if (!dragging) return;
		dragging = false;
		if (dragOffset > CLOSE_DISTANCE) {
			dragOffset = 0;
			close();
			return;
		}
		// Snap back, instantly under reduced motion.
		settling = motionDuration(1) > 0;
		dragOffset = 0;
	}
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
				<div {...props} class={['scrim', { clear: !scrim }]}></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content>
			{#snippet child({ props })}
				<div
					{...props}
					class={['sheet', placement, `height-${height}`, className, { settling }]}
					style:translate={dragOffset ? `0 ${dragOffset}px` : undefined}
				>
					<div
						class="header"
						role="presentation"
						{onpointerdown}
						{onpointermove}
						{onpointerup}
						onpointercancel={onpointerup}
					>
						{#if placement === 'bottom'}<span class="handle" aria-hidden="true"></span>{/if}
						<div class="title-row">
							<Dialog.Title>
								{#snippet child({ props: titleProps })}
									<h2 {...titleProps} class={['title', { 'visually-hidden': hideTitle }]}>
										{title}
									</h2>
								{/snippet}
							</Dialog.Title>
							<IconButton icon="close" label={closeLabel} onclick={close} />
						</div>
					</div>
					<div class="body">{@render children()}</div>
					{#if footer}<div class="footer">{@render footer()}</div>{/if}
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

	.scrim.clear {
		background: transparent;
	}

	.sheet {
		position: fixed;
		z-index: 41;
		display: flex;
		flex-direction: column;
		background: var(--md-sys-color-surface-container-low);
		color: var(--md-sys-color-on-surface);
		box-shadow: var(--md-sys-elevation-2);
		outline: none;
	}

	.sheet.settling {
		transition: translate var(--duration-base) var(--easing-standard);
	}

	.bottom {
		right: 0;
		bottom: 0;
		left: 0;
		max-height: calc(100dvh - var(--safe-top) - var(--space-7));
		margin-inline: auto;
		max-width: 640px;
		padding-bottom: var(--safe-bottom);
		border-radius: var(--md-sys-shape-corner-extra-large) var(--md-sys-shape-corner-extra-large) 0 0;
		animation: slide-up var(--duration-base) var(--easing-emphasized-decelerate);
	}

	.bottom.height-half {
		height: min(50dvh, 100%);
	}

	.bottom.height-full {
		height: calc(100dvh - var(--safe-top) - var(--space-7));
	}

	.end,
	.start {
		top: 0;
		bottom: 0;
		width: min(400px, 100vw);
		padding-top: var(--safe-top);
		padding-bottom: var(--safe-bottom);
	}

	.end {
		right: 0;
		padding-right: var(--safe-right);
		border-radius: var(--md-sys-shape-corner-large) 0 0 var(--md-sys-shape-corner-large);
		animation: slide-in-end var(--duration-base) var(--easing-emphasized-decelerate);
	}

	.start {
		left: 0;
		padding-left: var(--safe-left);
		border-radius: 0 var(--md-sys-shape-corner-large) var(--md-sys-shape-corner-large) 0;
		animation: slide-in-start var(--duration-base) var(--easing-emphasized-decelerate);
	}

	.header {
		flex: none;
		padding: var(--space-2) var(--space-2) 0 var(--space-5);
		touch-action: none;
	}

	.bottom .header {
		cursor: grab;
	}

	.handle {
		display: block;
		width: 32px;
		height: 4px;
		margin: var(--space-2) auto var(--space-1);
		border-radius: var(--md-sys-shape-corner-full);
		background: var(--md-sys-color-on-surface-variant);
		opacity: 0.4;
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: var(--touch-target);
	}

	.title {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--md-sys-typescale-title-large-size);
		line-height: var(--md-sys-typescale-title-large-line-height);
		font-weight: var(--md-sys-typescale-weight-regular);
	}

	.body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: var(--space-2) var(--space-5) var(--space-5);
		overscroll-behavior: contain;
	}

	.footer {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--md-sys-color-outline-variant);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}

	@keyframes slide-up {
		from {
			transform: translateY(100%);
		}
	}

	@keyframes slide-in-end {
		from {
			transform: translateX(100%);
		}
	}

	@keyframes slide-in-start {
		from {
			transform: translateX(-100%);
		}
	}
</style>
