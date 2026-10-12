<script lang="ts">
	import type { BookmarkDesignDto } from '@book/core';

	/**
	 * A Bookmark Design drawn as a ribbon (P1-STO-03): its shape, colour, accent and mark. The
	 * same drawing marks a Placed Bookmark on the page edge, in the shop and in You. Decorative:
	 * whoever shows it says what it is in text.
	 */
	interface Props {
		look: BookmarkDesignDto['look'];
		/** Height in px; the width follows. */
		size?: number;
		class?: string;
	}

	let { look, size = 44, class: className }: Props = $props();

	// Small marks in a 24-unit box, drawn in the accent colour.
	const MARKS: Record<Exclude<BookmarkDesignDto['look']['mark'], 'none'>, string> = {
		heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
		star: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z',
		flame:
			'M12 3c1 3.5 5 5.4 5 10a5 5 0 0 1-10 0c0-2.4 1.3-3.7 2.4-4.8.3 1.6 1 2.6 2 3C11 8.6 11 6 12 3z',
		key: 'M8 14a4 4 0 1 1 3.9-5H21v3h-2v2h-3v-2h-4.1A4 4 0 0 1 8 14zm0-2.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'
	};
</script>

<span
	class={['design', look.shape, className]}
	style:--ribbon-colour={look.colour}
	style:--ribbon-accent={look.accent}
	style:height={`${size}px`}
	style:width={`${Math.round(size / 2)}px`}
	aria-hidden="true"
>
	{#if look.shape === 'notched'}<span class="stripe"></span>{/if}
	{#if look.mark !== 'none'}
		<svg viewBox="0 0 24 24" class="mark"><path d={MARKS[look.mark]} /></svg>
	{/if}
</span>

<style>
	.design {
		position: relative;
		display: inline-grid;
		flex: none;
		justify-items: center;
		padding-top: 18%;
		background: var(--ribbon-colour);
		box-shadow: var(--md-sys-elevation-1);
	}

	.ribbon {
		clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%);
	}

	.notched {
		clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 86%, 0 100%);
	}

	.tab {
		border-radius: 0 0 6px 6px;
		background: linear-gradient(
			var(--ribbon-colour),
			var(--ribbon-colour) 70%,
			var(--ribbon-accent)
		);
	}

	.stripe {
		position: absolute;
		inset: 0 auto 0 50%;
		width: 3px;
		transform: translateX(-50%);
		background: var(--ribbon-accent);
	}

	.mark {
		position: relative;
		width: 60%;
		fill: var(--ribbon-accent);
	}
</style>
