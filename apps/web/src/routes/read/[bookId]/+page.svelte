<script lang="ts">
	import { page } from '$app/state';
	import Reader from '$lib/reader/Reader.svelte';

	// ?sample: "Read sample" (P1-STO-01). ?preview[=<revisionId>]: a Creator's own version
	// (P1-STU-01), with ?chapter= to start at one. ?mode=creator&pack=<packId>: Creator mode (P1-LAY-05).
	const params = $derived(page.url.searchParams);
	const preview = $derived(
		params.has('preview') ? { revisionId: params.get('preview') || undefined } : null
	);
	const creatorPackId = $derived(params.get('mode') === 'creator' ? params.get('pack') : null);
</script>

<!-- A new Reader per Book (and per sample, preview or pack), so nothing carries over between them. -->
{#key `${page.params.bookId}|${params.has('sample')}|${params.get('preview')}|${creatorPackId}`}
	<Reader
		bookId={page.params.bookId ?? ''}
		sample={params.has('sample')}
		{preview}
		{creatorPackId}
		startChapter={params.get('chapter')}
	/>
{/key}
