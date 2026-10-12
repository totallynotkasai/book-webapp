<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import Sheet from './Sheet.svelte';

	type Props = Omit<ComponentProps<typeof Sheet>, 'placement'> & { side?: 'start' | 'end' };

	let { open = $bindable(), side = 'end', ...rest }: Props = $props();

	// M3 window classes (§11.5): a bottom sheet on compact screens, a side sheet from 600 px.
	const compact = new MediaQuery('max-width: 599.98px');
</script>

<!-- Bottom sheet on compact screens, side sheet on medium and expanded (IMPLEMENTATION-PLAN.md §8). -->
<Sheet bind:open placement={compact.current ? 'bottom' : side} {...rest} />
