<script lang="ts">
	import type { CustomColours } from '@book/core';
	import {
		contrastGrade,
		contrastRatio,
		customColourSuggestions,
		formatRatio,
		normaliseHex,
		readablePair
	} from '@book/tokens';
	import { Button, Icon, TextField } from '@book/ui';

	/**
	 * Custom page and text colours (P1-UI-04, plan §6 Phase 1.17 UX notes): two colour pickers, a
	 * sample in the chosen colours and their contrast ratio. A pair that meets WCAG AA is saved as
	 * it's picked, so the page changes live; one below AA shows in the sample only, with a
	 * warning, until the reader takes the nearest readable colour or keeps theirs on purpose
	 * (D-041). The page never changes to a failing pair without that choice.
	 */
	interface Props {
		/** The saved pair, if the reader has one. */
		value: CustomColours | undefined;
		/** Where a new pair starts: the reading page's current colours. */
		fallback: CustomColours;
		onchange: (pair: CustomColours) => void;
	}

	let { value, fallback, onchange }: Props = $props();

	/** What the pickers and the sample show: the saved pair, until the reader changes it. */
	let draft = $derived<CustomColours>(value ?? fallback);
	/** The colour "Use nearest readable colour" changes: the one the reader changed last. */
	let changed = $state<keyof CustomColours>('text');
	let pageTyped = $derived(draft.page);
	let textTyped = $derived(draft.text);
	let pageError = $state<string>();
	let textError = $state<string>();

	const ratio = $derived(contrastRatio(draft.text, draft.page));
	const grade = $derived(contrastGrade(ratio));
	const saved = $derived(value?.page === draft.page && value?.text === draft.text);

	function set(which: keyof CustomColours, colour: string) {
		changed = which;
		draft = { ...draft, [which]: colour };
		if (contrastGrade(contrastRatio(draft.text, draft.page)) !== 'fail') onchange(draft);
	}

	function commitTyped(which: keyof CustomColours) {
		const hex = normaliseHex(which === 'page' ? pageTyped : textTyped);
		const error = hex ? undefined : 'Enter a colour like #1f3d2b.';
		if (which === 'page') pageError = error;
		else textError = error;
		if (hex && hex !== draft[which]) set(which, hex);
	}

	function useNearest() {
		draft = readablePair(draft, changed);
		onchange(draft);
	}

	const labels = { page: 'Page colour', text: 'Text colour' } as const;
</script>

{#snippet picker(which: keyof CustomColours)}
	<label class="swatch" style:--swatch={draft[which]}>
		<span class="visually-hidden">Choose the {labels[which].toLowerCase()}</span>
		<input
			type="color"
			value={draft[which]}
			oninput={(e) => set(which, e.currentTarget.value.toLowerCase())}
		/>
	</label>
{/snippet}

<fieldset class="custom-colours" data-testid="custom-colours">
	<legend>Your colours</legend>

	<div class="fields">
		<TextField
			label={labels.page}
			bind:value={pageTyped}
			error={pageError}
			spellcheck={false}
			autocomplete="off"
			onkeydown={(e) => {
				if (e.key === 'Enter') commitTyped('page');
			}}
			onblur={() => commitTyped('page')}
		>
			{#snippet trailing()}{@render picker('page')}{/snippet}
		</TextField>
		<TextField
			label={labels.text}
			bind:value={textTyped}
			error={textError}
			spellcheck={false}
			autocomplete="off"
			onkeydown={(e) => {
				if (e.key === 'Enter') commitTyped('text');
			}}
			onblur={() => commitTyped('text')}
		>
			{#snippet trailing()}{@render picker('text')}{/snippet}
		</TextField>
	</div>

	<!-- A picture of the chosen colours, which may be below AA on purpose; the ratio says it in words. -->
	<div
		class="sample"
		aria-hidden="true"
		style:background={draft.page}
		style:color={draft.text}
		data-testid="custom-colours-sample"
	>
		<p>
			Alice was beginning to get very tired of sitting by her sister on the bank, and of having
			nothing to do.
		</p>
	</div>

	<div class={['check', grade]}>
		<Icon name={grade === 'fail' ? 'warning' : 'check'} size={20} />
		<p>
			<span>Contrast {formatRatio(ratio)}</span>
			<!-- Only the verdict is live: the ratio changes on every step of a colour picker. -->
			<span aria-live="polite" data-testid="contrast-grade"
				>{grade === 'aaa'
					? 'Meets AAA, the highest level'
					: grade === 'aa'
						? 'Meets AA, readable for most people'
						: 'Below AA'}</span
			>
		</p>
	</div>

	{#if grade === 'fail'}
		<div class="warning" role="group" aria-label="Contrast warning">
			<p>
				{#if saved}
					You kept these colours. Text this faint is hard for many people to read: AA needs 4.5:1.
				{:else}
					Text this faint is hard for many people to read: AA needs 4.5:1. Your page keeps its
					colours until you choose.
				{/if}
			</p>
			<div class="actions">
				<Button variant="filled" onclick={useNearest}>Use nearest readable colour</Button>
				{#if !saved}
					<Button variant="text" onclick={() => onchange(draft)}>Keep these colours</Button>
				{/if}
			</div>
		</div>
	{/if}

	<div class="suggestions">
		<span class="suggestions-label" id="custom-suggestions">Try</span>
		<div class="suggestion-list" role="group" aria-labelledby="custom-suggestions">
			{#each customColourSuggestions as s (s.id)}
				<button
					type="button"
					class="suggestion"
					style:background={s.page}
					style:color={s.text}
					aria-label={s.label}
					title={s.label}
					aria-pressed={draft.page === s.page && draft.text === s.text}
					onclick={() => {
						changed = 'text';
						draft = { page: s.page, text: s.text };
						onchange(draft);
					}}>Aa</button
				>
			{/each}
		</div>
	</div>
</fieldset>

<style>
	.custom-colours {
		display: grid;
		gap: var(--space-3);
		min-width: 0;
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		margin-bottom: var(--space-2);
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		color: var(--md-sys-color-on-surface-variant);
	}

	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
		gap: var(--space-3);
	}

	.swatch {
		position: relative;
		display: grid;
		place-items: center;
		width: var(--touch-target);
		height: var(--touch-target);
		margin-inline-end: calc(-1 * var(--space-2));
		cursor: pointer;
	}

	.swatch::before {
		content: '';
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--swatch);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline);
	}

	.swatch input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		border: none;
		opacity: 0;
		cursor: pointer;
	}

	.swatch:has(input:focus-visible)::before {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 3px;
	}

	.sample {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline-variant);
		font-family: var(--reader-font, var(--font-literata));
		font-size: 1.05rem;
		line-height: 1.5;
	}

	.sample p {
		margin: 0;
	}

	.check {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		color: var(--md-sys-color-on-surface);
	}

	.check p {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-2);
		margin: 0;
	}

	.check span:first-child {
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.check.fail {
		color: var(--md-sys-color-error);
	}

	.warning {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-error-container);
		color: var(--md-sys-color-on-error-container);
	}

	.warning p {
		margin: 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.suggestions {
		display: grid;
		gap: var(--space-2);
	}

	.suggestions-label {
		font-size: var(--md-sys-typescale-body-medium-size);
		color: var(--md-sys-color-on-surface-variant);
	}

	.suggestion-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.suggestion {
		min-width: var(--touch-target);
		min-height: var(--touch-target);
		padding: 0 var(--space-3);
		border: none;
		border-radius: var(--md-sys-shape-corner-small);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline);
		font-family: var(--font-literata);
		font-size: 1.1rem;
		cursor: pointer;
	}

	.suggestion[aria-pressed='true'] {
		box-shadow:
			0 0 0 2px var(--md-sys-color-surface),
			0 0 0 4px var(--md-sys-color-on-surface);
	}

	.suggestion:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 4px;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
