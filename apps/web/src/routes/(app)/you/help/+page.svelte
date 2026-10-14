<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button, Icon, type IconName } from '@book/ui';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { flags, profile } from '$lib/flags';
	import ShortcutTable from '$lib/reader/ShortcutTable.svelte';
	import { APP_SHORTCUTS, READER_SHORTCUTS } from '$lib/reader/shortcuts';
	import { welcome } from '$lib/state/welcome.svelte';

	// Help (P1-QA-02, P1-QA-03): how to read, the keyboard map (DESIGN.md §11.7) and what this
	// test version is. Words match the controls' own labels, so screen-reader users can find them.
	const reading: [icon: IconName, title: string, text: string][] = [
		[
			'auto_stories',
			'Turn the page',
			'Tap the left or right side of the page, swipe, or use the arrow keys. Tap the middle to show or hide the reading controls.'
		],
		[
			'format_size',
			'Make the text yours',
			'Reading preferences has the font, text size, spacing, theme and page layout. Your place stays on the same word.'
		],
		[
			'image',
			'Illustrations',
			'When the page has a picture, a button on the page shows it. The Illustrations button at the top changes how pictures appear: pop-up, per page, a wide spread or in the text.'
		],
		[
			'headphones',
			'Narration',
			'Narrated chapters have a Listen to the narration button. Each word is highlighted as it’s read and the pages turn with it. Tap any word to move the narration there. It keeps playing with the screen off.'
		],
		[
			'edit_note',
			'Highlights and notes',
			'Select some words (on a touch screen, press and hold a word first). The toolbar that appears highlights them or adds a note. Contents and notes lists them all.'
		],
		[
			'bookmark',
			'Bookmarks',
			'Bookmark this page, at the top, places a ribbon on the page. Contents and notes lists your bookmarks too.'
		]
	];
</script>

<svelte:head><title>Help · Book Reader</title></svelte:head>

<div class="help">
	<PageHeader title="Help" back={{ href: resolve('/you'), label: 'Back to You' }} />

	<section aria-labelledby="reading-heading">
		<h2 id="reading-heading">Reading</h2>
		<ul class="topics">
			{#each reading as [icon, title, text] (title)}
				<li>
					<Icon name={icon} />
					<div>
						<h3>{title}</h3>
						<p>{text}</p>
					</div>
				</li>
			{/each}
		</ul>
	</section>

	<section aria-labelledby="keyboard-heading">
		<h2 id="keyboard-heading">Keyboard shortcuts</h2>
		<p class="hint">
			Everything works from the keyboard. In a book, press <kbd>?</kbd> to see the reader’s shortcuts.
		</p>
		<div class="tables">
			<ShortcutTable caption="In a book" shortcuts={READER_SHORTCUTS} />
			<ShortcutTable caption="Everywhere" shortcuts={APP_SHORTCUTS} />
		</div>
	</section>

	<section aria-labelledby="about-heading">
		<h2 id="about-heading">About this version</h2>
		<p>
			This is an early test version. Your books, notes and settings stay on this device and aren’t
			sent anywhere. Export them from <a href={resolve('/you/data')}>Your data</a> to keep a copy.
		</p>
		{#if flags.store || flags.studio}
			<p>
				The store and Creator Studio are pretend: no money changes hands, and nothing you publish
				leaves this device.
			</p>
		{/if}
		<p class="hint" data-testid="build-info">
			{profile === 'tester' ? 'Tester build' : 'Owner build'}{import.meta.env.VITE_BUILD_ID
				? ` · ${import.meta.env.VITE_BUILD_ID}`
				: ''}
		</p>
		<Button variant="tonal" icon="info" onclick={() => welcome.show()}
			>Show the welcome again</Button
		>
	</section>
</div>

<style>
	.help {
		display: grid;
		gap: var(--space-6);
		max-width: 48rem;
	}

	h2 {
		margin: 0 0 var(--space-3);
		font-family: var(--font-display);
		font-size: var(--md-sys-typescale-title-large-size);
		font-weight: var(--md-sys-typescale-weight-regular);
	}

	h3 {
		margin: 0 0 var(--space-1);
		font-size: var(--md-sys-typescale-title-medium-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	p {
		margin: 0 0 var(--space-3);
	}

	.topics {
		display: grid;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.topics li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-3);
	}

	.topics li > :global(svg) {
		color: var(--md-sys-color-primary);
	}

	.topics p {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.tables {
		display: grid;
		gap: var(--space-5);
	}

	.hint {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-medium-size);
	}

	kbd {
		font-family: inherit;
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	a {
		color: var(--md-sys-color-primary);
	}
</style>
