<script lang="ts">
	import type { ReaderPreferences } from '@book/core';
	import { Button, IconButton, Menu, SegmentedButton, Slider, Switch } from '@book/ui';
	import type { BookNarration } from './narration.svelte';
	import type { BookSpeech } from './speech.svelte';

	/**
	 * The narration player (P1-LAY-04, plan §6 Phase 1.5 UX notes): a mini-player docked at the
	 * bottom of the page once narration has started (play/pause, ±15 s, speed), expanding into
	 * full controls (position, previous and next sentence, highlighting, auto-turn, close).
	 *
	 * The device voice (P1-LAY-08, Phase 1.11) uses the same player, headed "Device voice" with the
	 * voice's name so it's never taken for a narrator's recording. A synthetic voice has no clock,
	 * so its mini-player skips by sentence instead of 15 s, and it adds the choice of voice.
	 */
	type NarrationPrefs = ReaderPreferences['narration'];

	type Source =
		| { kind: 'narration'; narration: BookNarration }
		| {
				kind: 'device';
				speech: BookSpeech;
				/** The Book's own narration, which the reader doesn't have: offered in the store. */
				storeHref?: string | null;
		  };

	interface Props {
		source: Source;
		prefs: NarrationPrefs;
		/** The speed: narration's, or the device voice's own (`deviceVoice.rate`). */
		rate: number;
		expanded: boolean;
		onchange: (patch: Partial<NarrationPrefs>) => void;
		onrate: (rate: number) => void;
		/** The reader chose a voice (device voice only). */
		onvoice?: (voiceId: string) => void;
		onclose: () => void;
	}

	let {
		source,
		prefs,
		rate,
		expanded = $bindable(),
		onchange,
		onrate,
		onvoice,
		onclose
	}: Props = $props();

	const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
	const rateLabel = (r: number) => `${r}×`;

	function clock(ms: number): string {
		const s = Math.max(0, Math.floor(ms / 1000));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const ss = String(s % 60).padStart(2, '0');
		return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
	}

	const narration = $derived(source.kind === 'narration' ? source.narration : null);
	const speech = $derived(source.kind === 'device' ? source.speech : null);
	const player = $derived(narration ?? speech!);
	const noun = $derived(narration ? 'narration' : 'the device voice');

	const title = $derived(
		narration
			? narration.current
				? narration.titleOf(narration.current.chapterId)
				: 'Narration'
			: speech?.chapterId
				? speech.titleOf(speech.chapterId)
				: 'Device voice'
	);
	const duration = $derived(
		narration ? narration.durationMs || narration.current?.durationMs || 0 : 0
	);
	/** The slider follows the audio, except while the reader is dragging it. */
	let dragging = $state<number | null>(null);

	const toggle = () => void (narration ? narration.toggle() : speech?.toggle());
</script>

<section
	class={['player', { expanded }]}
	aria-label={narration ? 'Narration' : 'Device voice'}
	data-testid="narration-player"
	data-kind={source.kind}
	data-playing={player.playing || undefined}
>
	{#if expanded}
		<div class="more" data-testid="narration-controls">
			{#if narration}
				<Slider
					label="Position in chapter"
					value={dragging ?? Math.min(narration.positionMs, duration)}
					min={0}
					max={Math.max(1, duration)}
					step={1000}
					format={(v) => `${clock(v)} of ${clock(duration)}`}
					oninput={(v) => (dragging = v)}
					onchange={(v) => {
						dragging = null;
						narration.seekTo(v);
					}}
				/>
			{/if}
			<div class="transport">
				<IconButton
					icon="skip_previous"
					label="Previous sentence"
					onclick={() => void player.sentence(-1)}
				/>
				{#if narration}
					<IconButton
						icon="fast_rewind"
						label="Back 15 seconds"
						onclick={() => narration.skip(-15_000)}
					/>
				{/if}
				<IconButton
					variant="filled"
					icon={player.playing ? 'pause' : 'play_arrow'}
					label={player.playing ? `Pause ${noun}` : `Play ${noun}`}
					onclick={toggle}
				/>
				{#if narration}
					<IconButton
						icon="fast_forward"
						label="Forward 15 seconds"
						onclick={() => narration.skip(15_000)}
					/>
				{/if}
				<IconButton
					icon="skip_next"
					label="Next sentence"
					onclick={() => void player.sentence(1)}
				/>
			</div>
			<SegmentedButton
				label="Highlight"
				value={prefs.highlight}
				options={[
					{ value: 'word', label: 'Word' },
					{ value: 'sentence', label: 'Sentence' },
					{ value: 'off', label: 'Off' }
				]}
				onchange={(highlight) => onchange({ highlight })}
			/>
			{#if speech && speech.bookVoices.length > 1}
				<div class="voice">
					<span>Voice: {speech.voice?.name}</span>
					<Menu
						label={`Voice, ${speech.voice?.name ?? 'default'}`}
						icon="record_voice_over"
						align="end"
						items={speech.bookVoices.map((v) => ({
							label: v.name,
							icon: v.id === speech.voice?.id ? 'check' : undefined,
							onselect: () => onvoice?.(v.id)
						}))}
					/>
				</div>
			{/if}
			{#if speech && prefs.highlight === 'word' && speech.playing && !speech.wordTiming}
				<p class="note">
					This voice doesn’t say where each word is, so its sentence is highlighted.
				</p>
			{/if}
			<Switch
				label={narration ? 'Turn pages with the narration' : 'Turn pages with the voice'}
				checked={prefs.autoTurn}
				onchange={(autoTurn) => onchange({ autoTurn })}
			/>
			{#if source.kind === 'device' && source.storeHref}
				<p class="note">
					This book has narration recorded by a person.
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved by the reader -->
					<a href={source.storeHref}>Get it in the store</a>
				</p>
			{/if}
			<div class="footer">
				<span class="credit"
					>{narration
						? narration.track?.credit
						: 'Read by your device’s own voice, not a recording.'}</span
				>
				<Button variant="text" icon="close" onclick={onclose}>Close player</Button>
			</div>
		</div>
	{/if}

	<div class="row">
		<IconButton
			variant="filled"
			icon={player.playing ? 'pause' : 'play_arrow'}
			label={player.playing ? `Pause ${noun}` : `Play ${noun}`}
			disabled={player.loading}
			onclick={toggle}
		/>
		<div class="titles">
			{#if narration}
				<span class="title">{title}</span>
				<span class="clock" data-testid="narration-clock"
					>{clock(narration.positionMs)} / {clock(duration)}</span
				>
			{:else}
				<span class="title" data-testid="device-voice-label"
					>Device voice{speech?.voice ? ` · ${speech.voice.name}` : ''}</span
				>
				<span class="clock">{title}</span>
			{/if}
		</div>
		{#if narration}
			<IconButton
				icon="fast_rewind"
				label="Back 15 seconds"
				onclick={() => narration.skip(-15_000)}
			/>
			<IconButton
				icon="fast_forward"
				label="Forward 15 seconds"
				onclick={() => narration.skip(15_000)}
			/>
		{:else if speech}
			<IconButton
				icon="skip_previous"
				label="Previous sentence"
				onclick={() => void speech.sentence(-1)}
			/>
			<IconButton icon="skip_next" label="Next sentence" onclick={() => void speech.sentence(1)} />
		{/if}
		<div class="speed">
			<Menu
				label={`Speed, ${rateLabel(rate)}`}
				icon="speed"
				align="end"
				items={RATES.map((r) => ({
					label: rateLabel(r),
					icon: r === rate ? 'check' : undefined,
					onselect: () => onrate(r)
				}))}
			/>
			<span class="rate" aria-hidden="true">{rateLabel(rate)}</span>
		</div>
		<IconButton
			icon={expanded ? 'keyboard_arrow_down' : 'keyboard_arrow_up'}
			label={expanded
				? `Fewer ${narration ? 'narration' : 'device voice'} controls`
				: `More ${narration ? 'narration' : 'device voice'} controls`}
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
		/>
	</div>
</section>

<style>
	.player {
		display: grid;
		gap: var(--space-2);
		width: min(640px, 100%);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--md-sys-shape-corner-extra-large);
		background: var(--md-sys-color-surface-container-high);
		color: var(--md-sys-color-on-surface);
		box-shadow: var(--md-sys-elevation-2);
	}

	.expanded {
		padding-top: var(--space-4);
		border-radius: var(--md-sys-shape-corner-large);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 48px;
	}

	.titles {
		display: grid;
		flex: 1;
		min-width: 0;
		padding-inline: var(--space-2);
	}

	.title,
	.clock {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title {
		font-size: var(--md-sys-typescale-label-large-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.clock,
	.rate {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
		font-variant-numeric: tabular-nums;
	}

	.speed {
		display: flex;
		align-items: center;
	}

	.rate {
		min-width: 2.6em;
	}

	.more {
		display: grid;
		gap: var(--space-3);
		padding-inline: var(--space-2);
	}

	.transport {
		display: flex;
		justify-content: center;
		gap: var(--space-2);
	}

	.voice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.note {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.note a {
		color: var(--md-sys-color-primary);
	}

	.footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.credit {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	/* On a phone the clock gives way to the controls. */
	@media (max-width: 380px) {
		.rate {
			display: none;
		}
	}
</style>
