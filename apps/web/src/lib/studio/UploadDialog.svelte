<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button, Dialog, Icon } from '@book/ui';
	import { describeError } from '$lib/errors';
	import { getBackend } from '$lib/services';

	/**
	 * Uploading an EPUB to the Studio (P1-STU-01): a new Book, or with `bookId` a new version of
	 * one. The file is processed in the background (as a Phase 2 job would be); the Book's page
	 * shows its progress and then the ingest report. Nothing leaves the device in the PoC.
	 */
	interface Props {
		open: boolean;
		/** A new version of this Book; a new Book when absent. */
		bookId?: string;
		/** Called with the upload's Book once it's on its way. */
		onuploaded?: (bookId: string) => void;
	}

	let { open = $bindable(), bookId, onuploaded }: Props = $props();

	let file = $state<File | null>(null);
	let uploading = $state(false);
	let problem = $state<string | null>(null);

	$effect(() => {
		if (open) {
			file = null;
			problem = null;
		}
	});

	async function upload() {
		if (!file || uploading) return;
		uploading = true;
		problem = null;
		try {
			const revision = await (await getBackend()).studio.upload(file, bookId ? { bookId } : {});
			open = false;
			if (onuploaded) onuploaded(revision.bookId);
			else await goto(resolve('/(app)/studio/books/[bookId]', { bookId: revision.bookId }));
		} catch (error) {
			problem = describeError(error).message;
		} finally {
			uploading = false;
		}
	}
</script>

<Dialog
	bind:open
	title={bookId ? 'Upload a new version' : 'Upload a book'}
	description={bookId
		? 'Readers keep their notes: unchanged words keep their place, and changed passages are found again where they can be.'
		: 'An EPUB file. In this preview nothing leaves your device.'}
>
	<div class="form" data-testid="upload-dialog">
		<label class="file">
			<span class="label">EPUB file</span>
			<input
				type="file"
				accept=".epub,application/epub+zip"
				onchange={(e) => (file = e.currentTarget.files?.[0] ?? null)}
			/>
		</label>
		{#if file}<p class="muted"><Icon name="file_open" size={18} /> {file.name}</p>{/if}
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	</div>
	{#snippet actions()}
		<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
		<Button icon="upload" disabled={!file} pending={uploading} onclick={() => void upload()}
			>Upload</Button
		>
	{/snippet}
</Dialog>

<style>
	.form {
		display: grid;
		gap: var(--space-3);
	}

	.file {
		display: grid;
		gap: var(--space-1);
	}

	.label {
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.file input {
		max-width: 100%;
		min-height: var(--touch-target);
	}

	.muted {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.problem {
		margin: 0;
		color: var(--md-sys-color-error);
	}
</style>
