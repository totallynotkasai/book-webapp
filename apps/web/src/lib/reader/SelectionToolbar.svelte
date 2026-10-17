<script lang="ts">
	import type { HighlightColour } from '@book/core';
	import { highlightLabels } from '@book/tokens';
	import { Icon, IconButton } from '@book/ui';
	import { readersLabel } from './together';

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
		/** Space at the bottom edge taken by the reader's own bar, when it shows. */
		bottomInset?: number;
		onhighlight: (colour: HighlightColour) => void;
		onnote: () => void;
		oncopy: () => void;
		/** Share the passage as a card (P1-RDR-16). */
		onshare: () => void;
		onremove: () => void;
		/** Creator mode (P1-LAY-05): attach an Illustration to the selection. */
		onattach?: () => void;
		/** The selection is a glossary name the reader has met (P1-RDR-13): show its entry. */
		onglossary?: () => void;
		/** The selection is one Word of an English Book: look it up (P1-RDR-18). */
		ondefine?: () => void;
		/** Comments are on for the Book and the reader can write: comment on it (P1-COM-03). */
		oncomment?: () => void;
		/** How many readers highlighted it, when it's a popular highlight (P1-COM-04); 0 if not. */
		readers?: number;
		onclose: () => void;
	}

	let {
		rect,
		pointer,
		colour,
		hasNote,
		canRemove,
		autofocus = false,
		bottomInset = 0,
		onhighlight,
		onnote,
		oncopy,
		onshare,
		onremove,
		onattach,
		onglossary,
		ondefine,
		oncomment,
		readers = 0,
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
		const bottom = viewportHeight - Math.max(GAP, bottomInset);
		const fitsBelow = below + height <= bottom;
		// Touch: below, else docked at the bottom (above the reader's bar, or over it if that's the
		// only way to clear the selection); never up into the space Android's own menu uses.
		const clears = (y: number) => y >= rect.bottom + GAP;
		const docked = bottom - height;
		const dockedOverBar = viewportHeight - GAP - height;
		const top = touch
			? fitsBelow
				? below
				: clears(docked)
					? docked
					: clears(dockedOverBar) || !fitsAbove
						? dockedOverBar
						: above
			: fitsAbove || !fitsBelow
				? Math.max(GAP, above)
				: below;
		const centre = rect.left + rect.width / 2;
		const left = Math.min(Math.max(GAP, centre - width / 2), viewportWidth - width - GAP);
		return { top: Math.min(top, viewportHeight - GAP - height), left: Math.max(GAP, left) };
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
	{#if readers > 0}
		<p class="readers" data-testid="popular-readers">
			<Icon name="ink_highlighter" size={16} />{readersLabel(readers)}
		</p>
	{/if}
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
	<IconButton icon="share" label="Share quote" onclick={onshare} />
	{#if oncomment}
		<IconButton icon="add_comment" label="Comment" onclick={oncomment} />
	{/if}
	{#if ondefine}
		<IconButton icon="dictionary" label="Define" onclick={ondefine} />
	{/if}
	{#if onglossary}
		<IconButton icon="menu_book" label="In the glossary" onclick={onglossary} />
	{/if}
	{#if onattach}
		<IconButton icon="add_photo_alternate" label="Attach picture" onclick={onattach} />
	{/if}
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
		/* Its own width, not what's left right of where it's placed: a fixed box shrinks to that,
		   and the toolbar wrapped whenever it moved towards the right edge. */
		width: max-content;
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

	/* A popular highlight's count (P1-COM-04): a line of its own above the buttons. */
	.readers {
		display: flex;
		flex-basis: 100%;
		justify-content: center;
		align-items: center;
		gap: var(--space-1);
		margin: var(--space-1) 0 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
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

	/* Phones: one row of 40 px buttons (each still a 48 px touch area, overlapping its neighbours'
	   padding, as the icon buttons do), so it fits below the selection more often. */
	@media (max-width: 420px) {
		.toolbar {
			gap: 0;
			padding: var(--space-1);
		}

		.swatches {
			gap: 0;
		}

		.swatch {
			width: 40px;
		}

		.swatch::before {
			inset: 12px 8px;
		}

		.swatch[aria-pressed='true']::before {
			inset: 10px 6px;
		}

		.divider {
			display: none;
		}
	}
</style>
