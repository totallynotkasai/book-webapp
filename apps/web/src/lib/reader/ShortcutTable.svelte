<script lang="ts">
	import type { Shortcut } from './shortcuts';

	let { shortcuts, caption }: { shortcuts: Shortcut[]; caption?: string } = $props();
</script>

<table>
	{#if caption}<caption>{caption}</caption>{/if}
	<thead class="visually-hidden">
		<tr><th scope="col">Keys</th><th scope="col">What they do</th></tr>
	</thead>
	<tbody>
		{#each shortcuts as [keys, action] (keys)}
			<tr>
				<th scope="row"><kbd>{keys}</kbd></th>
				<td>{action}</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	table {
		width: 100%;
		border-collapse: collapse;
	}

	caption {
		padding-bottom: var(--space-2);
		font-size: var(--md-sys-typescale-title-medium-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		text-align: start;
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

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
