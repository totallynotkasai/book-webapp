<script lang="ts">
	import { asset } from '$app/paths';

	interface Props {
		title: string;
		creatorName?: string;
		/** A static path or URL; null draws a generated cover. */
		coverUrl: string | null;
		size?: 'small' | 'medium' | 'large';
	}

	let { title, creatorName, coverUrl, size = 'medium' }: Props = $props();

	// A stable tint per title for generated covers, so each Book is recognisable.
	const hue = $derived([...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
	const src = $derived(
		coverUrl && coverUrl.startsWith('/') ? asset(coverUrl as `/${string}`) : coverUrl
	);
</script>

<!-- Decorative: the title is always shown as text next to the cover. -->
<div class={['cover', size]} style:--hue={hue} aria-hidden="true">
	{#if src}
		<img {src} alt="" loading="lazy" decoding="async" />
	{:else}
		<span class="generated">
			<span class="title">{title}</span>
			{#if creatorName}<span class="creator">{creatorName}</span>{/if}
		</span>
	{/if}
</div>

<style>
	.cover {
		position: relative;
		overflow: hidden;
		aspect-ratio: 2 / 3;
		border-radius: var(--md-sys-shape-corner-small);
		background: var(--md-sys-color-surface-container-highest);
		box-shadow: var(--md-sys-elevation-1);
	}

	.small {
		width: 56px;
	}

	.medium {
		width: 100%;
	}

	.large {
		/* Small enough on a phone that the Book page's actions show without scrolling. */
		width: min(220px, 40vw);
	}

	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.generated {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		height: 100%;
		padding: 12%;
		background: linear-gradient(
			160deg,
			hsl(var(--hue) 45% 32%),
			hsl(calc(var(--hue) + 40) 50% 22%)
		);
		color: #fff;
		font-family: var(--font-literata);
	}

	.title {
		font-size: clamp(0.7rem, 9cqi, 1.25rem);
		line-height: 1.2;
		overflow-wrap: anywhere;
	}

	.creator {
		font-family: var(--font-ui);
		font-size: clamp(0.55rem, 6cqi, 0.8rem);
		opacity: 0.85;
	}

	.cover {
		container-type: inline-size;
	}

	.small .generated {
		padding: 8%;
	}

	.small .creator {
		display: none;
	}
</style>
