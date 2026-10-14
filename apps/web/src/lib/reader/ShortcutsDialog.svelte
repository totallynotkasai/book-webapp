<script lang="ts">
	import { Button, Dialog } from '@book/ui';
	import ShortcutTable from './ShortcutTable.svelte';
	import { READER_SHORTCUTS } from './shortcuts';

	// The reader's keyboard map (§11.7: full keyboard use with documented shortcuts). `?` opens it.
	let { open = $bindable() }: { open: boolean } = $props();
</script>

<Dialog bind:open title="Keyboard shortcuts" size="medium">
	<ShortcutTable shortcuts={READER_SHORTCUTS} />
	{#snippet actions()}
		<Button variant="text" onclick={() => (open = false)}>Close</Button>
	{/snippet}
</Dialog>
