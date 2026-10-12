<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import Sheet from './Sheet.svelte';

	type Props = Omit<ComponentProps<typeof Sheet>, 'placement'>;

	let { open = $bindable(), ...rest }: Props = $props();
</script>

<!-- A modal sheet from the bottom edge, for compact screens (§11.4). Swipe down to close. -->
<Sheet bind:open placement="bottom" {...rest} />
