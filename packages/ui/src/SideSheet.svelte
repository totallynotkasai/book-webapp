<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import Sheet from './Sheet.svelte';

	type Props = Omit<ComponentProps<typeof Sheet>, 'placement'> & { side?: 'start' | 'end' };

	let { open = $bindable(), side = 'end', ...rest }: Props = $props();
</script>

<!-- A modal sheet from the side, for medium and expanded screens (§11.4). -->
<Sheet bind:open placement={side} {...rest} />
