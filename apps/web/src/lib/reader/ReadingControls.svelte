<script lang="ts">
	import {
		clampFontScale,
		contrastLevels,
		fontIds,
		FONT_SCALE,
		LINE_HEIGHT,
		PARAGRAPH_SPACING,
		themeModes,
		type CustomColours,
		type ReaderPreferences,
		type ReaderPreferencesPatch
	} from '@book/core';
	import { contrastLabels, fontLabels, fontStacks, themeModeLabels } from '@book/tokens';
	import { SegmentedButton, Slider, Switch } from '@book/ui';
	import SeedPicker from '$lib/components/SeedPicker.svelte';
	import { SPREAD_MIN_WIDTH } from './settings';

	/**
	 * One group of Reader Preferences controls (§9.4), shared by the reader's preferences sheet
	 * (P1-RDR-04) and Settings → Reading defaults, so both always offer the same choices.
	 */
	interface Props {
		group: 'text' | 'page' | 'theme';
		prefs: ReaderPreferences;
		onchange: (changes: ReaderPreferencesPatch) => void;
		windowWidth: number;
		reducedMotion: boolean;
		/** The reading page's colours now: where custom colours start (P1-UI-04). */
		readingColours?: CustomColours;
	}

	let { group, prefs, onchange, windowWidth, reducedMotion, readingColours }: Props = $props();

	const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<div class="controls">
	{#if group === 'text'}
		<fieldset class="fonts">
			<legend>Font</legend>
			{#each fontIds as id (id)}
				<label class="font" style:font-family={fontStacks[id] ?? 'inherit'}>
					<input
						type="radio"
						name="reader-font"
						value={id}
						checked={prefs.fontFamily === id}
						onchange={() => onchange({ fontFamily: id })}
					/>
					<!-- Wide faces may wrap where the name changes case (Open|Dyslexic). -->
					<span
						>{#each fontLabels[id].split(/(?<=[a-z])(?=[A-Z])/) as part, i (i)}{#if i}<wbr
								/>{/if}{part}{/each}</span
					>
				</label>
			{/each}
		</fieldset>
		<Slider
			label="Text size"
			value={prefs.fontScale}
			min={FONT_SCALE.min}
			max={FONT_SCALE.max}
			step={FONT_SCALE.step}
			format={pct}
			onchange={(v) => onchange({ fontScale: clampFontScale(v) })}
		/>
		<Slider
			label="Line spacing"
			value={prefs.lineHeight}
			min={LINE_HEIGHT.min}
			max={LINE_HEIGHT.max}
			step={0.1}
			format={(v) => v.toFixed(1)}
			onchange={(v) => onchange({ lineHeight: Number(v.toFixed(1)) })}
		/>
		<Slider
			label="Paragraph spacing"
			value={prefs.paragraphSpacing}
			min={PARAGRAPH_SPACING.min}
			max={PARAGRAPH_SPACING.max}
			step={0.1}
			format={(v) => `${v.toFixed(1)} em`}
			onchange={(v) => onchange({ paragraphSpacing: Number(v.toFixed(1)) })}
		/>
		<Switch
			label="Justify"
			description="Straight right edges"
			checked={prefs.justify}
			onchange={(justify) => onchange({ justify })}
		/>
		<Switch
			label="Hyphenation"
			checked={prefs.hyphenate}
			onchange={(hyphenate) => onchange({ hyphenate })}
		/>
	{:else if group === 'page'}
		<div class="field">
			<span class="field-label">Layout</span>
			<SegmentedButton
				label="Layout"
				value={prefs.layout}
				onchange={(layout) => onchange({ layout })}
				options={[
					{ value: 'auto', label: 'Auto' },
					{ value: 'paginated-single', label: 'Single' },
					{
						value: 'paginated-spread',
						label: 'Spread',
						disabled: windowWidth < SPREAD_MIN_WIDTH
					},
					{ value: 'scroll', label: 'Scroll' }
				]}
			/>
			<p class="hint">
				{windowWidth < SPREAD_MIN_WIDTH
					? 'Two-page spreads need a wider window.'
					: 'Auto shows two pages on wide screens and one otherwise.'}
			</p>
		</div>
		<div class="field">
			<span class="field-label">Margins</span>
			<SegmentedButton
				label="Margins"
				value={prefs.margins}
				onchange={(margins) => onchange({ margins })}
				options={[
					{ value: 'narrow', label: 'Narrow' },
					{ value: 'normal', label: 'Normal' },
					{ value: 'wide', label: 'Wide' }
				]}
			/>
		</div>
		<div class="field">
			<span class="field-label">Page turns</span>
			<SegmentedButton
				label="Page turns"
				value={prefs.pageTurn}
				onchange={(pageTurn) => onchange({ pageTurn })}
				options={[
					{ value: 'none', label: 'None' },
					{ value: 'slide', label: 'Slide' },
					{ value: 'fade', label: 'Fade' }
				]}
			/>
			{#if reducedMotion}
				<p class="hint">Your device asks for reduced motion, so pages turn without animation.</p>
			{/if}
		</div>
		<Switch
			label="Focus mode"
			description="Dims everything but the paragraph you’re reading. → or a tap at the side moves to the next one."
			checked={prefs.focusMode}
			onchange={(focusMode) => onchange({ focusMode })}
		/>
		<Switch
			label="Time left"
			description="How long the rest of the chapter takes at your own pace, beside the page number. It learns your pace on this device; turned off, it stops."
			checked={prefs.timeLeft}
			onchange={(timeLeft) => onchange({ timeLeft })}
		/>
	{:else}
		<div class="field">
			<span class="field-label">Mode</span>
			<SegmentedButton
				label="Mode"
				value={prefs.theme.mode}
				onchange={(mode) =>
					onchange({
						theme:
							// Custom starts from the page as it is, so nothing jumps until a colour changes.
							mode === 'custom' && !prefs.theme.custom && readingColours
								? { mode, custom: readingColours }
								: { mode }
					})}
				options={themeModes.map((mode) => ({ value: mode, label: themeModeLabels[mode] }))}
			/>
			{#if prefs.theme.mode === 'custom'}
				<p class="hint">Your colours are for the reading page; the app keeps its own.</p>
			{/if}
		</div>
		{#if prefs.theme.mode === 'custom' && (prefs.theme.custom ?? readingColours)}
			<!-- Loads on first use, so the reader's route doesn't carry it (DESIGN.md §12.3). -->
			{#await import('$lib/components/CustomColoursPicker.svelte') then { default: CustomColoursPicker }}
				<CustomColoursPicker
					value={prefs.theme.custom}
					fallback={(prefs.theme.custom ?? readingColours)!}
					onchange={(custom) => onchange({ theme: { custom } })}
				/>
			{/await}
		{/if}
		<div class="field">
			<span class="field-label">Contrast</span>
			<SegmentedButton
				label="Contrast"
				value={prefs.theme.contrast}
				onchange={(contrast) => onchange({ theme: { contrast } })}
				options={contrastLevels.map((c) => ({ value: c, label: contrastLabels[c] }))}
			/>
		</div>
		<SeedPicker
			value={prefs.theme.seedColor}
			onchange={(seedColor) => onchange({ theme: { seedColor } })}
		/>
	{/if}
</div>

<style>
	.controls {
		display: grid;
		gap: var(--space-4);
	}

	.fonts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: none;
	}

	legend,
	.field-label {
		margin-bottom: var(--space-2);
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		color: var(--md-sys-color-on-surface-variant);
	}

	.font {
		position: relative;
		display: flex;
		align-items: center;
		min-height: var(--touch-target);
		padding: 0 var(--space-3);
		border-radius: var(--md-sys-shape-corner-small);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline-variant);
		font-size: 1.05rem;
		cursor: pointer;
	}

	.font input {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.font:has(input:checked) {
		background: var(--md-sys-color-secondary-container);
		color: var(--md-sys-color-on-secondary-container);
		box-shadow: inset 0 0 0 2px var(--md-sys-color-secondary);
	}

	.font:has(input:focus-visible) {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 2px;
	}

	.field {
		display: grid;
		gap: var(--space-1);
		justify-items: start;
	}

	.hint {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}
</style>
