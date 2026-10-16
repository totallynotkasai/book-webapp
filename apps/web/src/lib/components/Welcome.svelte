<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button, Dialog, Icon, type IconName } from '@book/ui';
	import { flags } from '$lib/flags';
	import { welcome } from '$lib/state/welcome.svelte';

	// The first-run welcome (P1-QA-03, DESIGN.md §13.3): a tester with only a link reaches the
	// first page of Alice in one tap. It says what this build is, without a tour.
	const ALICE = 'book-alice';
	// A first visit starts at Chapter I. A new Book opens at its text anyway (P1-RDR-09), but this
	// Gutenberg Alice names no landmark, so the link doesn't rest on that rule's heuristic (D-034).
	// From Help, it opens wherever the reader got to.
	const CHAPTER_I = '8761230412384829988_11-h-1.htm.xhtml';

	const points: [icon: IconName, text: string][] = [
		[
			'auto_stories',
			'Alice’s Adventures in Wonderland is ready. Tap the sides of a page to turn it.'
		],
		['image', 'With John Tenniel’s illustrations.'],
		['headphones', 'The first three chapters are narrated, each word highlighted as it’s read.'],
		...(flags.store
			? [['shopping_bag', 'The store is pretend: nothing costs money.'] as [IconName, string]]
			: []),
		['lock', 'It’s an early test version. Everything stays on this device.']
	];

	async function startReading() {
		welcome.dismiss();
		const book = resolve('/read/[bookId]', { bookId: ALICE });
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above, plus a query
		await goto(welcome.firstRun ? `${book}?chapter=${encodeURIComponent(CHAPTER_I)}` : book);
	}
</script>

<Dialog
	open={welcome.open}
	title="Welcome to Book Reader"
	description="Books with pictures and narration."
	size="medium"
	onclose={() => welcome.dismiss()}
>
	<ul class="points">
		{#each points as [icon, text] (icon)}
			<li><Icon name={icon} /><span>{text}</span></li>
		{/each}
	</ul>
	{#snippet actions()}
		<Button variant="text" onclick={() => welcome.dismiss()}>Look around first</Button>
		<Button icon="auto_stories" onclick={startReading}>Start reading</Button>
	{/snippet}
</Dialog>

<style>
	.points {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-3);
		align-items: start;
	}

	li > :global(svg) {
		color: var(--md-sys-color-primary);
	}
</style>
