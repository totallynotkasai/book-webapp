<script lang="ts">
	import { page } from '$app/state';
	import Reader from '$lib/reader/Reader.svelte';
</script>

<!-- A new Reader per Book (and per sample), so nothing carries over between them. -->
{#key `${page.params.bookId}|${page.url.searchParams.has('sample')}`}
	<Reader bookId={page.params.bookId ?? ''} sample={page.url.searchParams.has('sample')} />
{/key}
