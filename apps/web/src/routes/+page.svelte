<script lang="ts">
	import { resolve } from '$app/paths';
	import { isBackendError, type LibraryEntryDto, type UserDto } from '@book/core';
	import { flags } from '$lib/flags';
	import { getBackend } from '$lib/services';

	// A bare Library (P0-09): enough to watch the simulated backend's latency and failures.
	// The real Library, with designed states and components, is P1-APP-01 and P1-APP-03.
	type LibraryState =
		| { status: 'loading' }
		| { status: 'ready'; entries: LibraryEntryDto[] }
		| { status: 'error'; offline: boolean; message: string };

	let library = $state<LibraryState>({ status: 'loading' });
	let user = $state<UserDto | null>(null);
	/** Loading indicators appear only after 300 ms, so fast responses don't flicker (plan §8). */
	let showLoading = $state(false);

	async function load() {
		library = { status: 'loading' };
		showLoading = false;
		const timer = setTimeout(() => (showLoading = true), 300);
		try {
			const backend = await getBackend();
			const [session, page] = await Promise.all([
				backend.session.current(),
				backend.library.list()
			]);
			user = session.user;
			library = { status: 'ready', entries: page.items };
		} catch (error) {
			library = {
				status: 'error',
				offline: isBackendError(error, 'NETWORK_ERROR'),
				message: error instanceof Error ? error.message : String(error)
			};
		} finally {
			clearTimeout(timer);
		}
	}

	$effect(() => {
		load();
		let off: (() => void) | undefined;
		getBackend().then((backend) => (off = backend.events.on('entitlements', load)));
		return () => off?.();
	});
</script>

<main>
	<h1>Library</h1>
	<p class="muted">
		Proof of concept. Books and reading data are stored on this device only.
		{#if user}<span data-testid="signed-in-as">Signed in as {user.displayName}.</span>{/if}
	</p>

	<div aria-live="polite">
		{#if library.status === 'loading'}
			{#if showLoading}<p class="muted">Loading your library…</p>{/if}
		{:else if library.status === 'error'}
			<div class="problem" role="alert">
				{#if library.offline}
					<p>You’re offline, so your library can’t be refreshed. Books you’ve opened still work.</p>
				{:else}
					<p>Your library didn’t load: {library.message}</p>
				{/if}
				<button onclick={load}>Try again</button>
			</div>
		{:else if library.entries.length === 0}
			<p>Your library is empty. Import an EPUB or open the sample book.</p>
		{:else}
			<ul>
				{#each library.entries as entry (entry.book.id)}
					<li>
						<a href={resolve('/read/[bookId]', { bookId: entry.book.id })}>{entry.book.title}</a>
						<span class="muted">· {entry.book.creatorName}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if flags.devPanel}
		<p><a href={resolve('/dev')}>Developer panel</a></p>
	{/if}
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

	.problem {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	button {
		min-height: var(--touch-target);
		padding: 0 var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		cursor: pointer;
	}
</style>
