import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Checkbox from './Checkbox.svelte';
import RadioGroup from './RadioGroup.svelte';
import SegmentedButton from './SegmentedButton.svelte';
import Slider from './Slider.svelte';
import Switch from './Switch.svelte';
import TextField from './TextField.svelte';

const modes = [
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' },
	{ value: 'sepia', label: 'Sepia' }
] as const;

describe('SegmentedButton', () => {
	it('is one tab stop; arrows move between choices and Space picks one', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		render(SegmentedButton, {
			props: { options: modes, value: 'light', label: 'Theme', onchange }
		});
		expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
		await user.tab();
		expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus();
		await user.keyboard('{ArrowRight}');
		expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus();
		await user.keyboard(' ');
		expect(onchange).toHaveBeenCalledWith('dark');
		expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
	});

	it('never clears its choice', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		render(SegmentedButton, { props: { options: modes, value: 'dark', label: 'Theme', onchange } });
		await user.click(screen.getByRole('radio', { name: 'Dark' }));
		expect(onchange).not.toHaveBeenCalled();
		expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
	});
});

describe('Slider', () => {
	it('is labelled, reads its value, and moves with arrows, Home and End', async () => {
		const user = userEvent.setup();
		const oninput = vi.fn();
		render(Slider, {
			props: {
				label: 'Text size',
				value: 100,
				min: 75,
				max: 250,
				step: 5,
				format: (v: number) => `${v}%`,
				oninput
			}
		});
		const thumb = screen.getByRole('slider', { name: 'Text size' });
		expect(thumb).toHaveAttribute('aria-valuetext', '100%');
		await user.tab();
		expect(thumb).toHaveFocus();
		await user.keyboard('{ArrowRight}');
		expect(oninput).toHaveBeenLastCalledWith(105);
		await user.keyboard('{End}');
		expect(oninput).toHaveBeenLastCalledWith(250);
		await user.keyboard('{Home}');
		expect(oninput).toHaveBeenLastCalledWith(75);
	});
});

describe('Switch', () => {
	it('toggles with Space and with its label', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		render(Switch, {
			props: { label: 'This book only', checked: false, onchange, description: 'Override defaults' }
		});
		const control = screen.getByRole('switch', { name: 'This book only Override defaults' });
		await user.tab();
		expect(control).toHaveFocus();
		await user.keyboard(' ');
		expect(onchange).toHaveBeenLastCalledWith(true);
		await user.click(screen.getByText('This book only'));
		expect(onchange).toHaveBeenLastCalledWith(false);
	});
});

describe('Checkbox', () => {
	it('toggles with Space and is named by its label', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		render(Checkbox, { props: { label: 'Hide AI-generated content', checked: false, onchange } });
		await user.tab();
		const box = screen.getByRole('checkbox', { name: 'Hide AI-generated content' });
		expect(box).toHaveFocus();
		await user.keyboard(' ');
		expect(onchange).toHaveBeenCalledWith(true);
		expect(box).toHaveAttribute('aria-checked', 'true');
	});
});

describe('RadioGroup', () => {
	it('arrows move and select within one tab stop', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		render(RadioGroup, { props: { label: 'Mode', options: modes, value: 'light', onchange } });
		expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument();
		await user.tab();
		expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus();
		await user.keyboard('{ArrowDown}');
		expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus();
		expect(onchange).toHaveBeenCalledWith('dark');
	});
});

describe('TextField', () => {
	it('is named by its label and takes typing', async () => {
		const user = userEvent.setup();
		render(TextField, { props: { label: 'Note', value: '' } });
		await user.tab();
		const input = screen.getByRole('textbox', { name: 'Note' });
		expect(input).toHaveFocus();
		await user.keyboard('Curiouser');
		expect(input).toHaveValue('Curiouser');
	});

	it('announces an error and links it to the field', () => {
		render(TextField, {
			props: { label: 'Price', value: '-1', error: 'Enter a price of 0 or more.' }
		});
		const input = screen.getByRole('textbox', { name: 'Price' });
		expect(input).toHaveAttribute('aria-invalid', 'true');
		expect(input).toHaveAccessibleDescription('Enter a price of 0 or more.');
		expect(screen.getByRole('alert')).toHaveTextContent('Enter a price of 0 or more.');
	});

	it('can be multi-line', async () => {
		const user = userEvent.setup();
		render(TextField, { props: { label: 'Note', value: '', multiline: true } });
		await user.tab();
		await user.keyboard('One{Enter}Two');
		expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('One\nTwo');
	});
});
