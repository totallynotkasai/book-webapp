<script lang="ts">
	import { Button, Dialog, TextField } from '@book/ui';

	/**
	 * Writes a note on a highlight, or a label on a Placed Bookmark (§9.3). The quoted text is
	 * shown so the reader knows what they're writing about.
	 */
	interface Props {
		open: boolean;
		title: string;
		label: string;
		value: string;
		quote?: string;
		multiline?: boolean;
		saveLabel?: string;
		onsave: (value: string) => void;
		/** Shown when there's something to delete, e.g. an existing note. */
		ondelete?: () => void;
		deleteLabel?: string;
		onclose: () => void;
	}

	let {
		open,
		title,
		label,
		value,
		quote,
		multiline = false,
		saveLabel = 'Save',
		onsave,
		ondelete,
		deleteLabel = 'Delete',
		onclose
	}: Props = $props();

	let draft = $state('');
	let element = $state<HTMLInputElement | HTMLTextAreaElement>();

	$effect(() => {
		if (!open) return;
		draft = value;
		queueMicrotask(() => element?.focus());
	});

	function save(event?: SubmitEvent) {
		event?.preventDefault();
		onsave(draft);
	}
</script>

<Dialog {open} {title} size="medium" {onclose}>
	<form id="text-dialog-form" class="form" onsubmit={save}>
		{#if quote}
			<blockquote class="quote">{quote}</blockquote>
		{/if}
		<TextField
			{label}
			bind:value={draft}
			bind:element
			{multiline}
			rows={multiline ? 5 : undefined}
			onkeydown={(event: KeyboardEvent) => {
				// Ctrl+Enter saves a multi-line note; Enter alone adds a line.
				if (multiline && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save();
			}}
		/>
	</form>
	{#snippet actions()}
		{#if ondelete}
			<Button variant="text" icon="delete" onclick={ondelete}>{deleteLabel}</Button>
		{/if}
		<Button variant="text" onclick={onclose}>Cancel</Button>
		<Button type="submit" form="text-dialog-form">{saveLabel}</Button>
	{/snippet}
</Dialog>

<style>
	.form {
		display: grid;
		gap: var(--space-4);
		min-width: min(28rem, 80vw);
	}

	.quote {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border-inline-start: 3px solid var(--md-sys-color-outline-variant);
		color: var(--md-sys-color-on-surface-variant);
		font-family: var(--font-literata);
		font-style: italic;
		max-height: 8em;
		overflow: auto;
	}
</style>
