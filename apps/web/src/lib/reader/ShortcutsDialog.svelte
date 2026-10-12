<script lang="ts">
	import { Button, Dialog } from '@book/ui';

	// The reader's keyboard map (§11.7: full keyboard use with documented shortcuts). `?` opens it.
	let { open = $bindable() }: { open: boolean } = $props();

	const SHORTCUTS: [keys: string, action: string][] = [
		['→  or  Page Down  or  Space', 'Next page'],
		['←  or  Page Up  or  Shift+Space', 'Previous page'],
		['Home  /  End', 'Start or end of the chapter'],
		['Ctrl +  /  Ctrl −  /  Ctrl 0', 'Larger, smaller or default text'],
		['Esc', 'Show or hide the reading controls; close a panel'],
		['Tab', 'Show the reading controls and move through them'],
		['?', 'This list']
	];
</script>

<Dialog bind:open title="Keyboard shortcuts" size="medium">
	<table>
		<tbody>
			{#each SHORTCUTS as [keys, action] (keys)}
				<tr>
					<th scope="row"><kbd>{keys}</kbd></th>
					<td>{action}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#snippet actions()}
		<Button variant="text" onclick={() => (open = false)}>Close</Button>
	{/snippet}
</Dialog>

<style>
	table {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		padding: var(--space-2) var(--space-2);
		border-bottom: 1px solid var(--md-sys-color-outline-variant);
		text-align: start;
		vertical-align: top;
		font-weight: var(--md-sys-typescale-weight-regular);
	}

	kbd {
		font-family: inherit;
		font-weight: var(--md-sys-typescale-weight-medium);
		white-space: pre-wrap;
	}
</style>
