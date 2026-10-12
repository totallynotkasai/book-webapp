<script lang="ts">
	import IconButton from '../IconButton.svelte';
	import Tooltip from '../Tooltip.svelte';
</script>

<Tooltip text="Table of contents">
	{#snippet children(props)}
		<IconButton {...props} icon="toc" label="Contents" />
	{/snippet}
</Tooltip>
