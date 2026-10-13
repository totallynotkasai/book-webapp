<script lang="ts">
	import { asset } from '$app/paths';
	import type { NarrationSampleDto } from '@book/core';
	import { Button } from '@book/ui';
	import { onDestroy } from 'svelte';
	import { getPlatform } from '$lib/platform';

	/**
	 * A Book page's narration sample (P1-STO-01): half a minute of the official narration, played
	 * only when the reader presses it (Invariant 11), through the same platform audio adapter as
	 * the reader's player.
	 */
	let { sample }: { sample: NarrationSampleDto } = $props();

	const audio = getPlatform().audio;
	let playing = $state(false);
	let loaded = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	const offs: (() => void)[] = [];

	const end = $derived(sample.startMs + sample.durationMs);
	const seconds = $derived(Math.round(sample.durationMs / 1000));

	async function toggle() {
		if (playing) {
			stop();
			return;
		}
		if (!loaded) {
			offs.push(
				audio.on('pause', () => (playing = audio.playing)),
				audio.on('play', () => (playing = true)),
				audio.on('ended', () => stop())
			);
			const url = sample.audioUrl.startsWith('/')
				? asset(sample.audioUrl as `/${string}`)
				: sample.audioUrl;
			await audio.load(
				[{ src: url, title: `${sample.chapterTitle} (sample)` }],
				{ artist: sample.track.narrator, album: sample.track.name },
				{ index: 0, positionMs: sample.startMs }
			);
			loaded = true;
		} else {
			audio.seek(sample.startMs);
		}
		try {
			await audio.play();
			playing = true;
		} catch {
			playing = false;
		}
		clearInterval(timer);
		timer = setInterval(() => {
			if (audio.positionMs >= end) stop();
		}, 250);
	}

	function stop() {
		clearInterval(timer);
		audio.pause();
		playing = false;
	}

	onDestroy(() => {
		clearInterval(timer);
		for (const off of offs) off();
		if (loaded) audio.unload();
	});
</script>

<div class="sample" data-testid="narration-sample" data-playing={playing || undefined}>
	<Button variant="tonal" icon={playing ? 'pause' : 'headphones'} onclick={toggle}>
		{playing ? 'Stop the sample' : `Listen to a sample (${seconds} s)`}
	</Button>
	<span class="what">{sample.chapterTitle} · read by {sample.track.narrator}</span>
</div>

<style>
	.sample {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}

	.what {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}
</style>
