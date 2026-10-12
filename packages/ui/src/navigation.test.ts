import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import NavigationBar from './NavigationBar.svelte';
import NavigationRail from './NavigationRail.svelte';
import Tabs from './Tabs.svelte';
import type { NavItem } from './types';

const items: NavItem[] = [
	{ href: '/library', label: 'Library', icon: 'library_books', active: true },
	{ href: '/store', label: 'Store', icon: 'storefront', active: false },
	{ href: '/you', label: 'You', icon: 'person', active: false }
];

describe.each([
	['NavigationBar', NavigationBar],
	['NavigationRail', NavigationRail]
])('%s', (_name, Component) => {
	it('is a named landmark whose links are in tab order, marking the current page', async () => {
		const user = userEvent.setup();
		render(Component, { props: { items } });
		expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
		const library = screen.getByRole('link', { name: 'Library' });
		expect(library).toHaveAttribute('aria-current', 'page');
		expect(screen.getByRole('link', { name: 'Store' })).not.toHaveAttribute('aria-current');
		await user.tab();
		expect(library).toHaveFocus();
		await user.tab();
		expect(screen.getByRole('link', { name: 'Store' })).toHaveFocus();
	});
});

describe('Tabs', () => {
	const panel = createRawSnippet((value: () => string) => ({
		render: () => `<p>Panel ${value()}</p>`
	}));

	it('is one tab stop; arrows switch tabs and show their panel', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		render(Tabs, {
			props: {
				label: 'Reading preferences',
				items: [
					{ value: 'text', label: 'Text' },
					{ value: 'page', label: 'Page' },
					{ value: 'theme', label: 'Theme' }
				],
				value: 'text',
				panel,
				onchange
			}
		});
		expect(screen.getByRole('tablist', { name: 'Reading preferences' })).toBeInTheDocument();
		expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel text');
		await user.tab();
		expect(screen.getByRole('tab', { name: 'Text' })).toHaveFocus();
		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('tab', { name: 'Page' })).toHaveFocus();
		expect(onchange).toHaveBeenCalledWith('page');
		expect(screen.getByRole('tab', { name: 'Page' })).toHaveAttribute('aria-selected', 'true');
		expect(await screen.findByText('Panel page')).toBeInTheDocument();
	});
});
