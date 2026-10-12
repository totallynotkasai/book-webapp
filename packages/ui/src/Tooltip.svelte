<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		/** Plain text; a tooltip never holds the only copy of important information. */
		text: string;
		/** The trigger: spread `props` onto your button. */
		children: Snippet<[Record<string, unknown>]>;
		side?: 'top' | 'bottom' | 'left' | 'right';
	}

	let { text, children, side = 'bottom' }: Props = $props();
</script>

<Tooltip.Provider delayDuration={500}>
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				{@render children(props)}
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content {side} sideOffset={6}>
				{#snippet child({ props, wrapperProps })}
					<div {...wrapperProps} class="wrapper">
						<div {...props} role="tooltip" class="tooltip">{text}</div>
					</div>
				{/snippet}
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
</Tooltip.Provider>

<style>
	.wrapper {
		z-index: 60;
	}

	.tooltip {
		max-width: 240px;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--md-sys-shape-corner-extra-small);
		background: var(--md-sys-color-inverse-surface);
		color: var(--md-sys-color-inverse-on-surface);
		font-size: var(--md-sys-typescale-body-small-size);
		line-height: var(--md-sys-typescale-body-small-line-height);
		animation: fade-in var(--duration-fast) var(--easing-standard);
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}
</style>
