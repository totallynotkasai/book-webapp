import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AdaptiveSheet from './AdaptiveSheet.svelte';
import BottomSheet from './BottomSheet.svelte';
import Dialog from './Dialog.svelte';
import Menu from './Menu.svelte';
import SideSheet from './SideSheet.svelte';
import { text } from './test/snippet';
import TooltipHarness from './test/TooltipHarness.svelte';

describe('Dialog', () => {
	it('opens named and described, with focus inside, and closes on Esc', async () => {
		const user = userEvent.setup();
		const onclose = vi.fn();
		render(Dialog, {
			props: {
				open: true,
				title: 'Delete note?',
				description: 'This can’t be undone.',
				children: text('Body'),
				onclose
			}
		});
		const dialog = await screen.findByRole('dialog', { name: 'Delete note?' });
		expect(dialog).toHaveAccessibleDescription('This can’t be undone.');
		await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
		await user.keyboard('{Escape}');
		expect(onclose).toHaveBeenCalledOnce();
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
	});
});

describe.each([
	['BottomSheet', BottomSheet],
	['SideSheet', SideSheet],
	['AdaptiveSheet', AdaptiveSheet]
])('%s', (_name, Component) => {
	// Focus trapping needs real layout, so it is checked in Playwright (apps/web/e2e/components.spec.ts).
	it('is named by its title, closes on Esc and with its labelled close button', async () => {
		const user = userEvent.setup();
		const onclose = vi.fn();
		const { rerender } = render(Component, {
			props: { open: true, title: 'Reading preferences', children: text('Text size'), onclose }
		});
		await screen.findByRole('dialog', { name: 'Reading preferences' });
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
		await user.keyboard('{Escape}');
		expect(onclose).toHaveBeenCalledTimes(1);

		rerender({ open: true, title: 'Reading preferences', children: text('x'), onclose });
		await user.click(await screen.findByRole('button', { name: 'Close' }));
		expect(onclose).toHaveBeenCalledTimes(2);
	});
});

describe('BottomSheet swipe', () => {
	it('closes when dragged down far enough, and not for a small drag', async () => {
		const onclose = vi.fn();
		render(BottomSheet, {
			props: { open: true, title: 'Contents', children: text('Chapters'), onclose }
		});
		const sheet = await screen.findByRole('dialog', { name: 'Contents' });
		const header = sheet.querySelector('.header') as HTMLElement;
		const drag = (to: number) => {
			header.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, clientY: 100, button: 0 })
			);
			header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 100 + to }));
			header.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 100 + to }));
		};
		drag(20);
		expect(onclose).not.toHaveBeenCalled();
		drag(200);
		expect(onclose).toHaveBeenCalledOnce();
	});
});

describe('Menu', () => {
	// jsdom can't position the menu, so it stays visibility: hidden and its items have no computed name.
	const item = (label: string) => screen.getByText(label).closest('[role="menuitem"]');

	it('opens from the keyboard, moves with arrows, selects with Enter, returns focus', async () => {
		const user = userEvent.setup();
		const copy = vi.fn();
		const remove = vi.fn();
		render(Menu, {
			props: {
				label: 'More actions',
				items: [
					{ label: 'Copy', icon: 'content_copy', onselect: copy },
					'separator',
					{ label: 'Remove highlight', icon: 'delete', onselect: remove, danger: true }
				]
			}
		});
		const trigger = screen.getByRole('button', { name: 'More actions' });
		await user.tab();
		expect(trigger).toHaveFocus();
		await user.keyboard('{Enter}');
		const menu = await screen.findByRole('menu', { hidden: true });
		await waitFor(() => expect(item('Copy')).toHaveFocus());
		await user.keyboard('{ArrowDown}');
		expect(item('Remove highlight')).toHaveFocus();
		await user.keyboard('{Enter}');
		expect(remove).toHaveBeenCalledOnce();
		expect(copy).not.toHaveBeenCalled();
		await waitFor(() => expect(menu).not.toBeInTheDocument());
		await waitFor(() => expect(trigger).toHaveFocus());
	});

	it('closes on Esc without selecting', async () => {
		const user = userEvent.setup();
		const copy = vi.fn();
		render(Menu, { props: { label: 'More', items: [{ label: 'Copy', onselect: copy }] } });
		await user.tab();
		await user.keyboard('{Enter}');
		await screen.findByRole('menu', { hidden: true });
		await user.keyboard('{Escape}');
		await waitFor(() =>
			expect(screen.queryByRole('menu', { hidden: true })).not.toBeInTheDocument()
		);
		expect(copy).not.toHaveBeenCalled();
	});
});

describe('Tooltip', () => {
	it('describes its trigger when focused and hides on Esc', async () => {
		const user = userEvent.setup();
		render(TooltipHarness);
		await user.tab();
		const trigger = screen.getByRole('button', { name: 'Contents' });
		expect(trigger).toHaveFocus();
		// jsdom has no layout, so the positioned tooltip stays visibility: hidden; check it by its text.
		await waitFor(() => expect(trigger).toHaveAccessibleDescription('Table of contents'));
		await user.keyboard('{Escape}');
		await waitFor(() => expect(screen.queryByText('Table of contents')).not.toBeInTheDocument());
	});
});
