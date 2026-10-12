<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button, Card, Dialog, Icon } from '@book/ui';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { deleteDeviceData, exportAllData, exportAllNotes } from '$lib/data/export';
	import {
		requestPersistentStorageAgain,
		storageStatus,
		type StorageStatus
	} from '$lib/data/persistence';
	import { getPlatform } from '$lib/platform';
	import { snackbars } from '$lib/state/snackbar.svelte';

	// P1-APP-04 (DESIGN.md §18): until there's an account to sync to, everything lives on this
	// device. Say so plainly, show whether the browser has promised to keep it, and offer exports
	// and a clean delete.
	let status = $state<StorageStatus>();
	let exporting = $state<'json' | 'md' | null>(null);
	let confirmDelete = $state(false);
	let deleting = $state(false);

	async function refresh() {
		status = await storageStatus();
	}
	onMount(() => void refresh());

	async function ask() {
		const granted = await requestPersistentStorageAgain();
		await refresh();
		snackbars.show(
			granted
				? 'This device will keep your data.'
				: 'The browser didn’t agree this time. It decides from how often you use the app; exporting is the safe option.'
		);
	}

	const stamp = () => new Date().toISOString().slice(0, 10);

	async function exportData() {
		exporting = 'json';
		try {
			const snapshot = await exportAllData();
			const saved = await getPlatform().files.saveFile({
				name: `book-reader-data-${stamp()}.json`,
				mimeType: 'application/json',
				data: JSON.stringify(snapshot, null, 2)
			});
			if (saved === 'saved') snackbars.show('All your data exported');
		} finally {
			exporting = null;
		}
	}

	async function exportNotes() {
		exporting = 'md';
		try {
			const saved = await getPlatform().files.saveFile({
				name: `book-reader-notes-${stamp()}.md`,
				mimeType: 'text/markdown',
				data: await exportAllNotes()
			});
			if (saved === 'saved') snackbars.show('All your notes exported');
		} finally {
			exporting = null;
		}
	}

	async function remove() {
		deleting = true;
		try {
			await deleteDeviceData();
			confirmDelete = false;
			// A fresh start: every screen reloads from the now-empty Stores.
			location.assign(resolve('/library'));
		} catch {
			deleting = false;
			snackbars.show('Couldn’t delete your data. Close other tabs of this app and try again.', {
				tone: 'error'
			});
		}
	}

	const megabytes = (bytes: number) =>
		bytes < 1024 * 1024
			? `${Math.max(1, Math.round(bytes / 1024))} KB`
			: `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
</script>

<svelte:head><title>Your data · Book Reader</title></svelte:head>

<div class="data">
	<PageHeader title="Your data" back={{ href: resolve('/you'), label: 'Back to You' }} />

	<section aria-labelledby="where-heading">
		<h2 id="where-heading">Where it lives</h2>
		<p class="lead">
			Everything you read and note stays on this device: highlights, notes, bookmarks, where you are
			in each book, the books you imported and your settings. Nothing is uploaded, so nothing syncs
			to your other devices yet.
		</p>
		<p class="hint">
			If this browser’s site data is cleared, or the app is uninstalled, it’s gone. Export it now
			and then to keep a copy.
		</p>
	</section>

	<section aria-labelledby="storage-heading">
		<h2 id="storage-heading">Keeping it safe</h2>
		<Card variant="outlined">
			<div class="status" data-testid="storage-status">
				{#if !status}
					<p>Checking…</p>
				{:else if !status.supported}
					<Icon name="info" />
					<p>This browser doesn’t say whether it will keep the data. Export it to be sure.</p>
				{:else if status.persisted}
					<Icon name="verified" />
					<div>
						<p class="state">Kept on this device</p>
						<p class="hint">
							The browser has agreed not to clear it to free up space. Clearing site data yourself
							still removes it.
						</p>
					</div>
				{:else}
					<Icon name="warning" />
					<div>
						<p class="state">Not protected yet</p>
						<p class="hint">
							The browser may clear it if the device runs low on space. Asking may help; it decides
							from how much you use the app.
						</p>
						<Button variant="tonal" onclick={ask}>Ask to keep it</Button>
					</div>
				{/if}
			</div>
			{#if status?.usage !== undefined}
				<p class="usage">Using {megabytes(status.usage)} on this device.</p>
			{/if}
		</Card>
	</section>

	<section aria-labelledby="export-heading">
		<h2 id="export-heading">Export</h2>
		<div class="actions">
			<Button icon="download" pending={exporting === 'md'} onclick={exportNotes}
				>Export all notes (Markdown)</Button
			>
			<Button variant="tonal" icon="download" pending={exporting === 'json'} onclick={exportData}
				>Export all data (JSON)</Button
			>
		</div>
		<p class="hint">
			Notes come as one Markdown file, with a heading for each book and chapter. The data file has
			every record; imported books themselves aren’t in it, since you can import the EPUB again.
		</p>
	</section>

	<section aria-labelledby="delete-heading">
		<h2 id="delete-heading">Delete</h2>
		<p class="hint">
			Removes everything above from this device, for the person signed in. Books you got from the
			store stay yours.
		</p>
		<Button variant="outlined" danger icon="delete" onclick={() => (confirmDelete = true)}
			>Delete my data on this device</Button
		>
	</section>
</div>

<Dialog
	open={confirmDelete}
	title="Delete your data on this device?"
	description="Your highlights, notes, bookmarks, reading positions, imported books and settings will be deleted. This can’t be undone."
	onclose={() => (confirmDelete = false)}
>
	<p class="hint">If you might want them later, export them first.</p>
	{#snippet actions()}
		<Button variant="text" onclick={() => (confirmDelete = false)}>Cancel</Button>
		<Button danger pending={deleting} onclick={remove}>Delete</Button>
	{/snippet}
</Dialog>

<style>
	.data {
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

	.lead {
		margin: 0 0 var(--space-2);
		font-size: var(--md-sys-typescale-body-large-size);
	}

	.hint {
		margin: 0 0 var(--space-3);
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-medium-size);
	}

	.status {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
		padding: var(--space-4);
	}

	.status p {
		margin: 0;
	}

	.state {
		margin-bottom: var(--space-1) !important;
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.usage {
		margin: 0;
		padding: 0 var(--space-4) var(--space-4);
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
</style>
