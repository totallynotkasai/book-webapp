<script lang="ts">
	// SPIKE P0-10 (OPEN-02): the same four components built with m3-svelte and with Bits UI,
	// both following one generated theme. Findings are in docs/adr/ADR-005-components.md.
	import {
		PLACEHOLDER_SEED,
		generateRoleTokens,
		type SpikeContrast,
		type SpikeMode
	} from './theme';

	// Each set is its own chunk, so the build shows what each one adds (ADR-005, bundle size).
	const m3Set = import('./m3/M3Set.svelte');
	const bitsSet = import('./bits/BitsSet.svelte');

	let seed = $state(PLACEHOLDER_SEED);
	let mode = $state<SpikeMode>('light');
	let contrast = $state<SpikeContrast>('standard');

	const tokens = $derived(generateRoleTokens(seed, mode, contrast));

	// Tokens go on <html>, as P1-UI-01 will do, so portalled sheets and menus inherit them.
	$effect(() => {
		const root = document.documentElement;
		for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
		root.style.colorScheme = mode;
		return () => {
			for (const name of Object.keys(tokens)) root.style.removeProperty(name);
			root.style.colorScheme = '';
		};
	});

	const modes: SpikeMode[] = ['light', 'dark'];
	const contrasts: SpikeContrast[] = ['standard', 'medium', 'high'];
	const title = (s: string) => s[0].toUpperCase() + s.slice(1);
</script>

<svelte:head>
	<title>Component spike</title>
</svelte:head>

<div class="spike">
	<header>
		<h1>Component spike</h1>
		<p class="muted">
			P0-10: the same components from m3-svelte and from Bits UI, both themed from one generated M3
			scheme. Throwaway code.
		</p>
	</header>

	<fieldset class="controls">
		<legend>Theme</legend>
		<label class="field">
			<span>Seed colour <span class="muted">(placeholder deep teal, OPEN-07)</span></span>
			<input type="color" bind:value={seed} />
			<code data-testid="seed">{seed}</code>
		</label>
		<div class="field" role="radiogroup" aria-label="Mode">
			<span>Mode</span>
			{#each modes as m (m)}
				<label class="choice"><input type="radio" bind:group={mode} value={m} /> {title(m)}</label>
			{/each}
		</div>
		<div class="field" role="radiogroup" aria-label="Contrast">
			<span>Contrast</span>
			{#each contrasts as c (c)}
				<label class="choice"
					><input type="radio" bind:group={contrast} value={c} /> {title(c)}</label
				>
			{/each}
		</div>
		<p class="muted">
			Primary <code data-testid="token-primary">{tokens['--md-sys-color-primary']}</code> · surface
			<code data-testid="token-surface">{tokens['--md-sys-color-surface']}</code>
		</p>
	</fieldset>

	<div class="sets">
		{#await m3Set then { default: M3Set }}
			<M3Set />
		{/await}
		{#await bitsSet then { default: BitsSet }}
			<BitsSet />
		{/await}
	</div>
</div>

<style>
	.spike {
		min-height: 100dvh;
		padding: calc(var(--space-4) + var(--safe-top)) calc(var(--space-4) + var(--safe-right))
			calc(var(--space-6) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
		background: var(--md-sys-color-surface);
		color: var(--md-sys-color-on-surface);
		font-family: var(--font-ui);
	}
	h1 {
		margin: 0 0 var(--space-2);
	}
	.muted {
		color: var(--md-sys-color-on-surface-variant);
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		align-items: center;
		margin: var(--space-4) 0;
		border: 1px solid var(--md-sys-color-outline-variant);
		border-radius: var(--radius-md);
	}
	.field {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.choice {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch-target);
		gap: var(--space-1);
	}
	input[type='color'] {
		width: var(--touch-target);
		height: var(--touch-target);
	}
	.sets {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
		gap: var(--space-5);
	}
	.sets :global(.set) {
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--md-sys-color-surface-container);
	}
	.sets :global(.set h2) {
		margin-top: 0;
	}
	.sets :global(.set h3) {
		margin: var(--space-5) 0 var(--space-2);
		font-size: 1rem;
	}
	.sets :global(.muted) {
		color: var(--md-sys-color-on-surface-variant);
	}
</style>
