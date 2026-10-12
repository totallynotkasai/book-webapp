<script lang="ts">
	import { IconButton, Overlay } from '@book/ui';
	import IllustrationImage from './IllustrationImage.svelte';
	import type { BookIllustrations, Current } from './illustrations.svelte';

	/**
	 * The pop-up picture (§8.2, plan §6 Phase 1.4 UX notes): the current Illustration over the
	 * book. Closes on a tap outside, the close button, Esc or a swipe down; swipe sideways (or use
	 * the arrows) between packs when several have a picture here. Tap the picture to zoom.
	 */
	interface Props {
		open: boolean;
		currents: Current[];
		/** Which pack's picture is showing. */
		index: number;
		illustrations: BookIllustrations;
		onzoom: (current: Current) => void;
	}

	let {
		open = $bindable(),
		currents,
		index = $bindable(),
		illustrations,
		onzoom
	}: Props = $props();

	const current = $derived(currents[Math.min(index, currents.length - 1)]);
	let start: { x: number; y: number } | null = null;

	function go(by: -1 | 1) {
		if (currents.length < 2) return;
		index = (index + by + currents.length) % currents.length;
	}

	function onpointerdown(event: PointerEvent) {
		start = { x: event.clientX, y: event.clientY };
	}

	function onpointerup(event: PointerEvent) {
		if (!start) return;
		const dx = event.clientX - start.x;
		const dy = event.clientY - start.y;
		start = null;
		if (dy > 80 && Math.abs(dy) > Math.abs(dx)) open = false;
		else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
	}
</script>

<!-- Arrows move between packs wherever focus is (Safari doesn't focus buttons on click). -->
<svelte:window
	onkeydown={(event) => {
		if (!open) return;
		if (event.key === 'ArrowRight') go(1);
		else if (event.key === 'ArrowLeft') go(-1);
	}}
/>

<Overlay bind:open label={current ? `Picture: ${current.illustration.alt}` : 'Picture'}>
	{#if current}
		<div
			class="card"
			data-testid="illustration-card"
			data-pack={current.pack.id}
			data-start={current.illustration.anchor.startOrdinal}
			role="presentation"
			{onpointerdown}
			{onpointerup}
		>
			<header>
				<div class="pack">
					<span class="name">{current.pack.name}</span>
					{#if currents.length > 1}
						<span class="count">{index + 1} of {currents.length} packs</span>
					{/if}
				</div>
				{#if currents.length > 1}
					<IconButton icon="chevron_left" label="Previous pack" onclick={() => go(-1)} />
					<IconButton icon="chevron_right" label="Next pack" onclick={() => go(1)} />
				{/if}
				<IconButton icon="close" label="Close picture" onclick={() => (open = false)} />
			</header>
			<button
				type="button"
				class="picture"
				aria-label={`Zoom: ${current.illustration.alt}`}
				onclick={() => onzoom(current)}
			>
				{#key `${current.pack.id}/${current.illustration.id}`}
					<IllustrationImage
						{illustrations}
						packId={current.pack.id}
						illustration={current.illustration}
						width={600}
					/>
				{/key}
			</button>
			{#if current.illustration.caption}
				<p class="caption">{current.illustration.caption}</p>
			{/if}
			<p class="credit">{current.illustration.credit ?? current.pack.credit}</p>
		</div>
	{/if}
</Overlay>

<style>
	.card {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4) var(--space-4);
		touch-action: pan-y;
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.pack {
		display: grid;
		flex: 1;
		min-width: 0;
	}

	.name {
		overflow: hidden;
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.count {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-label-medium-size);
	}

	.picture {
		display: grid;
		place-items: center;
		max-height: min(60dvh, 640px);
		padding: 0;
		border: none;
		border-radius: var(--md-sys-shape-corner-medium);
		background: #fff;
		cursor: zoom-in;
	}

	.picture :global(.frame) {
		max-height: min(60dvh, 640px);
	}

	.picture:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 2px;
	}

	.caption {
		margin: 0;
		font-family: var(--font-literata);
		font-style: italic;
	}

	.credit {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}
</style>
