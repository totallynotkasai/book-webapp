<script lang="ts">
	import { resolve } from '$app/paths';
	import { contrastLevels, themeModes, type ContrastLevel, type ThemeMode } from '@book/core';
	import { contrastLabels, PLACEHOLDER_SEED, themeModeLabels } from '@book/tokens';
	import { Button, Card, Chip, SegmentedButton } from '@book/ui';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import SeedPicker from '$lib/components/SeedPicker.svelte';
	import { preferences } from '$lib/state/preferences.svelte';

	// P1-UI-03: Settings → Appearance (IMPLEMENTATION-PLAN.md §6, Phase 1.1 UX notes). Every change
	// applies to the whole app at once; the preview shows the reading page too, where sepia lives.
	const theme = $derived(preferences.current.theme);

	const modeOptions = themeModes.map((mode) => ({
		value: mode,
		label: themeModeLabels[mode],
		icon: (
			{ system: 'contrast', light: 'light_mode', dark: 'dark_mode', sepia: 'menu_book' } as const
		)[mode]
	}));
	const contrastOptions = contrastLevels.map((level) => ({
		value: level,
		label: contrastLabels[level]
	}));
</script>

<svelte:head><title>Settings · Book Reader</title></svelte:head>

<div class="settings">
	<PageHeader title="Settings" back={{ href: resolve('/you'), label: 'Back to You' }} />

	<section aria-labelledby="appearance-heading">
		<h2 id="appearance-heading">Appearance</h2>
		<div class="appearance">
			<div class="controls">
				<SeedPicker
					value={theme.seedColor}
					onchange={(seedColor) => preferences.update({ theme: { seedColor } })}
				/>
				<div class="field">
					<span class="field-label" id="mode-label">Mode</span>
					<SegmentedButton
						label="Mode"
						options={modeOptions}
						value={theme.mode}
						onchange={(mode: ThemeMode) => preferences.update({ theme: { mode } })}
					/>
					<p class="hint">Sepia tints the reading page; the rest of the app stays light.</p>
				</div>
				<div class="field">
					<span class="field-label">Contrast</span>
					<SegmentedButton
						label="Contrast"
						options={contrastOptions}
						value={theme.contrast}
						onchange={(contrast: ContrastLevel) => preferences.update({ theme: { contrast } })}
					/>
				</div>
				<Button
					variant="text"
					icon="undo"
					onclick={() =>
						preferences.update({
							theme: {
								seedColor: PLACEHOLDER_SEED.toLowerCase(),
								mode: 'system',
								contrast: 'standard'
							}
						})}>Reset appearance</Button
				>
			</div>

			<div class="preview" aria-label="Preview" role="group">
				<Card variant="outlined">
					<div class="preview-app">
						<p class="preview-title">The app</p>
						<div class="preview-row">
							<Button tabindex={-1}>Add to library</Button>
							<Button variant="tonal" tabindex={-1}>Read sample</Button>
						</div>
						<div class="preview-row">
							<Chip label="Illustrations" kind="filter" selected />
							<Chip label="Narration" kind="filter" />
						</div>
					</div>
				</Card>
				<div class="preview-reading" data-testid="reading-preview">
					<p class="preview-title">The reading page</p>
					<p>
						Alice was beginning to get very tired of sitting by her sister on the bank, and of
						having nothing to do: once or twice she had peeped into the book her sister was reading,
						but it had no pictures or conversations in it.
					</p>
					<p class="highlights" aria-label="Highlight colours">
						{#each [1, 2, 3, 4, 5] as n (n)}
							<mark style:background={`var(--md-sys-color-highlight-${n})`}>highlight</mark>
						{/each}
					</p>
				</div>
			</div>
		</div>
	</section>

	<section aria-labelledby="reading-heading">
		<h2 id="reading-heading">Reading defaults</h2>
		<p class="hint">
			Fonts, text size, spacing and layout are set from the Aa menu in any book, for all books or
			just that one. They arrive with the reader in phase 1.2.
		</p>
	</section>

	<section aria-labelledby="accessibility-heading">
		<h2 id="accessibility-heading">Accessibility</h2>
		<p class="hint">
			Animations follow your device’s “reduce motion” setting, and text follows its text size. High
			contrast is a contrast level above, in light or dark.
		</p>
	</section>
</div>

<style>
	.settings {
		display: grid;
		gap: var(--space-6);
	}

	h2 {
		margin: 0 0 var(--space-4);
		font-family: var(--font-display);
		font-size: var(--md-sys-typescale-title-large-size);
		font-weight: var(--md-sys-typescale-weight-regular);
	}

	.appearance {
		display: grid;
		gap: var(--space-6);
	}

	@media (min-width: 840px) {
		.appearance {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			align-items: start;
		}
	}

	.controls {
		display: grid;
		gap: var(--space-5);
		justify-items: start;
	}

	.field {
		display: grid;
		gap: var(--space-2);
		max-width: 100%;
	}

	.field-label {
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		color: var(--md-sys-color-on-surface-variant);
	}

	.hint {
		margin: 0;
		max-width: 40rem;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-medium-size);
	}

	.preview {
		display: grid;
		gap: var(--space-3);
	}

	.preview-app {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-4);
	}

	.preview-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.preview-title {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-label-medium-size);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.preview-reading {
		padding: var(--space-4) var(--space-5);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--reader-background);
		color: var(--reader-text);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline-variant);
		font-family: var(--font-literata);
		line-height: 1.6;
	}

	.preview-reading .preview-title {
		color: var(--reader-text-muted);
		font-family: var(--font-ui);
	}

	.highlights {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	mark {
		padding: 0 2px;
		color: inherit;
	}
</style>
