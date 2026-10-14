<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Icon, NavigationBar, NavigationRail, type NavItem } from '@book/ui';
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import Welcome from '$lib/components/Welcome.svelte';
	import { flags } from '$lib/flags';
	import { session } from '$lib/state/session.svelte';
	import { welcome } from '$lib/state/welcome.svelte';

	let { children } = $props();

	// The first-run welcome (P1-QA-03), once per device.
	onMount(() => welcome.start());

	// M3 window classes (DESIGN.md §11.5): a bottom bar on compact screens, a rail from 600 px.
	const wide = new MediaQuery('min-width: 600px');

	// The app's base path, for matching the current page against each destination.
	const root = resolve('/').replace(/\/$/, '');
	const path = $derived(page.url.pathname);
	const under = (...prefixes: string[]) =>
		prefixes.some((p) => path === p || path.startsWith(`${p}/`));

	// Destinations (IMPLEMENTATION-PLAN.md §5.1). Book pages and Creator profiles belong to the
	// Store; Settings, Admin and the dev panel to You. Studio appears only for Creators.
	const items = $derived.by(() => {
		const list: NavItem[] = [
			{
				href: resolve('/library'),
				label: 'Library',
				icon: 'library_books',
				activeIcon: 'library_books-fill',
				active: under(resolve('/library'))
			}
		];
		if (flags.store) {
			list.push({
				href: resolve('/store'),
				label: 'Store',
				icon: 'storefront',
				activeIcon: 'storefront-fill',
				active: under(`${root}/store`, `${root}/book`, `${root}/creator`)
			});
		}
		if (flags.studio && session.canUseStudio) {
			list.push({
				href: resolve('/studio'),
				label: 'Studio',
				icon: 'edit_note',
				activeIcon: 'edit_note-fill',
				active: under(resolve('/studio'))
			});
		}
		list.push({
			href: resolve('/you'),
			label: 'You',
			icon: 'person',
			activeIcon: 'person-fill',
			active: under(resolve('/you'), resolve('/admin'), resolve('/dev'))
		});
		return list;
	});
</script>

<a class="skip-link" href="#main">Skip to content</a>

<div class={['shell', { wide: wide.current }]}>
	{#if wide.current}
		<NavigationRail {items}>
			{#snippet header()}
				<a class="mark" href={resolve('/library')} aria-label="Book Reader, Library">
					<Icon name="auto_stories" size={28} />
				</a>
			{/snippet}
		</NavigationRail>
	{/if}

	<main id="main" tabindex="-1">
		{@render children()}
	</main>

	{#if !wide.current}
		<div class="bar"><NavigationBar {items} /></div>
	{/if}
</div>

<Welcome />

<style>
	.shell {
		min-height: 100dvh;
		/* Snackbars sit above the bottom bar on compact screens. */
		--snackbar-offset: 80px;
	}

	.shell.wide {
		display: grid;
		grid-template-columns: auto 1fr;
		--snackbar-offset: 0px;
	}

	.shell.wide :global(nav.rail) {
		position: sticky;
		top: 0;
		height: 100dvh;
	}

	main {
		min-width: 0;
		padding: calc(var(--space-5) + var(--safe-top)) calc(var(--space-4) + var(--safe-right))
			calc(80px + var(--space-6) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
		outline: none;
	}

	.wide main {
		padding: calc(var(--space-6) + var(--safe-top)) calc(var(--space-6) + var(--safe-right))
			calc(var(--space-7) + var(--safe-bottom)) var(--space-6);
	}

	main > :global(*) {
		max-width: 1200px;
		margin-inline: auto;
	}

	.bar {
		position: fixed;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 30;
	}

	.mark {
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: var(--md-sys-shape-corner-large);
		background: var(--md-sys-color-primary-container);
		color: var(--md-sys-color-on-primary-container);
	}

	.mark:focus-visible {
		outline: 3px solid var(--md-sys-color-secondary);
		outline-offset: 2px;
	}

	.skip-link {
		position: fixed;
		top: calc(var(--space-2) + var(--safe-top));
		left: var(--space-2);
		z-index: 100;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--md-sys-shape-corner-full);
		background: var(--md-sys-color-primary);
		color: var(--md-sys-color-on-primary);
		transform: translateY(-200%);
	}

	.skip-link:focus {
		transform: none;
	}
</style>
