<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { fontIds, themeIds } from '@book/core';
	import { fontLabels, readerTokens, themeLabels } from '@book/tokens';
	import { settings } from '$lib/settings.svelte';

	const MIN_SCALE = 0.75;
	const MAX_SCALE = 2;
	const SCALE_STEP = 0.125;

	let showSettings = $state(false);

	const readerStyle = $derived(
		Object.entries(readerTokens(settings.current))
			.map(([name, value]) => `${name}: ${value}`)
			.join('; ')
	);

	function changeScale(delta: number) {
		const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, settings.current.fontScale + delta));
		settings.update({ fontScale: next });
	}
</script>

<div class="reader">
	<header class="toolbar">
		<a href={resolve('/')} aria-label="Back to library">←</a>
		<span class="title">Book: {page.params.bookId}</span>
		<button onclick={() => (showSettings = !showSettings)} aria-expanded={showSettings}>Aa</button>
	</header>

	{#if showSettings}
		<section class="settings" aria-label="Reader settings">
			<label>
				Theme
				<select
					value={settings.current.theme}
					onchange={(e) =>
						settings.update({ theme: e.currentTarget.value as (typeof themeIds)[number] })}
				>
					{#each themeIds as id (id)}<option value={id}>{themeLabels[id]}</option>{/each}
				</select>
			</label>
			<label>
				Font
				<select
					value={settings.current.font}
					onchange={(e) =>
						settings.update({ font: e.currentTarget.value as (typeof fontIds)[number] })}
				>
					{#each fontIds as id (id)}<option value={id}>{fontLabels[id]}</option>{/each}
				</select>
			</label>
			<div class="size">
				Size
				<button onclick={() => changeScale(-SCALE_STEP)} aria-label="Smaller text">A−</button>
				<span>{Math.round(settings.current.fontScale * 100)}%</span>
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
				Every position in the book is stored as a text locator rather than a page number, so
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

	.settings {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border-block: 1px solid var(--color-border);
	}

	.settings label,
	.size {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.settings select,
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
	}

	.page p {
		margin: 0 0 var(--reader-paragraph-spacing);
	}
</style>
