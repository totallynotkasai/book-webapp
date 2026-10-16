<script lang="ts">
	import type { ImageUpload, StudioGlossaryEntryDto, StudioStoryDto } from '@book/core';
	import { Button, Dialog, TextField } from '@book/ui';
	import { untrack } from 'svelte';
	import { describeError } from '$lib/errors';
	import { getBackend } from '$lib/services';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import { ImageProblem, prepareGlossaryPicture } from './images';

	/**
	 * Adding or changing a glossary entry (P1-STU-05; plan §6 Phase 1.14 UX notes): its name, what
	 * else it's called, a description and an optional picture with its alt text. Where each name
	 * first appears is found when it's saved, and shown in the list.
	 */
	interface Props {
		open: boolean;
		bookId: string;
		/** The entry to change; null adds one. */
		entry: StudioGlossaryEntryDto | null;
		onsaved: (story: StudioStoryDto) => void;
	}

	let { open = $bindable(), bookId, entry, onsaved }: Props = $props();

	let name = $state('');
	let aliases = $state('');
	let description = $state('');
	let alt = $state('');
	/** A new picture, prepared on the device; `null` removes the one it has. */
	let picture = $state.raw<ImageUpload | null | undefined>(undefined);
	let preview = $state<string | null>(null);
	let saving = $state(false);
	let problem = $state<string | null>(null);

	$effect(() => {
		if (!open) return;
		untrack(() => {
			name = entry?.name ?? '';
			aliases = entry?.aliases.join(', ') ?? '';
			description = entry?.description ?? '';
			alt = entry?.picture?.alt ?? '';
			picture = undefined;
			setPreview(entry?.picture?.url ?? null);
			problem = null;
		});
	});

	/** Object URLs made here are ours to revoke; the entry's own picture URL isn't. */
	let ownPreview: string | null = null;
	function setPreview(url: string | null, own = false) {
		if (ownPreview) URL.revokeObjectURL(ownPreview);
		ownPreview = own ? url : null;
		preview = url;
	}
	$effect(() => () => setPreview(null));

	const hasPicture = $derived(picture ? true : picture === null ? false : !!entry?.picture);
	const valid = $derived(!!name.trim() && !!description.trim() && (!hasPicture || !!alt.trim()));

	async function choose(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			picture = await prepareGlossaryPicture(file);
			setPreview(URL.createObjectURL(picture.variants[0]!.file), true);
		} catch (error) {
			problem = error instanceof ImageProblem ? error.message : 'That picture couldn’t be used.';
		}
	}

	function removePicture() {
		picture = null;
		alt = '';
		setPreview(null);
	}

	async function save() {
		if (!valid || saving) return;
		saving = true;
		problem = null;
		try {
			const story = await (
				await getBackend()
			).studio.saveGlossaryEntry(bookId, entry?.id ?? null, {
				name: name.trim(),
				aliases: aliases
					.split(',')
					.map((a) => a.trim())
					.filter(Boolean),
				description: description.trim(),
				...(picture !== undefined ? { picture } : {}),
				...(hasPicture ? { pictureAlt: alt.trim() } : {})
			});
			open = false;
			onsaved(story);
			snackbars.show(entry ? 'Entry saved.' : 'Entry added.');
		} catch (error) {
			problem = describeError(error).message;
		} finally {
			saving = false;
		}
	}
</script>

<Dialog
	bind:open
	title={entry ? `Edit “${entry.name}”` : 'Add a glossary entry'}
	description="A character, place or thing readers can look up once they’ve met it."
	size="medium"
>
	<form
		class="form"
		data-testid="glossary-entry-dialog"
		onsubmit={(e) => {
			e.preventDefault();
			void save();
		}}
	>
		<TextField
			label="Name"
			bind:value={name}
			required
			maxlength={80}
			supportingText="As it’s written in the book. Capitals count: “Wick” isn’t found in “a lamp’s wick”."
		/>
		<TextField
			label="Also called"
			bind:value={aliases}
			supportingText="Other names it goes by, separated by commas. Readers see each one only once they’ve met it."
		/>
		<TextField
			label="Description"
			bind:value={description}
			multiline
			rows={4}
			required
			maxlength={1000}
			supportingText="Only what a reader knows when they first meet it, so it gives nothing away."
		/>
		<div class="picture">
			{#if preview && hasPicture}
				<img src={preview} alt="" />
			{/if}
			<div class="picture-actions">
				<label class="file">
					<span class="label">{hasPicture ? 'Replace the picture' : 'Picture (optional)'}</span>
					<input type="file" accept="image/*" onchange={(e) => void choose(e)} />
				</label>
				{#if hasPicture}
					<Button variant="text" icon="delete" onclick={removePicture}>Remove picture</Button>
				{/if}
			</div>
		</div>
		{#if hasPicture}
			<TextField
				label="Alt text"
				bind:value={alt}
				required
				maxlength={300}
				error={alt.trim() ? undefined : 'Describe the picture for readers using a screen reader.'}
			/>
		{/if}
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
		<!-- Enter in a field saves; the visible buttons are below. -->
		<button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
	</form>
	{#snippet actions()}
		<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
		<Button disabled={!valid} pending={saving} onclick={() => void save()}
			>{entry ? 'Save entry' : 'Add entry'}</Button
		>
	{/snippet}
</Dialog>

<style>
	.form {
		display: grid;
		gap: var(--space-3);
	}

	.picture {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: flex-end;
	}

	.picture img {
		width: 5rem;
		height: 5rem;
		border-radius: var(--md-sys-shape-corner-medium);
		object-fit: cover;
	}

	.picture-actions {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
	}

	.file {
		display: grid;
		gap: var(--space-1);
	}

	.file input {
		max-width: 100%;
		min-height: var(--touch-target);
	}

	.label {
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.problem {
		margin: 0;
		color: var(--md-sys-color-error);
	}
</style>
