<script lang="ts">
	import type { ChapterReleaseDto } from '@book/core';
	import { Button, Dialog, RadioGroup, TextField } from '@book/ui';
	import { untrack } from 'svelte';
	import { describeError } from '$lib/errors';
	import { formatDayTime } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { snackbars } from '$lib/state/snackbar.svelte';

	/**
	 * When a serial's Chapter comes out (P1-STU-06, plan §6 Phase 1.15): with its version (or now,
	 * for the version readers have), or at a day and time. Until then readers see it locked, with
	 * when; when it comes out, the author's followers each get an inbox message.
	 */
	interface Props {
		open: boolean;
		bookId: string;
		chapter: { chapterId: string; title: string; release: ChapterReleaseDto } | null;
		/** The Chapter is in the version readers have, so "no time" means now. */
		published: boolean;
	}

	let { open = $bindable(), bookId, chapter, published }: Props = $props();

	type Choice = 'version' | 'time';
	let choice = $state<Choice>('time');
	let when = $state('');
	let saving = $state(false);
	let problem = $state<string | null>(null);

	/** `<input type="datetime-local">` holds local time without a zone. */
	const pad = (n: number) => String(n).padStart(2, '0');
	function localInput(date: Date): string {
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
			date.getHours()
		)}:${pad(date.getMinutes())}`;
	}

	/** Tomorrow at 09:00, unless it already has a time. */
	function suggested(): string {
		const own = chapter?.release.scheduledAt ?? chapter?.release.releaseAt;
		if (own) return localInput(new Date(own));
		const today = new Date();
		return localInput(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 9));
	}

	$effect(() => {
		if (!open) return;
		untrack(() => {
			choice = 'time';
			when = suggested();
			problem = null;
		});
	});

	const at = $derived(when ? new Date(when) : null);
	const valid = $derived(choice === 'version' || (!!at && !Number.isNaN(at.getTime())));

	async function save() {
		if (!chapter || !valid || saving) return;
		saving = true;
		problem = null;
		try {
			const releaseAt = choice === 'time' && at ? at.toISOString() : null;
			await (
				await getBackend()
			).studio.scheduleChapter(bookId, { chapterId: chapter.chapterId, releaseAt });
			open = false;
			snackbars.show(
				releaseAt
					? `“${chapter.title}” comes out ${formatDayTime(releaseAt)}.`
					: published
						? `“${chapter.title}” is out.`
						: `“${chapter.title}” comes out when you publish this version.`
			);
		} catch (error) {
			problem = describeError(error).message;
		} finally {
			saving = false;
		}
	}
</script>

<Dialog
	bind:open
	title={chapter ? `When does “${chapter.title}” come out?` : 'When does it come out?'}
	description="Until then, readers see it locked with the day it comes out. When it’s out, everyone who follows you gets a message."
	size="medium"
>
	<div class="form" data-testid="release-dialog">
		<RadioGroup
			label="Comes out"
			value={choice}
			onchange={(v) => (choice = v)}
			options={[
				{
					value: 'version',
					label: published ? 'Now' : 'With this version',
					description: published
						? 'Readers can open it straight away.'
						: 'As soon as you publish this version.'
				},
				{ value: 'time', label: 'At a day and time', description: 'In your time zone.' }
			]}
		/>
		{#if choice === 'time'}
			<TextField
				label="Day and time"
				type="datetime-local"
				bind:value={when}
				required
				error={when && !valid ? 'Enter a day and a time.' : undefined}
			/>
		{/if}
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	</div>
	{#snippet actions()}
		<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
		<Button icon="schedule" disabled={!valid} pending={saving} onclick={() => void save()}
			>{choice === 'time' ? 'Schedule' : published ? 'Release now' : 'Save'}</Button
		>
	{/snippet}
</Dialog>

<style>
	.form {
		display: grid;
		gap: var(--space-3);
	}

	.problem {
		margin: 0;
		color: var(--md-sys-color-error);
	}
</style>
