<script lang="ts">
	import type { IllustrationPreviewDto } from '@book/core';
	import { Skeleton } from '@book/ui';
	import { onDestroy } from 'svelte';
	import { getBackend } from '$lib/services';

	/**
	 * A Book page's Illustration previews (P1-STO-01): only those the creator marked spoiler-safe
	 * (Invariant 6), read under a token that opens nothing else.
	 */
	let { bookId }: { bookId: string } = $props();

	interface Shown {
		preview: IllustrationPreviewDto;
		url: string;
	}
	let shown = $state.raw<Shown[] | null>(null);
	const urls: string[] = [];
	let destroyed = false;

	$effect(() => {
		void load(bookId);
	});

	async function load(id: string) {
		try {
			const backend = await getBackend();
			const previews = await backend.layers.previews(id);
			const want = 360 * (globalThis.devicePixelRatio || 1);
			const items = await Promise.all(
				previews.illustrations.slice(0, 8).map(async (preview) => {
					const variants = preview.image.variants;
					const variant = variants.find((v) => v.width >= want) ?? variants.at(-1)!;
					const blob = await backend.content.read(previews.contentToken, variant.path);
					const url = URL.createObjectURL(blob);
					urls.push(url);
					return { preview, url };
				})
			);
			if (!destroyed) shown = items;
		} catch (error) {
			// Previews are extra; the page works without them.
			console.warn('Previews didn’t load', error);
			if (!destroyed) shown = [];
		}
	}

	onDestroy(() => {
		destroyed = true;
		for (const url of urls) URL.revokeObjectURL(url);
	});
</script>

{#if shown === null}
	<div class="strip" aria-hidden="true">
		{#each [0, 1, 2] as i (i)}<Skeleton shape="block" width="10rem" height="13rem" />{/each}
	</div>
{:else if shown.length}
	<ul class="strip" aria-label="Pictures from this book" data-testid="illustration-previews">
		{#each shown as { preview, url } (preview.id)}
			<li>
				<figure>
					<img
						src={url}
						alt={preview.alt}
						width={preview.image.width}
						height={preview.image.height}
						style:background-color={preview.image.dominant}
						loading="lazy"
					/>
					<figcaption>{preview.caption ?? preview.packName}</figcaption>
				</figure>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.strip {
		display: flex;
		gap: var(--space-3);
		margin: 0;
		padding: 0 0 var(--space-2);
		overflow-x: auto;
		list-style: none;
		scroll-snap-type: x proximity;
	}

	.strip li {
		flex: none;
		scroll-snap-align: start;
	}

	figure {
		display: grid;
		gap: var(--space-1);
		width: 10rem;
		margin: 0;
	}

	img {
		width: 100%;
		height: 13rem;
		border-radius: var(--md-sys-shape-corner-medium);
		object-fit: cover;
	}

	figcaption {
		overflow: hidden;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
