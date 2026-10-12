<script lang="ts">
	import { ICON_VIEWBOX, iconPaths, type IconName } from './icons';

	interface Props {
		name: IconName;
		/** CSS size; defaults to 24 px. */
		size?: number | string;
		/** Give a label only when the icon carries meaning on its own; otherwise it's hidden. */
		label?: string;
		class?: string;
	}

	let { name, size = 24, label, class: className }: Props = $props();
	const dimension = $derived(typeof size === 'number' ? `${size}px` : size);
</script>

<svg
	class={['icon', className]}
	viewBox={ICON_VIEWBOX}
	style:width={dimension}
	style:height={dimension}
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<path d={iconPaths[name]} />
</svg>

<style>
	.icon {
		flex: none;
		fill: currentColor;
	}
</style>
