<script lang="ts">
	import type { TableView } from '@book/reader-core';
	import { IconButton, Overlay } from '@book/ui';
	import { flushSync } from 'svelte';

	/**
	 * The table viewer (P1-RDR-12; plan §6 Phase 1.13 UX notes): a squeezed table full screen,
	 * unwrapped, on a sheet the colour of the page around it. It's the lightbox's (§8.2): the same
	 * full-screen overlay and buttons, and pinch, Ctrl+wheel and double-tap to zoom. It pans by
	 * scrolling, so it glides under a finger and works with the keyboard and screen readers, and
	 * the table stays real text. It opens at the reader's own text size.
	 */
	interface Props {
		open: boolean;
		view: TableView | null;
	}

	let { open = $bindable(), view }: Props = $props();

	const MAX = 5;
	let zoom = $state(1);
	/** Small enough to see the whole width at once, never above 1. */
	let fit = $state(1);
	let stage = $state<HTMLElement>();
	let sheet = $state<HTMLElement>();

	$effect(() => {
		if (open) zoom = 1;
	});

	/** Puts the copied table in the sheet, at its start, and works out how far it can zoom out. */
	function mount(table: HTMLTableElement) {
		return (node: HTMLElement) => {
			node.replaceChildren(table);
			requestAnimationFrame(() => {
				if (!stage || !sheet) return;
				stage.scrollTo(0, 0);
				const width = sheet.offsetWidth;
				fit = width ? Math.min(1, stage.clientWidth / width) : 1;
			});
		};
	}

	/** Zooms, keeping the point under the fingers (or the stage's centre) where it is. */
	function zoomTo(next: number, at?: { x: number; y: number }) {
		if (!stage) return;
		const to = Math.min(MAX, Math.max(Math.min(fit, 1), next));
		const box = stage.getBoundingClientRect();
		const x = at ? at.x - box.left : stage.clientWidth / 2;
		const y = at ? at.y - box.top : stage.clientHeight / 2;
		const contentX = (stage.scrollLeft + x) / zoom;
		const contentY = (stage.scrollTop + y) / zoom;
		zoom = to;
		flushSync();
		stage.scrollLeft = contentX * to - x;
		stage.scrollTop = contentY * to - y;
	}

	/**
	 * Two fingers pinch; one pans natively (`touch-action: pan-x pan-y`). Ctrl+wheel zooms, as in
	 * the lightbox; a plain wheel scrolls. Listeners are added here because they must be able to
	 * prevent the browser's own handling (Svelte's are passive).
	 */
	function gestures(node: HTMLElement) {
		let pinch: { distance: number; zoom: number } | null = null;
		const distance = (t: TouchList) =>
			Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
		const middle = (t: TouchList) => ({
			x: (t[0]!.clientX + t[1]!.clientX) / 2,
			y: (t[0]!.clientY + t[1]!.clientY) / 2
		});
		const start = (event: TouchEvent) => {
			if (event.touches.length === 2) pinch = { distance: distance(event.touches), zoom };
		};
		const move = (event: TouchEvent) => {
			if (!pinch || event.touches.length !== 2) return;
			event.preventDefault();
			zoomTo((pinch.zoom * distance(event.touches)) / pinch.distance, middle(event.touches));
		};
		const end = (event: TouchEvent) => {
			if (event.touches.length < 2) pinch = null;
		};
		const wheel = (event: WheelEvent) => {
			if (!event.ctrlKey) return;
			event.preventDefault();
			zoomTo(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), { x: event.clientX, y: event.clientY });
		};
		node.addEventListener('touchstart', start, { passive: true });
		node.addEventListener('touchmove', move, { passive: false });
		node.addEventListener('touchend', end);
		node.addEventListener('touchcancel', end);
		node.addEventListener('wheel', wheel, { passive: false });
		return () => {
			node.removeEventListener('touchstart', start);
			node.removeEventListener('touchmove', move);
			node.removeEventListener('touchend', end);
			node.removeEventListener('touchcancel', end);
			node.removeEventListener('wheel', wheel);
		};
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.key === '+' || event.key === '=') zoomTo(zoom * 1.5);
		else if (event.key === '-') zoomTo(zoom / 1.5);
		else if (event.key === '0') zoomTo(1);
		else return;
		event.preventDefault();
	}

	const label = $derived(view?.caption ? `Table: ${view.caption}` : 'Table');
</script>

<Overlay bind:open {label} variant="fullscreen">
	{#if view}
		<div class="viewer" data-testid="table-viewer">
			<div class="tools">
				<IconButton
					icon="zoom_out"
					label="Zoom out"
					disabled={zoom <= Math.min(fit, 1) + 0.001}
					onclick={() => zoomTo(zoom / 1.5)}
				/>
				<IconButton
					icon="zoom_in"
					label="Zoom in"
					disabled={zoom >= MAX}
					onclick={() => zoomTo(zoom * 1.5)}
				/>
				<IconButton icon="close" label="Close" onclick={() => (open = false)} />
			</div>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (it scrolls to pan: focusable so the arrow keys scroll it, and + and - zoom) -->
			<div
				class="stage"
				role="region"
				aria-label={`${label}. Scroll to see all of it.`}
				tabindex="0"
				data-testid="table-stage"
				data-zoom={zoom.toFixed(2)}
				bind:this={stage}
				{onkeydown}
				ondblclick={(event) => zoomTo(zoom > 1.01 ? 1 : 2, { x: event.clientX, y: event.clientY })}
				{@attach gestures}
			>
				<div
					class="sheet"
					style:zoom
					style:background-color={view.background}
					style:color={view.color}
					bind:this={sheet}
					{@attach mount(view.table)}
				></div>
			</div>
		</div>
	{/if}
</Overlay>

<style>
	.viewer {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-rows: auto 1fr;
		padding: calc(var(--safe-top) + var(--space-2)) var(--space-3)
			calc(var(--safe-bottom) + var(--space-3));
	}

	.tools {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-1);
		--md-sys-color-on-surface-variant: #fff;
	}

	/* Auto margins centre the sheet while it fits, and give way once it doesn't (it scrolls). */
	.stage {
		display: grid;
		min-height: 0;
		overflow: auto;
		overscroll-behavior: contain;
		touch-action: pan-x pan-y;
		border-radius: var(--md-sys-shape-corner-medium);
	}

	.stage:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}

	.sheet {
		margin: auto;
		padding: var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		outline: 1px solid color-mix(in srgb, currentColor 24%, transparent);
	}

	/* Unwrapped: words whole, columns as wide as they want, long passages wrapping at a line. */
	.sheet :global(table) {
		width: max-content;
		max-width: 40em;
		margin: 0;
	}

	.sheet :global(:is(th, td)) {
		overflow-wrap: normal;
		hyphens: manual;
	}
</style>
