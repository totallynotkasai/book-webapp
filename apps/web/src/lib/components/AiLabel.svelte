<script lang="ts">
	import type { AiUse } from '@book/core';
	import { Badge } from '@book/ui';
	import { aiLabel } from '$lib/format';

	// The AI label wherever Books and Layers appear (§10.6, P1-STO-05).
	let { aiUse }: { aiUse: AiUse } = $props();
	const label = $derived(aiLabel(aiUse));
</script>

{#if label}<Badge tone="tertiary" icon="wand_stars">{label}</Badge>{/if}
