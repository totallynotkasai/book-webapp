<script lang="ts">
	import type { StudioTrackDto } from '@book/core';
	import { Button, Dialog } from '@book/ui';
	import { describeError } from '$lib/errors';
	import { getBackend } from '$lib/services';

	/**
	 * One Chapter's narration (P1-STU-03, DESIGN.md §7.2): its audio, and the Sync Map that
	 * `tools/align` made from it (`npm run narration`). The Sync Map must be for this version of
	 * the Book and this Chapter; the Studio checks it word by word.
	 */
	interface Props {
		open: boolean;
		trackId: string;
		chapter: { chapterId: string; title: string } | null;
		onsaved: (track: StudioTrackDto) => void;
	}

	let { open = $bindable(), trackId, chapter, onsaved }: Props = $props();

	let audio = $state<File | null>(null);
	let syncMap = $state<File | null>(null);
	let saving = $state(false);
	let problem = $state<string | null>(null);

	$effect(() => {
		if (open) {
			audio = null;
			syncMap = null;
			problem = null;
		}
	});

	async function save() {
		if (!chapter || !audio || !syncMap || saving) return;
		saving = true;
		problem = null;
		try {
			let map: unknown;
			try {
				map = JSON.parse(await syncMap.text());
			} catch {
				throw new Error('That Sync Map isn’t a JSON file. Use the one tools/align wrote.');
			}
			const track = await (
				await getBackend()
			).studio.setChapterNarration(trackId, {
				chapterId: chapter.chapterId,
				audio,
				syncMap: map
			});
			open = false;
			onsaved(track);
		} catch (error) {
			problem =
				error instanceof Error && !('code' in error) ? error.message : describeError(error).message;
		} finally {
			saving = false;
		}
	}
</script>

<Dialog
	bind:open
	title={chapter ? `Narration for “${chapter.title}”` : 'Narration'}
	description="The chapter’s audio, and the Sync Map tools/align made from it."
	size="medium"
>
	<div class="form" data-testid="chapter-narration">
		{#if chapter}
			<p class="how">
				<code
					>npm run narration -- --epub book.epub --audio recording.mp3 --chapter {chapter.chapterId}</code
				>
				writes both: <code>recording.m4a</code> and <code>recording.sync.json</code>.
			</p>
		{/if}
		<label class="file">
			<span class="label">Audio (M4A, MP3, WAV or Ogg)</span>
			<input
				type="file"
				accept="audio/*,.m4a,.mp3,.wav,.ogg"
				onchange={(e) => (audio = e.currentTarget.files?.[0] ?? null)}
			/>
		</label>
		<label class="file">
			<span class="label">Sync Map (.json)</span>
			<input
				type="file"
				accept=".json,application/json"
				onchange={(e) => (syncMap = e.currentTarget.files?.[0] ?? null)}
			/>
		</label>
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	</div>
	{#snippet actions()}
		<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
		<Button icon="upload" disabled={!audio || !syncMap} pending={saving} onclick={() => void save()}
			>Add narration</Button
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

	.problem {
		margin: 0;
		color: var(--md-sys-color-error);
	}

	.how {
		margin: 0;
		overflow-wrap: anywhere;
		color: var(--md-sys-color-on-surface-variant);
	}
</style>
