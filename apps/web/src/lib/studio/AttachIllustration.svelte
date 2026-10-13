<script lang="ts">
	import type {
		DraftIllustrationDto,
		IllustrationPlacement,
		ImageUpload,
		RangeAnchor,
		StudioPackDto
	} from '@book/core';
	import { Button, Dialog, RadioGroup, SegmentedButton, Switch, TextField } from '@book/ui';
	import { untrack } from 'svelte';
	import { describeError } from '$lib/errors';
	import { getBackend } from '$lib/services';
	import { ImageProblem, prepareIllustration } from './images';

	/**
	 * Attaching an Illustration to a passage in Creator mode (P1-LAY-05, plan §6 Phase 1.7 UX
	 * notes): the picture (prepared on the device), where it sits in `in-text` mode, whether it
	 * spans two pages, alt text (needed to publish), caption, credit and spoiler-safety. Also edits
	 * one already placed.
	 */
	interface Props {
		open: boolean;
		packId: string;
		/** The passage for a new picture. */
		anchor?: RangeAnchor | null;
		/** The passage's text, so the creator sees what they're attaching to. */
		passage?: string;
		/** A picture already placed, to edit. */
		editing?: DraftIllustrationDto | null;
		onsaved: (pack: StudioPackDto) => void;
	}

	let {
		open = $bindable(),
		packId,
		anchor = null,
		passage = '',
		editing = null,
		onsaved
	}: Props = $props();

	let image = $state.raw<ImageUpload | null>(null);
	let preview = $state<string | null>(null);
	let placement = $state<IllustrationPlacement>('inline');
	let span = $state<'single' | 'double'>('single');
	let alt = $state('');
	let caption = $state('');
	let credit = $state('');
	let spoilerSafe = $state(false);
	let preparing = $state(false);
	let saving = $state(false);
	let problem = $state<string | null>(null);

	// A fresh form each time the dialog opens; nothing typed or chosen in it re-runs this.
	$effect(() => {
		if (!open) return;
		const picture = editing;
		untrack(() => {
			image = null;
			setPreview(null);
			placement = picture?.placement ?? 'inline';
			span = picture?.span ?? 'single';
			alt = picture?.alt ?? '';
			caption = picture?.caption ?? '';
			credit = picture?.credit ?? '';
			spoilerSafe = picture?.spoilerSafe ?? false;
			problem = null;
		});
	});

	function setPreview(url: string | null) {
		if (preview) URL.revokeObjectURL(preview);
		preview = url;
	}

	async function choose(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		preparing = true;
		problem = null;
		try {
			image = await prepareIllustration(file);
			setPreview(URL.createObjectURL(image.variants[0]!.file));
		} catch (error) {
			problem = error instanceof ImageProblem ? error.message : describeError(error).message;
		} finally {
			preparing = false;
		}
	}

	async function save() {
		if (saving) return;
		saving = true;
		problem = null;
		try {
			const backend = await getBackend();
			const details = {
				placement,
				span,
				alt: alt.trim(),
				caption: caption.trim() || undefined,
				credit: credit.trim() || undefined,
				spoilerSafe
			};
			const pack = editing
				? await backend.studio.updateIllustration(packId, editing.id, {
						...details,
						...(image ? { image } : {})
					})
				: await backend.studio.addIllustration(packId, {
						...details,
						anchor: anchor!,
						image: image!
					});
			open = false;
			onsaved(pack);
		} catch (error) {
			problem = describeError(error).message;
		} finally {
			saving = false;
		}
	}

	const canSave = $derived(!!(editing || (anchor && image)) && !preparing);
</script>

<Dialog
	bind:open
	title={editing ? 'Edit picture' : 'Attach a picture'}
	description={passage ? `To “${passage}”` : undefined}
	size="medium"
	onclose={() => setPreview(null)}
>
	<div class="form" data-testid="attach-illustration">
		<label class="file">
			<span class="label">{editing ? 'Replace the picture (optional)' : 'Picture'}</span>
			<input type="file" accept="image/*" onchange={(e) => void choose(e)} />
		</label>
		{#if preparing}<p class="muted" role="status">Preparing the picture…</p>{/if}
		{#if preview}
			<img class="preview" src={preview} alt="" />
			<p class="muted">Saved as WebP or JPEG; camera details are removed.</p>
		{/if}
		<TextField
			label="Alt text"
			bind:value={alt}
			multiline
			rows={2}
			supportingText="Describe the picture for readers who can’t see it. Needed to publish."
		/>
		<TextField label="Caption (optional)" bind:value={caption} />
		<TextField label="Credit (optional)" bind:value={credit} />
		<RadioGroup
			label="In “in text” mode"
			value={placement}
			onchange={(v) => (placement = v)}
			options={[
				{ value: 'inline', label: 'In the text', description: 'Between the paragraphs' },
				{ value: 'full_page', label: 'Its own page', description: 'Full page, like a plate' },
				{ value: 'panel', label: 'Beside the text only', description: 'Not placed in the text' }
			]}
		/>
		<SegmentedButton
			label="Width"
			value={span}
			onchange={(v) => (span = v)}
			options={[
				{ value: 'single', label: 'One page' },
				{ value: 'double', label: 'Two pages' }
			]}
		/>
		<Switch
			label="Safe for the store page"
			description="Shows nothing a new reader shouldn’t see yet."
			checked={spoilerSafe}
			onchange={(v) => (spoilerSafe = v)}
		/>
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	</div>
	{#snippet actions()}
		<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
		<Button disabled={!canSave} pending={saving} onclick={() => void save()}>
			{editing ? 'Save' : 'Attach'}
		</Button>
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

	.preview {
		max-width: 100%;
		max-height: 12rem;
		justify-self: start;
		border-radius: var(--md-sys-shape-corner-small);
	}

	.muted {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.problem {
		margin: 0;
		color: var(--md-sys-color-error);
	}
</style>
