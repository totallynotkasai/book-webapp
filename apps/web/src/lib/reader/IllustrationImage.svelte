<script lang="ts">
	import type { IllustrationDto } from '@book/core';
	import type { BookIllustrations } from './illustrations.svelte';

	/**
	 * One Illustration's image: its dominant colour at the right shape while the WebP variant
	 * that suits `width` loads through the pack's content token (§8.2, §10.3).
	 */
	interface Props {
		illustrations: BookIllustrations;
		packId: string;
		illustration: IllustrationDto;
		/** About how wide it will show, in CSS px. */
		width: number;
		fit?: 'contain' | 'cover';
		class?: string;
	}

	let {
		illustrations,
		packId,
		illustration,
		width,
		fit = 'contain',
		class: className
	}: Props = $props();

	let src = $state<string | null>(null);
	let loaded = $state(false);

	$effect(() => {
		const wanted = { packId, illustration, width };
		src = null;
		loaded = false;
		let cancelled = false;
		void illustrations
			.url(wanted.packId, wanted.illustration, wanted.width)
			.then((url) => {
				if (!cancelled) src = url;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});
</script>

<div
	class={['frame', fit, className]}
	style:aspect-ratio={`${illustration.image.width} / ${illustration.image.height}`}
	style:background-color={loaded ? 'transparent' : illustration.image.dominant}
>
	{#if src}
		<img
			{src}
			alt={illustration.alt}
			width={illustration.image.width}
			height={illustration.image.height}
			class:loaded
			onload={() => (loaded = true)}
			draggable="false"
		/>
	{:else}
		<span class="visually-hidden">{illustration.alt}</span>
	{/if}
</div>

<style>
	.frame {
		position: relative;
		max-width: 100%;
		max-height: 100%;
		overflow: hidden;
		border-radius: var(--md-sys-shape-corner-small);
		transition: background-color var(--duration-slow, 400ms) var(--easing-standard);
	}

	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		opacity: 0;
		transition: opacity var(--duration-slow, 400ms) var(--easing-standard);
	}

	.cover img {
		object-fit: cover;
	}

	img.loaded {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.frame,
		img {
			transition: none;
		}
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
