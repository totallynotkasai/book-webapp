<script lang="ts">
	import { resolve } from '$app/paths';
	import type { InboxMessageDto } from '@book/core';
	import { Badge, Skeleton } from '@book/ui';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { formatDate } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';

	// The in-app inbox (plan §4.7; P1-ADM-02): moderation outcomes and how to appeal, community
	// submissions waiting for an author, authors' decisions, and new Chapters of the serials of
	// authors the reader follows (P1-STU-06). No email or push in the PoC.
	const messages = resource(async () => (await getBackend()).inbox.list(), {
		topics: ['inbox', 'session']
	});

	// Opening the inbox reads what's in it.
	$effect(() => {
		const unread = messages.data?.filter((m) => !m.read) ?? [];
		if (!unread.length) return;
		void (async () => {
			const inbox = (await getBackend()).inbox;
			for (const m of unread) await inbox.markRead(m.id).catch(() => {});
		})();
	});

	/**
	 * Where a message's subject is: a new Chapter in the reader; otherwise where it's looked after,
	 * the Studio.
	 */
	function linkOf(message: InboxMessageDto): { href: string; label: string } | null {
		if (!message.about) return null;
		if (message.about.type === 'chapter') {
			const reader = resolve('/read/[bookId]', { bookId: message.about.id });
			const chapter = message.about.chapterId
				? `?chapter=${encodeURIComponent(message.about.chapterId)}`
				: '';
			return { href: `${reader}${chapter}`, label: 'Read it' };
		}
		const href = studioLinkOf(message.about);
		return { href, label: 'Open in your Studio' };
	}

	function studioLinkOf(about: NonNullable<InboxMessageDto['about']>): string {
		if (about.type === 'book') {
			return resolve('/(app)/studio/books/[bookId]', { bookId: about.id });
		}
		if (about.type === 'audio_track') {
			return resolve('/(app)/studio/tracks/[trackId]', { trackId: about.id });
		}
		return resolve('/(app)/studio');
	}
</script>

<svelte:head><title>Inbox · Book Reader</title></svelte:head>

<div class="page">
	<PageHeader title="Inbox" back={{ href: resolve('/you'), label: 'Back to You' }}>
		<Badge tone="simulated" icon="science">Simulated: messages stay on this device</Badge>
	</PageHeader>

	<StatusView resource={messages} what="Your inbox">
		{#snippet loading()}<Skeleton height="5rem" shape="block" />{/snippet}
		{#snippet empty()}
			<EmptyState
				icon="inbox"
				title="Nothing here yet"
				message="News about your books, illustrations and narration, and new chapters from authors you follow, will arrive here."
			/>
		{/snippet}
		{#snippet children(list)}
			<ul class="messages">
				{#each list as message (message.id)}
					{@const link = linkOf(message)}
					<li data-testid="inbox-message" class={{ unread: !message.read }}>
						<span class="title">
							{#if !message.read}<span class="dot" aria-label="New"></span>{/if}
							{message.title}
						</span>
						<p class="body">{message.body}</p>
						<span class="meta">
							{formatDate(message.createdAt)}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- linkOf resolves -->
							{#if link}· <a href={link.href}>{link.label}</a>{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/snippet}
	</StatusView>
</div>

<style>
	.page {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		max-width: 44rem;
	}

	.messages {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.messages li {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.messages li.unread {
		background: var(--md-sys-color-secondary-container);
		color: var(--md-sys-color-on-secondary-container);
	}

	.title {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--md-sys-color-primary);
	}

	.body {
		margin: 0;
	}

	.meta {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.unread .meta {
		color: inherit;
	}
</style>
