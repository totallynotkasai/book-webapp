<script lang="ts">
	import { IconButton, Overlay } from '@book/ui';
	import IllustrationImage from './IllustrationImage.svelte';
	import type { BookIllustrations, Current } from './illustrations.svelte';

	/**
	 * The lightbox (§8.2): an Illustration full screen, the largest image, with pinch, wheel and
	 * button zoom, dragging to pan when zoomed, and its caption and credit.
	 */
	interface Props {
		open: boolean;
		current: Current | null;
		illustrations: BookIllustrations;
	}

	let { open = $bindable(), current, illustrations }: Props = $props();

	const MAX = 5;
	let scale = $state(1);
	let x = $state(0);
	let y = $state(0);
	/** Pointers down on the picture, by id (not reactive: only gestures read them). */
	const pointers: Record<number, { x: number; y: number }> = {};
	const down = () => Object.values(pointers);
	let pinch: { distance: number; scale: number } | null = null;

	$effect(() => {
		if (open) {
			scale = 1;
			x = 0;
			y = 0;
		}
	});

	function zoom(to: number) {
		scale = Math.min(MAX, Math.max(1, to));
		if (scale === 1) x = y = 0;
	}

	function onpointerdown(event: PointerEvent) {
		pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		if (down().length === 2) {
			const [a, b] = down();
			pinch = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale };
		}
	}

	function onpointermove(event: PointerEvent) {
		const last = pointers[event.pointerId];
		if (!last) return;
		pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
		if (pinch && down().length === 2) {
			const [a, b] = down();
			zoom((pinch.scale * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / pinch.distance);
		} else if (scale > 1) {
			x += event.clientX - last.x;
			y += event.clientY - last.y;
		}
	}

	function onpointerup(event: PointerEvent) {
		delete pointers[event.pointerId];
		if (down().length < 2) pinch = null;
	}
</script>

<Overlay
	bind:open
	label={current ? `Zoomed picture: ${current.illustration.alt}` : 'Picture'}
	variant="fullscreen"
>
	{#if current}
		<div class="lightbox" data-testid="lightbox">
			<div class="tools">
				<IconButton
					icon="zoom_out"
					label="Zoom out"
					disabled={scale <= 1}
					onclick={() => zoom(scale / 1.5)}
				/>
				<IconButton
					icon="zoom_in"
					label="Zoom in"
					disabled={scale >= MAX}
					onclick={() => zoom(scale * 1.5)}
				/>
				<IconButton icon="close" label="Close" onclick={() => (open = false)} />
			</div>
			<div
				class="stage"
				class:zoomed={scale > 1}
				role="img"
				aria-label={current.illustration.alt}
				data-testid="lightbox-stage"
				data-scale={scale.toFixed(2)}
				{onpointerdown}
				{onpointermove}
				{onpointerup}
				onpointercancel={onpointerup}
				ondblclick={() => zoom(scale > 1 ? 1 : 2.5)}
				onwheel={(event) => {
					event.preventDefault();
					zoom(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
				}}
			>
				<div class="image" style:transform={`translate(${x}px, ${y}px) scale(${scale})`}>
					<IllustrationImage
						{illustrations}
						packId={current.pack.id}
						illustration={current.illustration}
						width={2048}
					/>
				</div>
			</div>
			<div class="info">
				{#if current.illustration.caption}<p class="caption">{current.illustration.caption}</p>{/if}
				<p class="credit">{current.illustration.credit ?? current.pack.credit}</p>
			</div>
		</div>
	{/if}
</Overlay>

<style>
	.lightbox {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-rows: auto 1fr auto;
		padding: calc(var(--safe-top) + var(--space-2)) var(--space-3)
			calc(var(--safe-bottom) + var(--space-3));
	}

	.tools {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-1);
		--md-sys-color-on-surface-variant: #fff;
	}

	.stage {
		display: grid;
		place-items: center;
		min-height: 0;
		overflow: hidden;
		touch-action: none;
		cursor: zoom-in;
	}

	.stage.zoomed {
		cursor: grab;
	}

	.image {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		transform-origin: center;
	}

	.image :global(.frame) {
		max-width: 100%;
		max-height: 100%;
		background-color: #fff !important;
	}

	.info {
		max-width: 48rem;
		margin: 0 auto;
		text-align: center;
	}

	.caption {
		margin: var(--space-2) 0 0;
		font-family: var(--font-literata);
		font-style: italic;
	}

	.credit {
		margin: var(--space-1) 0 0;
		opacity: 0.8;
		font-size: var(--md-sys-typescale-body-small-size);
	}
</style>
