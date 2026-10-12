<script lang="ts">
	import { page } from '$app/state';
	import Reader from '$lib/reader/Reader.svelte';
</script>

<!-- A new Reader per Book, so nothing carries over between Books. -->
{#key page.params.bookId}
	<Reader bookId={page.params.bookId ?? ''} />
{/key}
