import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Badge from './Badge.svelte';
import Button from './Button.svelte';
import Card from './Card.svelte';
import Chip from './Chip.svelte';
import Icon from './Icon.svelte';
import IconButton from './IconButton.svelte';
import { text } from './test/snippet';

describe('Button', () => {
	it('is reachable by Tab and activates with Enter and Space', async () => {
		const user = userEvent.setup();
		const onclick = vi.fn();
		render(Button, { props: { children: text('Add to library'), onclick } });
		await user.tab();
		const button = screen.getByRole('button', { name: 'Add to library' });
		expect(button).toHaveFocus();
		await user.keyboard('{Enter}');
		await user.keyboard(' ');
		expect(onclick).toHaveBeenCalledTimes(2);
	});

	it('stays focusable but ignores presses while pending', async () => {
		const user = userEvent.setup();
		const onclick = vi.fn();
		render(Button, { props: { children: text('Buy'), onclick, pending: true } });
		const button = screen.getByRole('button', { name: /Buy/ });
		expect(button).toHaveAttribute('aria-busy', 'true');
		await user.tab();
		expect(button).toHaveFocus();
		await user.keyboard('{Enter}');
		await user.click(button);
		expect(onclick).not.toHaveBeenCalled();
		expect(screen.getByRole('progressbar', { name: 'Working' })).toBeInTheDocument();
	});

	it('renders a link when given href', () => {
		render(Button, { props: { children: text('Read now'), href: '/read/alice' } });
		expect(screen.getByRole('link', { name: 'Read now' })).toHaveAttribute('href', '/read/alice');
	});

	it('is skipped by Tab when disabled', async () => {
		const user = userEvent.setup();
		render(Button, { props: { children: text('Publish'), disabled: true } });
		await user.tab();
		expect(document.body).toHaveFocus();
	});
});

describe('IconButton', () => {
	it('has an accessible name and works from the keyboard', async () => {
		const user = userEvent.setup();
		const onclick = vi.fn();
		render(IconButton, { props: { icon: 'toc', label: 'Contents', onclick } });
		await user.tab();
		expect(screen.getByRole('button', { name: 'Contents' })).toHaveFocus();
		await user.keyboard('{Enter}');
		expect(onclick).toHaveBeenCalledOnce();
	});

	it('reports a toggle state with aria-pressed', () => {
		const { rerender } = render(IconButton, {
			props: { icon: 'bookmark', label: 'Bookmark this page', selected: false }
		});
		const button = screen.getByRole('button', { name: 'Bookmark this page' });
		expect(button).toHaveAttribute('aria-pressed', 'false');
		rerender({ icon: 'bookmark', label: 'Bookmark this page', selected: true });
		expect(button).toHaveAttribute('aria-pressed', 'true');
	});
});

describe('Chip', () => {
	it('filter chips toggle aria-pressed from the keyboard', async () => {
		const user = userEvent.setup();
		const onclick = vi.fn();
		render(Chip, { props: { label: 'Yellow', kind: 'filter', selected: false, onclick } });
		await user.tab();
		const chip = screen.getByRole('button', { name: 'Yellow' });
		expect(chip).toHaveFocus();
		expect(chip).toHaveAttribute('aria-pressed', 'false');
		await user.keyboard(' ');
		expect(onclick).toHaveBeenCalledOnce();
	});

	it('input chips have a labelled remove button next in tab order', async () => {
		const user = userEvent.setup();
		const onremove = vi.fn();
		render(Chip, { props: { label: 'Fantasy', kind: 'input', onremove } });
		await user.tab();
		await user.tab();
		expect(screen.getByRole('button', { name: 'Remove Fantasy' })).toHaveFocus();
		await user.keyboard('{Enter}');
		expect(onremove).toHaveBeenCalledOnce();
	});
});

describe('Card', () => {
	it('a link card is one focusable link', async () => {
		const user = userEvent.setup();
		render(Card, { props: { href: '/book/alice', children: text('Alice') } });
		await user.tab();
		expect(screen.getByRole('link', { name: 'Alice' })).toHaveFocus();
	});

	it('a plain card is not focusable', async () => {
		const user = userEvent.setup();
		render(Card, { props: { children: text('Stats') } });
		await user.tab();
		expect(document.body).toHaveFocus();
	});
});

describe('Icon and Badge', () => {
	it('hides decorative icons and names meaningful ones', () => {
		const { container } = render(Icon, { props: { name: 'bookmark' } });
		expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
		render(Icon, { props: { name: 'verified', label: 'Official' } });
		expect(screen.getByRole('img', { name: 'Official' })).toBeInTheDocument();
	});

	it('renders its label text', () => {
		render(Badge, { props: { tone: 'simulated', children: text('Simulated') } });
		expect(screen.getByText('Simulated')).toBeInTheDocument();
	});
});
