<script lang="ts">
	import { Icon } from '@book/ui';

	/** A review's stars (P1-STO-07), read as "4 out of 5 stars". */
	interface Props {
		stars: number;
		size?: number;
	}

	let { stars, size = 18 }: Props = $props();
</script>

<span class="stars" role="img" aria-label={`${stars} out of 5 stars`}>
	{#each [1, 2, 3, 4, 5] as n (n)}
		<Icon name={n <= stars ? 'star-fill' : 'star'} {size} />
	{/each}
</span>

<style>
	.stars {
		display: inline-flex;
		color: var(--md-sys-color-primary);
	}
</style>
