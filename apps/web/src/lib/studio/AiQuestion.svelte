<script lang="ts">
	import type { AiUse } from '@book/core';
	import { RadioGroup } from '@book/ui';

	/**
	 * "Was AI used to make this?" (DESIGN.md §10.6, D-019), asked for every Book version,
	 * Illustration Pack and narration. The answer is shown to readers, who can hide AI-generated
	 * content. Nothing is chosen until the creator answers.
	 */
	interface Props {
		value: AiUse | null;
		onchange: (value: AiUse) => void;
		/** What "this" is, for the options' wording ("this version", "these pictures"). */
		what?: string;
	}

	let { value, onchange, what = 'this' }: Props = $props();
</script>

<RadioGroup
	label="Was AI used to make {what}?"
	value={value ?? ('' as AiUse)}
	{onchange}
	options={[
		{ value: 'none', label: 'No', description: 'Made without AI tools.' },
		{
			value: 'assisted',
			label: 'AI-assisted',
			description: 'AI helped (ideas, editing, clean-up), but a person made it.'
		},
		{
			value: 'generated',
			label: 'AI-generated',
			description: 'Mostly made by AI. Labelled for readers, who can choose to hide it.'
		}
	]}
/>
