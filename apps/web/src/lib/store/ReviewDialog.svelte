<script lang="ts">
	import { REVIEW_MAX_LENGTH, type ReviewDto } from '@book/core';
	import { Button, Dialog, Icon, Switch, TextField } from '@book/ui';
	import { untrack } from 'svelte';
	import { describeError } from '$lib/errors';
	import { reviewProgress } from '$lib/format';
	import { getBackend, getStores } from '$lib/services';
	import { snackbars } from '$lib/state/snackbar.svelte';

	/**
	 * Writing or changing a review (P1-STO-07; plan §6 Phase 1.18 UX notes): stars (required), words
	 * (optional), and "Contains spoilers" (D-042). It shows how far the reader has read, from their
	 * Reading Progress on this device, which goes with it.
	 */
	interface Props {
		open: boolean;
		book: { id: string; title: string };
		/** The reader's review, when they're changing it. */
		existing: ReviewDto | null;
	}

	let { open = $bindable(), book, existing }: Props = $props();

	let stars = $state<number | null>(null);
	let text = $state('');
	let spoilers = $state(false);
	let progression = $state(0);
	let saving = $state(false);
	let problem = $state<string | null>(null);

	$effect(() => {
		if (!open) return;
		untrack(() => {
			stars = existing?.stars ?? null;
			text = existing?.text ?? '';
			spoilers = existing?.spoilers ?? false;
			problem = null;
		});
		void (async () => {
			const progress = await (await getStores()).progress.get(book.id);
			progression = progress?.furthestProgression ?? 0;
		})();
	});

	async function save() {
		if (!stars || saving) return;
		saving = true;
		problem = null;
		try {
			await (
				await getBackend()
			).reviews.save(book.id, { stars, text: text.trim(), spoilers, progression });
			open = false;
			snackbars.show(existing ? 'Review saved' : 'Review posted');
		} catch (error) {
			problem = describeError(error).message;
		} finally {
			saving = false;
		}
	}

	async function remove() {
		saving = true;
		try {
			await (await getBackend()).reviews.remove(book.id);
			open = false;
			snackbars.show('Review deleted');
		} catch (error) {
			problem = describeError(error).message;
		} finally {
			saving = false;
		}
	}
</script>

<Dialog bind:open title={existing ? 'Change your review' : `Review ${book.title}`} size="medium">
	<div class="form" data-testid="review-form">
		<fieldset class="rate">
			<legend>Your rating</legend>
			<div class="star-inputs">
				{#each [1, 2, 3, 4, 5] as n (n)}
					<label class="star" title={`${n} ${n === 1 ? 'star' : 'stars'}`}>
						<input type="radio" name="review-stars" value={n} bind:group={stars} />
						<Icon name={stars !== null && n <= stars ? 'star-fill' : 'star'} size={32} />
						<span class="visually-hidden">{n} {n === 1 ? 'star' : 'stars'}</span>
					</label>
				{/each}
			</div>
		</fieldset>
		<TextField
			label="Your review (optional)"
			bind:value={text}
			multiline
			rows={5}
			maxlength={REVIEW_MAX_LENGTH}
			supportingText="What did you think? Other readers see it on the book’s page."
		/>
		<Switch
			label="Contains spoilers"
			description="Other readers see the words only if they choose to."
			checked={spoilers}
			onchange={(on) => (spoilers = on)}
		/>
		<p class="progress" data-testid="review-progress">
			<Icon name="auto_stories" size={18} />
			It will say “{reviewProgress(progression)}”: how far you’ve read on this device.
		</p>
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	</div>
	{#snippet actions()}
		{#if existing}
			<Button variant="text" danger disabled={saving} onclick={() => void remove()}>Delete</Button>
		{/if}
		<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
		<Button disabled={!stars} pending={saving} onclick={() => void save()}
			>{existing ? 'Save review' : 'Post review'}</Button
		>
	{/snippet}
</Dialog>

<style>
	.form {
		display: grid;
		gap: var(--space-4);
	}

	.rate {
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		margin-bottom: var(--space-2);
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.star-inputs {
		display: flex;
		gap: var(--space-1);
	}

	.star {
		position: relative;
		display: grid;
		place-items: center;
		width: var(--touch-target);
		height: var(--touch-target);
		border-radius: 50%;
		color: var(--md-sys-color-primary);
		cursor: pointer;
	}

	.star input {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.star:has(input:focus-visible) {
		outline: 3px solid var(--md-sys-color-secondary);
	}

	.progress {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-medium-size);
	}

	.problem {
		margin: 0;
		color: var(--md-sys-color-error);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
