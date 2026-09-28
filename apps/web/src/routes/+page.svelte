<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<main>
	<h1>Library</h1>
	<p class="muted">Proof of concept. Books and reading data are stored in this browser only.</p>

	<ul>
		<li>
			<a href={resolve('/read/[bookId]', { bookId: 'sample' })}>Sample book (placeholder)</a>
		</li>
	</ul>
</main>

<style>
	main {
		max-width: 48rem;
		margin: 0 auto;
		padding: calc(var(--space-6) + var(--safe-top)) calc(var(--space-4) + var(--safe-right))
			var(--space-6) calc(var(--space-4) + var(--safe-left));
	}

	h1 {
		font-family: var(--font-display);
	}

	.muted {
		color: var(--color-text-muted);
	}

	a {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch-target);
	}
</style>
