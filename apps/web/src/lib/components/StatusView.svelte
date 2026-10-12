<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { Resource } from '$lib/state/resource.svelte';
	import ErrorState from './ErrorState.svelte';

	/**
	 * The five screen states of IMPLEMENTATION-PLAN.md §8 for one `resource()`: loading (only after
	 * the delay), empty, error, offline and success. Data already shown stays on screen if a refresh
	 * fails, with a banner above it.
	 */
	interface Props {
		resource: Resource<T>;
		/** What this is, for error headings ("Your library"). */
		what: string;
		/** Skeleton shown while loading takes longer than the delay. */
		loading: Snippet;
		/** Shown when the data is empty. */
		empty?: Snippet;
		isEmpty?: (data: T) => boolean;
		children: Snippet<[T]>;
	}

	let { resource, what, loading, empty, isEmpty = defaultEmpty, children }: Props = $props();

	function defaultEmpty(data: T): boolean {
		if (Array.isArray(data)) return data.length === 0;
		if (data && typeof data === 'object' && 'items' in data) {
			return Array.isArray(data.items) && data.items.length === 0;
		}
		return false;
	}
</script>

<div class="status-view" aria-busy={resource.loading}>
	{#if resource.data !== undefined}
		{#if resource.error}
			<ErrorState error={resource.error} {what} onretry={resource.refresh} inline />
		{/if}
		{#if empty && isEmpty(resource.data)}
			{@render empty()}
		{:else}
			{@render children(resource.data)}
		{/if}
	{:else if resource.status === 'error' && resource.error}
		<ErrorState error={resource.error} {what} onretry={resource.refresh} />
	{:else if resource.showLoading}
		<p class="visually-hidden" role="status">Loading…</p>
		{@render loading()}
	{/if}
</div>

<style>
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
