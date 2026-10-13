<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge, Icon, type IconName } from '@book/ui';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { flags } from '$lib/flags';
	import { roleLabels } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';
	import { session } from '$lib/state/session.svelte';

	// P1-APP-01: profile and the way into everything personal (IMPLEMENTATION-PLAN.md §5.1).
	interface Entry {
		label: string;
		description: string;
		icon: IconName;
		href?: string;
		/** Not built yet: shown so the shape of the product is visible, with its phase. */
		phase?: string;
		show: boolean;
	}

	// Moderation outcomes, submissions and decisions (P1-ADM-02): how many are new.
	const inbox = resource(async () => (await getBackend()).inbox.list(), {
		topics: ['inbox', 'session']
	});
	const unread = $derived(inbox.data?.filter((m) => !m.read).length ?? 0);

	const entries = $derived<Entry[]>([
		{
			label: 'Inbox',
			description: unread
				? `${unread} new ${unread === 1 ? 'message' : 'messages'}`
				: 'News about your books, illustrations and narration',
			icon: 'inbox',
			href: resolve('/you/inbox'),
			show: flags.studio || flags.community || flags.admin
		},
		{
			label: 'Settings',
			description: 'Appearance, reading defaults and accessibility',
			icon: 'settings',
			href: resolve('/you/settings'),
			show: true
		},
		{
			label: 'Purchases and subscriptions',
			description: 'Books, add-ons, Tips and Creator Subscriptions',
			icon: 'shopping_bag',
			href: resolve('/you/purchases'),
			show: flags.store
		},
		{
			label: 'Bookmark designs',
			description: 'The look of your bookmarks, in every book',
			icon: 'bookmark',
			href: resolve('/you/bookmarks'),
			show: flags.store
		},
		{
			label: 'Your data',
			description: 'What’s stored on this device; export or delete it',
			icon: 'download',
			href: resolve('/you/data'),
			show: true
		},
		{
			label: 'Review queue',
			description: 'Flags and reports to review',
			icon: 'admin_panel_settings',
			href: resolve('/admin'),
			show: flags.admin && session.canModerate
		},
		{
			label: 'Moderation log',
			description: 'Every action moderators have taken, with its reason',
			icon: 'gavel',
			href: resolve('/admin/log'),
			show: flags.admin && session.canModerate
		},
		{
			label: 'Developer panel',
			description: 'Personas and simulation controls (owner builds only)',
			icon: 'science',
			href: resolve('/dev'),
			show: flags.devPanel
		}
	]);
</script>

<svelte:head><title>You · Book Reader</title></svelte:head>

<div>
	<PageHeader title="You">
		{#if session.user}
			<p class="who">
				<span data-testid="signed-in-as">Signed in as {session.user.displayName}.</span>
				<Badge>{roleLabels[session.user.role]}</Badge>
			</p>
		{/if}
	</PageHeader>

	<ul class="entries">
		{#each entries.filter((e) => e.show) as entry (entry.label)}
			<li>
				{#if entry.href}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- entries hold resolved hrefs -->
					<a class="entry" href={entry.href}>
						<Icon name={entry.icon} />
						<span class="text">
							<span class="label">{entry.label}</span>
							<span class="description">{entry.description}</span>
						</span>
						<Icon name="chevron_right" />
					</a>
				{:else}
					<div class="entry soon" aria-disabled="true">
						<Icon name={entry.icon} />
						<span class="text">
							<span class="label">{entry.label}</span>
							<span class="description">{entry.description}</span>
						</span>
						<Badge>Phase {entry.phase}</Badge>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
</div>

<style>
	.who {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-2) 0 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.entries {
		max-width: 40rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entry {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-height: 72px;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		color: var(--md-sys-color-on-surface);
		text-decoration: none;
	}

	a.entry:hover {
		background: color-mix(in srgb, var(--md-sys-color-on-surface) 6%, transparent);
	}

	a.entry:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: -3px;
	}

	.entry > :global(svg) {
		color: var(--md-sys-color-on-surface-variant);
	}

	.soon {
		color: color-mix(in srgb, var(--md-sys-color-on-surface) 60%, transparent);
	}

	.text {
		display: grid;
		flex: 1;
		gap: 2px;
	}

	.label {
		font-size: var(--md-sys-typescale-body-large-size);
	}

	.description {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-medium-size);
	}
</style>
