<script lang="ts">
	import type { CustomColours, ReaderPreferences, ReaderPreferencesPatch } from '@book/core';
	import { AdaptiveSheet, Button, Switch, Tabs } from '@book/ui';
	import ReadingControls from './ReadingControls.svelte';

	/**
	 * Reading preferences (P1-RDR-04, §9.4, plan §6 Phase 1.2 UX notes): a half-height bottom sheet
	 * on compact screens so the text visibly re-flows behind it, a side sheet on wider ones. Every
	 * change applies live. "This book only" turns changes into overrides for the open Book.
	 */
	interface Props {
		open: boolean;
		prefs: ReaderPreferences;
		bookOnly: boolean;
		/** Called with each change; the caller saves it globally or for this Book. */
		onchange: (changes: ReaderPreferencesPatch) => void;
		onbookonly: (on: boolean) => void;
		onreset: () => void;
		windowWidth: number;
		reducedMotion: boolean;
		/** The reading page's colours now: where custom colours start (P1-UI-04). */
		readingColours: CustomColours;
	}

	let {
		open = $bindable(),
		prefs,
		bookOnly,
		onchange,
		onbookonly,
		onreset,
		windowWidth,
		reducedMotion,
		readingColours
	}: Props = $props();

	let tab = $state<'text' | 'page' | 'theme'>('text');
</script>

<AdaptiveSheet bind:open title="Reading preferences" height="half" scrim={false}>
	<div class="scope">
		<Switch
			label="This book only"
			description={bookOnly
				? 'Changes apply to this book.'
				: 'Changes apply to every book without its own settings.'}
			checked={bookOnly}
			onchange={onbookonly}
		/>
		{#if bookOnly}
			<Button variant="text" icon="undo" onclick={onreset}>Reset to my defaults</Button>
		{/if}
	</div>

	<Tabs
		label="Reading preferences"
		bind:value={tab}
		items={[
			{ value: 'text', label: 'Text' },
			{ value: 'page', label: 'Page' },
			{ value: 'theme', label: 'Theme' }
		]}
	>
		{#snippet panel(value)}
			<div class="panel">
				<ReadingControls
					group={value as 'text' | 'page' | 'theme'}
					{prefs}
					{onchange}
					{windowWidth}
					{reducedMotion}
					{readingColours}
				/>
			</div>
		{/snippet}
	</Tabs>
</AdaptiveSheet>

<style>
	.scope {
		display: grid;
		gap: var(--space-1);
		margin-bottom: var(--space-3);
		justify-items: start;
	}

	.scope :global(.switch-field) {
		width: 100%;
	}

	.panel {
		padding-top: var(--space-4);
	}
</style>
