<script lang="ts">
	interface Props {
		width?: string;
		height?: string;
		/** `text` lines get rounded ends; `block` for covers and cards. */
		shape?: 'text' | 'block' | 'circle';
		class?: string;
	}

	let { width = '100%', height = '1em', shape = 'text', class: className }: Props = $props();
</script>

<!-- A loading placeholder. Hidden from screen readers: the screen says "Loading…" once instead. -->
<span
	class={['skeleton', shape, className]}
	style:width
	style:height
	aria-hidden="true"
	data-testid="skeleton"
></span>

<style>
	.skeleton {
		display: block;
		background: linear-gradient(
			90deg,
			var(--md-sys-color-surface-container-high) 0%,
			var(--md-sys-color-surface-container-highest) 50%,
			var(--md-sys-color-surface-container-high) 100%
		);
		background-size: 200% 100%;
		animation: shimmer calc(var(--duration-slow) * 3) linear infinite;
	}

	.text {
		border-radius: var(--md-sys-shape-corner-extra-small);
	}

	.block {
		border-radius: var(--md-sys-shape-corner-medium);
	}

	.circle {
		border-radius: 50%;
	}

	@keyframes shimmer {
		from {
			background-position: 100% 0;
		}
		to {
			background-position: -100% 0;
		}
	}
</style>
