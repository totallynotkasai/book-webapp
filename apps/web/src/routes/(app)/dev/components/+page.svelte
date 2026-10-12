<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		AdaptiveSheet,
		Badge,
		BottomSheet,
		Button,
		Card,
		Checkbox,
		Chip,
		Dialog,
		Icon,
		IconButton,
		Menu,
		Progress,
		RadioGroup,
		SegmentedButton,
		SideSheet,
		Skeleton,
		Slider,
		Switch,
		Tabs,
		TextField,
		Tooltip
	} from '@book/ui';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';

	// Every @book/ui component in the current theme (owner builds only). Also where Playwright
	// checks what jsdom can't: focus trapping, floating menus and tooltips (e2e/components.spec.ts).
	let size = $state(100);
	let narration = $state(true);
	let hideAi = $state(false);
	let layout = $state<'single' | 'spread' | 'scroll'>('single');
	let granularity = $state<'word' | 'sentence'>('word');
	let note = $state('');
	let tab = $state<'notes' | 'bookmarks'>('notes');
	let dialogOpen = $state(false);
	let bottomOpen = $state(false);
	let sideOpen = $state(false);
	let adaptiveOpen = $state(false);
	let bookmarked = $state(false);
	let lastAction = $state('None yet');
</script>

<svelte:head><title>Component gallery · Book Reader</title></svelte:head>

<div class="gallery">
	<PageHeader
		title="Component gallery"
		subtitle="Every @book/ui component, in your current theme."
		back={{ href: resolve('/dev'), label: 'Back to the developer panel' }}
	/>
	<p class="muted" aria-live="polite">
		Last action: <span data-testid="last-action">{lastAction}</span>
	</p>

	<section>
		<h2>Buttons</h2>
		<div class="row">
			<Button onclick={() => (lastAction = 'Filled')}>Filled</Button>
			<Button variant="tonal" icon="add">Tonal</Button>
			<Button variant="outlined">Outlined</Button>
			<Button variant="text">Text</Button>
			<Button variant="elevated">Elevated</Button>
			<Button pending>Pending</Button>
			<Button danger>Delete</Button>
			<Button disabled>Disabled</Button>
		</div>
		<div class="row">
			<IconButton icon="toc" label="Contents" />
			<IconButton
				icon="bookmark"
				selectedIcon="bookmark-fill"
				label="Bookmark this page"
				selected={bookmarked}
				onclick={() => (bookmarked = !bookmarked)}
			/>
			<IconButton icon="image" label="Illustrations" variant="tonal" dot />
			<IconButton icon="play_arrow" label="Play narration" variant="filled" />
			<IconButton icon="more_vert" label="Outlined" variant="outlined" />
			<Tooltip text="Table of contents">
				{#snippet children(props)}
					<IconButton {...props} icon="toc" label="Contents with tooltip" />
				{/snippet}
			</Tooltip>
			<Menu
				label="More actions"
				items={[
					{ label: 'Copy', icon: 'content_copy', onselect: () => (lastAction = 'Copy') },
					{ label: 'Add note', icon: 'sticky_note_2', onselect: () => (lastAction = 'Add note') },
					'separator',
					{
						label: 'Remove highlight',
						icon: 'delete',
						danger: true,
						onselect: () => (lastAction = 'Remove highlight')
					}
				]}
			/>
		</div>
	</section>

	<section>
		<h2>Inputs</h2>
		<div class="grid">
			<Slider
				label="Text size"
				bind:value={size}
				min={75}
				max={250}
				step={5}
				format={(v) => `${v}%`}
			/>
			<Switch
				label="Auto page-turn"
				description="Turn pages with the narration"
				bind:checked={narration}
			/>
			<Checkbox label="Hide AI-generated content" bind:checked={hideAi} />
			<SegmentedButton
				label="Layout"
				bind:value={layout}
				options={[
					{ value: 'single', label: 'Single' },
					{ value: 'spread', label: 'Spread' },
					{ value: 'scroll', label: 'Scroll' }
				]}
			/>
			<RadioGroup
				label="Highlight"
				bind:value={granularity}
				options={[
					{ value: 'word', label: 'Word by word' },
					{ value: 'sentence', label: 'Sentence', description: 'Calmer to follow' }
				]}
			/>
			<TextField
				label="Note"
				bind:value={note}
				supportingText="Only you can see your notes."
				multiline
			/>
			<TextField label="Price" value="-1" error="Enter a price of 0 or more." />
		</div>
	</section>

	<section>
		<h2>Overlays</h2>
		<div class="row">
			<Button variant="tonal" onclick={() => (dialogOpen = true)}>Open dialog</Button>
			<Button variant="tonal" onclick={() => (bottomOpen = true)}>Open bottom sheet</Button>
			<Button variant="tonal" onclick={() => (sideOpen = true)}>Open side sheet</Button>
			<Button variant="tonal" onclick={() => (adaptiveOpen = true)}>Open adaptive sheet</Button>
			<Button
				variant="outlined"
				onclick={() =>
					snackbars.show('Added to library', {
						action: { label: 'Undo', run: () => (lastAction = 'Undo') }
					})}>Show snackbar</Button
			>
			<Button
				variant="outlined"
				onclick={() =>
					snackbars.show('You’re offline. Check your connection and try again.', { tone: 'error' })}
				>Show error snackbar</Button
			>
		</div>
	</section>

	<section>
		<h2>Display</h2>
		<div class="row">
			<Badge>Neutral</Badge>
			<Badge tone="primary" icon="verified">Official</Badge>
			<Badge tone="tertiary" icon="wand_stars">AI-generated</Badge>
			<Badge tone="error">Report</Badge>
			<Badge tone="simulated" icon="science">Simulated</Badge>
		</div>
		<div class="row">
			<Chip label="Yellow" kind="filter" selected swatch="var(--md-sys-color-highlight-1)" />
			<Chip label="Green" kind="filter" swatch="var(--md-sys-color-highlight-2)" />
			<Chip label="Fantasy" kind="input" onremove={() => (lastAction = 'Removed chip')} />
			<Chip label="Read sample" icon="menu_book" />
		</div>
		<div class="cards">
			<Card variant="elevated"><p class="card-body">Elevated card</p></Card>
			<Card variant="filled"><p class="card-body">Filled card</p></Card>
			<Card variant="outlined" href={resolve('/store')}><p class="card-body">Link card</p></Card>
		</div>
		<div class="row progress">
			<Progress label="Importing" value={0.4} />
			<Progress label="Loading" />
			<Progress label="Working" kind="circular" />
			<Progress label="Uploaded" kind="circular" value={0.75} />
		</div>
		<div class="skeletons">
			<Skeleton width="60%" />
			<Skeleton width="40%" />
			<Skeleton shape="circle" width="40px" height="40px" />
		</div>
		<Tabs
			label="Notes panel"
			bind:value={tab}
			items={[
				{ value: 'notes', label: 'Notes and highlights', count: 3 },
				{ value: 'bookmarks', label: 'Bookmarks', count: 1 }
			]}
		>
			{#snippet panel(value)}
				<p class="card-body">{value === 'notes' ? 'Three notes' : 'One bookmark'}</p>
			{/snippet}
		</Tabs>
		<p class="row">
			<Icon name="auto_stories" /><Icon name="headphones" /><Icon name="photo_library" /><Icon
				name="verified"
				label="Official"
			/>
		</p>
	</section>
</div>

<Dialog
	bind:open={dialogOpen}
	title="Delete this note?"
	description="This can’t be undone."
	onclose={() => (lastAction = 'Dialog closed')}
>
	{#snippet actions()}
		<Button variant="text" onclick={() => (dialogOpen = false)}>Cancel</Button>
		<Button
			danger
			onclick={() => {
				lastAction = 'Deleted';
				dialogOpen = false;
			}}>Delete</Button
		>
	{/snippet}
</Dialog>

<BottomSheet bind:open={bottomOpen} title="Contents" height="half">
	<p>Chapter I. Down the Rabbit-Hole</p>
	<Button variant="text" onclick={() => (bottomOpen = false)}>Chapter II. The Pool of Tears</Button>
</BottomSheet>

<SideSheet bind:open={sideOpen} title="Notes and highlights">
	<TextField label="Search notes" value="" />
	<Button variant="text">Export</Button>
</SideSheet>

<AdaptiveSheet bind:open={adaptiveOpen} title="Reading preferences" scrim={false}>
	<Slider label="Text size" bind:value={size} min={75} max={250} step={5} format={(v) => `${v}%`} />
</AdaptiveSheet>

<style>
	.gallery {
		display: grid;
		gap: var(--space-6);
	}

	h2 {
		margin: 0 0 var(--space-3);
		font-family: var(--font-display);
		font-weight: var(--md-sys-typescale-weight-regular);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin: 0 0 var(--space-3);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: var(--space-5);
		align-items: start;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}

	.card-body {
		margin: 0;
		padding: var(--space-4);
	}

	.progress :global(.linear) {
		width: 10rem;
	}

	.skeletons {
		display: grid;
		gap: var(--space-2);
		max-width: 20rem;
		margin-bottom: var(--space-4);
	}

	.muted {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}
</style>
