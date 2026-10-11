<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		clampFontScale,
		contrastLevels,
		fontIds,
		themeModes,
		type ContrastLevel,
		type FontId,
		type ThemeMode
	} from '@book/core';
	import { contrastLabels, fontLabels, readerTokens, themeModeLabels } from '@book/tokens';
	import { preferences } from '$lib/preferences.svelte';

	const SCALE_STEP = 0.1;

	let showPreferences = $state(false);

	const readerStyle = $derived(
		Object.entries(readerTokens(preferences.current))
			.map(([name, value]) => `${name}: ${value}`)
			.join('; ')
	);

	function changeScale(delta: number) {
		preferences.update({ fontScale: clampFontScale(preferences.current.fontScale + delta) });
	}
</script>

<div class="reader">
	<header class="toolbar">
		<a href={resolve('/')} aria-label="Back to library">←</a>
		<span class="title">Book: {page.params.bookId}</span>
		<button
			onclick={() => (showPreferences = !showPreferences)}
			aria-expanded={showPreferences}
			aria-label="Reading preferences">Aa</button
		>
	</header>

	{#if showPreferences}
		<section class="preferences" aria-label="Reading preferences">
			<label>
				Theme
				<select
					value={preferences.current.theme.mode}
					onchange={(e) =>
						preferences.update({ theme: { mode: e.currentTarget.value as ThemeMode } })}
				>
					{#each themeModes as id (id)}<option value={id}>{themeModeLabels[id]}</option>{/each}
				</select>
			</label>
			<label>
				Contrast
				<select
					value={preferences.current.theme.contrast}
					onchange={(e) =>
						preferences.update({ theme: { contrast: e.currentTarget.value as ContrastLevel } })}
				>
					{#each contrastLevels as id (id)}<option value={id}>{contrastLabels[id]}</option>{/each}
				</select>
			</label>
			<label>
				Font
				<select
					value={preferences.current.fontFamily}
					onchange={(e) => preferences.update({ fontFamily: e.currentTarget.value as FontId })}
				>
					{#each fontIds as id (id)}<option value={id}>{fontLabels[id]}</option>{/each}
				</select>
			</label>
			<div class="size">
				Size
				<button onclick={() => changeScale(-SCALE_STEP)} aria-label="Smaller text">A−</button>
				<span data-testid="font-scale">{Math.round(preferences.current.fontScale * 100)}%</span>
				<button onclick={() => changeScale(SCALE_STEP)} aria-label="Larger text">A+</button>
			</div>
		</section>
	{/if}

	<div class="body">
		<aside class="illustration" aria-label="Illustration">
			<p>Illustration panel</p>
		</aside>

		<article class="page" style={readerStyle}>
			<p>
				The reader engine (foliate-js) will render the book here. This placeholder text uses the
				reader tokens, so changing the theme, font or size above updates it live.
			</p>
			<p>
				Every position in the book is stored as a word-based Anchor rather than a page number, so
				bookmarks, notes and illustrations stay attached whatever the layout.
			</p>
		</article>
	</div>

	<footer class="toolbar">
		<button aria-label="Previous page" disabled>‹</button>
		<input type="range" min="0" max="100" value="0" aria-label="Position in book" disabled />
		<button aria-label="Next page" disabled>›</button>
	</footer>
</div>

<style>
	.reader {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		color: var(--color-text-muted);
	}

	.toolbar a,
	.toolbar button {
		display: inline-grid;
		place-items: center;
		min-width: var(--touch-target);
		min-height: var(--touch-target);
		border: none;
		border-radius: var(--radius-md);
		background: none;
		text-decoration: none;
		color: inherit;
		cursor: pointer;
	}

	.toolbar button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.title {
		flex: 1;
		text-align: center;
	}

	.toolbar input[type='range'] {
		flex: 1;
	}

	.preferences {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border-block: 1px solid var(--color-border);
	}

	.preferences label,
	.size {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.preferences select,
	.size button {
		min-height: var(--touch-target);
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
	}

	/* Narrow screens: illustration above the book. */
	.body {
		flex: 1;
		display: grid;
		grid-template-rows: minmax(8rem, 30%) 1fr;
		min-height: 0;
	}

	/* Wide screens: illustration beside the book. */
	@media (min-width: 60rem) {
		.body {
			grid-template-rows: none;
			grid-template-columns: minmax(16rem, 1fr) 2fr;
		}
	}

	.illustration {
		display: grid;
		place-items: center;
		margin: var(--space-2);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
		color: var(--color-text-muted);
	}

	.page {
		overflow: auto;
		padding: var(--space-4) var(--reader-margin);
		font-family: var(--reader-font);
		font-size: var(--reader-size);
		line-height: var(--reader-line-height);
		text-align: var(--reader-align);
		hyphens: var(--reader-hyphens);
	}

	.page p {
		margin: 0 0 var(--reader-paragraph-spacing);
	}
</style>
