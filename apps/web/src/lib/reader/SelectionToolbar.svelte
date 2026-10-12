<script lang="ts">
	import type { HighlightColour } from '@book/core';
	import { highlightLabels } from '@book/tokens';
	import { IconButton } from '@book/ui';

	/**
	 * The selection toolbar (P1-RDR-06, DESIGN.md §9.3; plan §6 Phase 1.3 UX notes): floats above
	 * the selection, or below when there's no room, and never covers it. On touch it sits below,
	 * clear of the native handles, leaving the space above to Android's own menu (ADR-004).
	 * Arrow keys move between its buttons (a WAI-ARIA toolbar); Esc closes it.
	 */
	interface Props {
		/** The selection or highlight, in viewport coordinates. */
		rect: DOMRect;
		pointer: 'mouse' | 'touch' | 'pen' | 'keyboard';
		/** The colour of the highlight being edited; undefined for a new selection. */
		colour?: HighlightColour;
		hasNote: boolean;
		/** Offer "Remove highlight" (the selection touches one, or a highlight is being edited). */
		canRemove: boolean;
		/** Move focus into the toolbar when it opens (keyboard selection). */
		autofocus?: boolean;
		onhighlight: (colour: HighlightColour) => void;
		onnote: () => void;
		oncopy: () => void;
		onremove: () => void;
		onclose: () => void;
	}

	let {
		rect,
		pointer,
		colour,
		hasNote,
		canRemove,
		autofocus = false,
		onhighlight,
		onnote,
		oncopy,
		onremove,
		onclose
	}: Props = $props();

	const COLOURS: HighlightColour[] = [1, 2, 3, 4, 5];
	const GAP = 8;
	/** Room for Android's selection handles under the text. */
	const HANDLE_GAP = 36;
	/** The reader's top bar; the toolbar shouldn't sit under it. */
	const TOP_RESERVED = 64;

	let toolbar = $state<HTMLElement>();
	let width = $state(0);
	let height = $state(0);
	let viewportWidth = $state(typeof innerWidth === 'number' ? innerWidth : 1024);
	let viewportHeight = $state(typeof innerHeight === 'number' ? innerHeight : 768);

	const position = $derived.by(() => {
		const touch = pointer === 'touch' || pointer === 'pen';
		const above = rect.top - GAP - height;
		const below = rect.bottom + (touch ? HANDLE_GAP : GAP);
		const fitsAbove = above >= TOP_RESERVED;
		const fitsBelow = below + height <= viewportHeight - GAP;
		const top = touch
			? fitsBelow || !fitsAbove
				? below
				: above
			: fitsAbove || !fitsBelow
				? Math.max(GAP, above)
				: below;
		const centre = rect.left + rect.width / 2;
		const left = Math.min(Math.max(GAP, centre - width / 2), viewportWidth - width - GAP);
		return { top: Math.min(top, viewportHeight - height - GAP), left: Math.max(GAP, left) };
	});

	$effect(() => {
		if (autofocus) toolbar?.querySelector<HTMLElement>('button')?.focus();
	});

	function buttons(): HTMLElement[] {
		return [...(toolbar?.querySelectorAll<HTMLElement>('button') ?? [])];
	}

	function onkeydown(event: KeyboardEvent) {
		const all = buttons();
		const index = all.indexOf(document.activeElement as HTMLElement);
		let next = -1;
		if (event.key === 'ArrowRight') next = (index + 1) % all.length;
		else if (event.key === 'ArrowLeft') next = (index - 1 + all.length) % all.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = all.length - 1;
		else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onclose();
			return;
		}
		if (next >= 0) {
			event.preventDefault();
			event.stopPropagation();
			all[next]?.focus();
		}
	}
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} />

<div
	class="toolbar"
	role="toolbar"
	aria-label={colour ? 'Highlight' : 'Selection'}
	aria-orientation="horizontal"
	tabindex="-1"
	data-testid="selection-toolbar"
	bind:this={toolbar}
	bind:offsetWidth={width}
	bind:offsetHeight={height}
	style:top={`${position.top}px`}
	style:left={`${position.left}px`}
	{onkeydown}
>
	<div class="swatches">
		{#each COLOURS as c (c)}
			<button
				type="button"
				class="swatch"
				style:--swatch={`var(--md-sys-color-highlight-${c})`}
				aria-label={colour ? highlightLabels[c] : `Highlight ${highlightLabels[c].toLowerCase()}`}
				aria-pressed={colour ? colour === c : undefined}
				onclick={() => onhighlight(c)}
			></button>
		{/each}
	</div>
	<span class="divider" aria-hidden="true"></span>
	<IconButton icon="edit_note" label={hasNote ? 'Edit note' : 'Add note'} onclick={onnote} />
	<IconButton icon="content_copy" label="Copy" onclick={oncopy} />
	{#if canRemove}
		<IconButton icon="delete" label="Remove highlight" onclick={onremove} />
	{/if}
</div>

<style>
	.toolbar {
		position: fixed;
		z-index: 20;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: var(--space-1);
		max-width: calc(100vw - 16px);
		padding: var(--space-1) var(--space-2);
		border-radius: 28px;
		background: var(--md-sys-color-surface-container-high);
		color: var(--md-sys-color-on-surface);
		box-shadow: var(--md-sys-elevation-3);
		/* Always readable, whatever the book's theme. */
		font-family: var(--font-ui);
	}

	.swatches {
		display: flex;
		gap: 2px;
	}

	.swatch {
		position: relative;
		width: var(--touch-target);
		height: var(--touch-target);
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
	}

	.swatch::before {
		content: '';
		position: absolute;
		inset: 12px;
		border-radius: 50%;
		background: var(--swatch);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline);
	}

	.swatch[aria-pressed='true']::before {
		inset: 9px;
		box-shadow:
			inset 0 0 0 2px var(--md-sys-color-on-surface),
			inset 0 0 0 4px var(--swatch);
	}

	.swatch:hover {
		background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
	}

	.swatch:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: -3px;
	}

	.divider {
		width: 1px;
		height: 24px;
		background: var(--md-sys-color-outline-variant);
	}

	/* Phones: colours on one row, actions on the next, with full-size touch targets. */
	@media (max-width: 420px) {
		.divider {
			display: none;
		}
	}
</style>
