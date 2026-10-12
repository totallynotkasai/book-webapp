<script lang="ts">
	// SPIKE P0-10: Button, Slider, Bottom sheet and Menu from m3-svelte, themed only through
	// m3-theme.css. Everything marked GLUE is behaviour we had to add ourselves (counted in ADR-005).
	import { BottomSheet, Button, Menu, MenuItem, Slider } from 'm3-svelte';
	import { tick } from 'svelte';
	import './m3-theme.css';

	let value = $state(40);
	let sheetOpen = $state(false);
	let menuOpen = $state(false);
	let lastAction = $state('None yet');

	let sheetTrigger: HTMLElement | undefined = $state();
	let menuTrigger: HTMLElement | undefined = $state();
	let menuRoot: HTMLElement | undefined = $state();

	let section: HTMLElement | undefined = $state();

	// GLUE: m3-svelte's sheet stays modal (the page is inert) through its 300 ms outro and is then
	// removed without dialog.close(), so the browser never returns focus to the trigger. Wait for
	// it to go, then put focus back ourselves.
	async function closeSheet() {
		sheetOpen = false;
		while (section?.querySelector('dialog')) await new Promise(requestAnimationFrame);
		focusButtonIn(sheetTrigger);
	}

	// GLUE: Button can't be bound (no ref prop), so we keep a wrapper and focus the button inside.
	const focusButtonIn = (wrapper: HTMLElement | undefined) =>
		wrapper?.querySelector('button')?.focus();

	// GLUE: m3-svelte's Menu is only a styled surface: no trigger, positioning, focus handling
	// or keyboard support. This is the minimum for a keyboard-operable disclosure menu.
	const items = () => [...(menuRoot?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
	async function openMenu() {
		menuOpen = true;
		await tick();
		items()[0]?.focus();
	}
	function closeMenu(returnFocus = true) {
		menuOpen = false;
		if (returnFocus) focusButtonIn(menuTrigger);
	}
	function choose(action: string) {
		lastAction = action;
		closeMenu();
	}
	function onMenuKeydown(event: KeyboardEvent) {
		const list = items();
		const index = list.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'Escape') {
			event.preventDefault();
			closeMenu();
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			list[(index + step + list.length) % list.length]?.focus();
		} else if (event.key === 'Tab') {
			closeMenu(false);
		}
	}
	function onWindowPointerDown(event: PointerEvent) {
		const target = event.target as Node;
		if (menuOpen && !menuRoot?.contains(target) && !menuTrigger?.contains(target)) {
			closeMenu(false);
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<section class="set" aria-labelledby="m3-heading" data-testid="set-m3" bind:this={section}>
	<h2 id="m3-heading">m3-svelte</h2>

	<h3>Button</h3>
	<div class="row">
		<Button variant="filled" onclick={() => (lastAction = 'Filled')}>Filled</Button>
		<Button variant="tonal" onclick={() => (lastAction = 'Tonal')}>Tonal</Button>
		<Button variant="outlined" onclick={() => (lastAction = 'Outlined')}>Outlined</Button>
		<Button variant="text" onclick={() => (lastAction = 'Text')}>Text</Button>
	</div>

	<h3>Slider</h3>
	<Slider bind:value min={0} max={100} step={1} aria-label="Text size (m3-svelte)" />
	<p class="muted">Value: <span data-testid="m3-slider-value">{value}</span></p>

	<h3>Menu</h3>
	<div class="menu-anchor">
		<span bind:this={menuTrigger} class="trigger-wrap">
			<Button
				variant="outlined"
				aria-haspopup="true"
				aria-expanded={menuOpen}
				aria-controls="m3-menu"
				onclick={() => (menuOpen ? closeMenu() : openMenu())}>Sort books</Button
			>
		</span>
		{#if menuOpen}
			<!-- GLUE: a wrapper, because Menu takes no attributes (no id, role or handlers). Its
			     keydown handler only moves focus between the item buttons inside it. -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				id="m3-menu"
				class="menu-pop"
				bind:this={menuRoot}
				onkeydown={onMenuKeydown}
				role="group"
				aria-label="Sort books"
			>
				<Menu>
					<MenuItem onclick={() => choose('Title')}>Title</MenuItem>
					<MenuItem onclick={() => choose('Author')}>Author</MenuItem>
					<MenuItem onclick={() => choose('Recently read')}>Recently read</MenuItem>
				</Menu>
			</div>
		{/if}
	</div>

	<h3>Bottom sheet</h3>
	<span bind:this={sheetTrigger} class="trigger-wrap">
		<Button variant="tonal" onclick={() => (sheetOpen = true)}>Reading options</Button>
	</span>
	{#if sheetOpen}
		<BottomSheet close={closeSheet}>
			<div class="sheet-body">
				<h3 id="m3-sheet-title">Reading options</h3>
				<p>Narration and Illustrations for this Book.</p>
				<Button variant="text" onclick={() => (lastAction = 'Narration on')}
					>Turn on narration</Button
				>
				<Button variant="filled" onclick={closeSheet}>Done</Button>
			</div>
		</BottomSheet>
	{/if}

	<p class="muted" aria-live="polite">
		Last action: <span data-testid="m3-last">{lastAction}</span>
	</p>
</section>

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.menu-anchor {
		position: relative;
	}
	.trigger-wrap {
		display: inline-flex;
	}
	.menu-pop {
		position: absolute;
		inset-block-start: calc(100% + var(--space-1));
		inset-inline-start: 0;
		z-index: 10;
	}
	.sheet-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-block-end: var(--space-5);
	}
</style>
