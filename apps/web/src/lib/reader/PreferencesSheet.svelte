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
		/**
		 * Other readers' comments and popular highlights (P1-COM-03, P1-COM-04), for a catalogue
		 * Book: switched on for this Book only (D-044). Absent for the reader's own imports.
		 */
		together?: {
			/** The author lets readers comment; undefined until known. */
			commentsAllowed: boolean | undefined;
			/** The fewest readers a popular highlight needs, once known. */
			minReaders: number | undefined;
		};
		ontogether?: (changes: { comments?: boolean; popularHighlights?: boolean }) => void;
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
		readingColours,
		together,
		ontogether
	}: Props = $props();

	let tab = $state<'text' | 'page' | 'theme' | 'readers'>('text');
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
			{ value: 'theme', label: 'Theme' },
			...(together ? [{ value: 'readers' as const, label: 'Readers' }] : [])
		]}
	>
		{#snippet panel(value)}
			<div class="panel">
				{#if value === 'readers' && together}
					<!-- Other readers, quiet by default (P1-COM-03, P1-COM-04, D-044). -->
					<div class="readers">
						<p class="hint">For this book only. Both stay off until you turn them on.</p>
						<Switch
							label="Readers’ comments"
							description={together.commentsAllowed === false
								? 'The author has turned comments off for this book.'
								: 'A count beside each paragraph other readers have commented on. Tap it to read, reply or add your own.'}
							checked={prefs.comments && together.commentsAllowed !== false}
							disabled={together.commentsAllowed === false}
							onchange={(comments) => ontogether?.({ comments })}
						/>
						<Switch
							label="Popular highlights"
							description={`A faint dotted line under passages ${together.minReaders ? `at least ${together.minReaders}` : 'many'} readers highlighted. It never says who.`}
							checked={prefs.popularHighlights}
							onchange={(popularHighlights) => ontogether?.({ popularHighlights })}
						/>
					</div>
				{:else}
					<ReadingControls
						group={value as 'text' | 'page' | 'theme'}
						{prefs}
						{onchange}
						{windowWidth}
						{reducedMotion}
						{readingColours}
					/>
				{/if}
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

	.readers {
		display: grid;
		gap: var(--space-4);
	}

	.hint {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}
</style>
