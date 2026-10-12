<script lang="ts">
	// SPIKE P0-10: Button, Slider, Bottom sheet and Menu from Bits UI primitives, styled only
	// with our tokens in bits.css (its size is the "CSS needed" measurement in ADR-005).
	import { Button, Dialog, DropdownMenu, Slider } from 'bits-ui';
	import './bits.css';

	let value = $state(40);
	let sheetOpen = $state(false);
	let lastAction = $state('None yet');

	const variants = ['filled', 'tonal', 'outlined', 'text'] as const;
	const label = (v: string) => v[0].toUpperCase() + v.slice(1);
</script>

<section class="set" aria-labelledby="bits-heading" data-testid="set-bits">
	<h2 id="bits-heading">Bits UI + our tokens</h2>

	<h3>Button</h3>
	<div class="row">
		{#each variants as variant (variant)}
			<Button.Root class="b-button b-{variant}" onclick={() => (lastAction = label(variant))}>
				{label(variant)}
			</Button.Root>
		{/each}
	</div>

	<h3>Slider</h3>
	<Slider.Root type="single" bind:value min={0} max={100} step={1} class="b-slider">
		<span class="b-slider-track"><Slider.Range class="b-slider-range" /></span>
		<Slider.Thumb index={0} class="b-slider-thumb" aria-label="Text size (Bits UI)" />
	</Slider.Root>
	<p class="muted">Value: <span data-testid="bits-slider-value">{value}</span></p>

	<h3>Menu</h3>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger class="b-button b-outlined">Sort books</DropdownMenu.Trigger>
		<DropdownMenu.Portal>
			<DropdownMenu.Content class="b-menu" sideOffset={4} align="start">
				{#each ['Title', 'Author', 'Recently read'] as item (item)}
					<DropdownMenu.Item class="b-menu-item" onSelect={() => (lastAction = item)}>
						{item}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	</DropdownMenu.Root>

	<h3>Bottom sheet</h3>
	<Dialog.Root bind:open={sheetOpen}>
		<Dialog.Trigger class="b-button b-tonal">Reading options</Dialog.Trigger>
		<Dialog.Portal>
			<Dialog.Overlay class="b-scrim" />
			<Dialog.Content class="b-sheet">
				<div class="b-sheet-handle" aria-hidden="true"></div>
				<Dialog.Title class="b-sheet-title">Reading options</Dialog.Title>
				<Dialog.Description>Narration and Illustrations for this Book.</Dialog.Description>
				<Button.Root class="b-button b-text" onclick={() => (lastAction = 'Narration on')}>
					Turn on narration
				</Button.Root>
				<Dialog.Close class="b-button b-filled">Done</Dialog.Close>
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>

	<p class="muted" aria-live="polite">
		Last action: <span data-testid="bits-last">{lastAction}</span>
	</p>
</section>

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
