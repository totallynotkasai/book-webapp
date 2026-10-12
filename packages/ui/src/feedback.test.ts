import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Progress from './Progress.svelte';
import Skeleton from './Skeleton.svelte';
import SnackbarHost from './SnackbarHost.svelte';

describe('SnackbarHost', () => {
	it('announces confirmations politely and errors assertively', () => {
		const { rerender, container } = render(SnackbarHost, {
			props: { snackbar: { id: 1, message: 'Added to library', tone: 'info' }, ondismiss: vi.fn() }
		});
		const polite = container.querySelector('[aria-live="polite"]');
		const assertive = container.querySelector('[aria-live="assertive"]');
		expect(polite).toHaveTextContent('Added to library');
		expect(assertive).toBeEmptyDOMElement();
		rerender({
			snackbar: { id: 2, message: 'You’re offline.', tone: 'error' },
			ondismiss: vi.fn()
		});
		expect(assertive).toHaveTextContent('You’re offline.');
		expect(polite).toBeEmptyDOMElement();
	});

	it('runs its action from the keyboard and dismisses', async () => {
		const user = userEvent.setup();
		const run = vi.fn();
		const ondismiss = vi.fn();
		render(SnackbarHost, {
			props: {
				snackbar: {
					id: 3,
					message: 'Highlight removed',
					tone: 'info',
					action: { label: 'Undo', run }
				},
				ondismiss
			}
		});
		await user.tab();
		expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
		await user.keyboard('{Enter}');
		expect(run).toHaveBeenCalledOnce();
		expect(ondismiss).toHaveBeenCalledWith(3);
	});

	it('holds its timeout while focused', async () => {
		const user = userEvent.setup();
		const onhold = vi.fn();
		const onrelease = vi.fn();
		render(SnackbarHost, {
			props: {
				snackbar: { id: 4, message: 'Saved', tone: 'info' },
				ondismiss: vi.fn(),
				onhold,
				onrelease
			}
		});
		await user.tab();
		expect(onhold).toHaveBeenCalled();
		await user.tab();
		expect(onrelease).toHaveBeenCalled();
	});
});

describe('Progress', () => {
	it('reports a known amount', () => {
		render(Progress, { props: { label: 'Importing book', value: 0.42 } });
		const bar = screen.getByRole('progressbar', { name: 'Importing book' });
		expect(bar).toHaveAttribute('aria-valuenow', '42');
	});

	it('leaves out the amount while unknown', () => {
		render(Progress, { props: { label: 'Loading', kind: 'circular' } });
		expect(screen.getByRole('progressbar', { name: 'Loading' })).not.toHaveAttribute(
			'aria-valuenow'
		);
	});
});

describe('Skeleton', () => {
	it('is hidden from screen readers', () => {
		render(Skeleton, { props: {} });
		expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true');
	});
});
