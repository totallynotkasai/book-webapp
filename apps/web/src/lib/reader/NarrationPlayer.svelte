<script lang="ts">
	import type { ReaderPreferences } from '@book/core';
	import { Button, IconButton, Menu, SegmentedButton, Slider, Switch } from '@book/ui';
	import type { BookNarration } from './narration.svelte';

	/**
	 * The narration player (P1-LAY-04, plan §6 Phase 1.5 UX notes): a mini-player docked at the
	 * bottom of the page once narration has started (play/pause, ±15 s, speed), expanding into
	 * full controls (position, previous and next sentence, highlighting, auto-turn, close).
	 */
	type NarrationPrefs = ReaderPreferences['narration'];

	interface Props {
		narration: BookNarration;
		prefs: NarrationPrefs;
		expanded: boolean;
		onchange: (patch: Partial<NarrationPrefs>) => void;
		onclose: () => void;
	}

	let { narration, prefs, expanded = $bindable(), onchange, onclose }: Props = $props();

	const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
	const rateLabel = (rate: number) => `${rate}×`;

	function clock(ms: number): string {
		const s = Math.max(0, Math.floor(ms / 1000));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const ss = String(s % 60).padStart(2, '0');
		return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
	}

	const title = $derived(
		narration.current ? narration.titleOf(narration.current.chapterId) : 'Narration'
	);
	const duration = $derived(narration.durationMs || narration.current?.durationMs || 0);
	/** The slider follows the audio, except while the reader is dragging it. */
	let dragging = $state<number | null>(null);
</script>

<section
	class={['player', { expanded }]}
	aria-label="Narration"
	data-testid="narration-player"
	data-playing={narration.playing || undefined}
>
	{#if expanded}
		<div class="more" data-testid="narration-controls">
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
			<div class="transport">
				<IconButton
					icon="skip_previous"
					label="Previous sentence"
					onclick={() => void narration.sentence(-1)}
				/>
				<IconButton
					icon="fast_rewind"
					label="Back 15 seconds"
					onclick={() => narration.skip(-15_000)}
				/>
				<IconButton
					variant="filled"
					icon={narration.playing ? 'pause' : 'play_arrow'}
					label={narration.playing ? 'Pause narration' : 'Play narration'}
					onclick={() => void narration.toggle()}
				/>
				<IconButton
					icon="fast_forward"
					label="Forward 15 seconds"
					onclick={() => narration.skip(15_000)}
				/>
				<IconButton
					icon="skip_next"
					label="Next sentence"
					onclick={() => void narration.sentence(1)}
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
			<Switch
				label="Turn pages with the narration"
				checked={prefs.autoTurn}
				onchange={(autoTurn) => onchange({ autoTurn })}
			/>
			<div class="footer">
				<span class="credit">{narration.track?.credit}</span>
				<Button variant="text" icon="close" onclick={onclose}>Close player</Button>
			</div>
		</div>
	{/if}

	<div class="row">
		<IconButton
			variant="filled"
			icon={narration.playing ? 'pause' : 'play_arrow'}
			label={narration.playing ? 'Pause narration' : 'Play narration'}
			disabled={narration.loading}
			onclick={() => void narration.toggle()}
		/>
		<div class="titles">
			<span class="title">{title}</span>
			<span class="clock" data-testid="narration-clock"
				>{clock(narration.positionMs)} / {clock(duration)}</span
			>
		</div>
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
		<div class="speed">
			<Menu
				label={`Speed, ${rateLabel(prefs.rate)}`}
				icon="speed"
				align="end"
				items={RATES.map((rate) => ({
					label: rateLabel(rate),
					icon: rate === prefs.rate ? 'check' : undefined,
					onselect: () => onchange({ rate })
				}))}
			/>
			<span class="rate" aria-hidden="true">{rateLabel(prefs.rate)}</span>
		</div>
		<IconButton
			icon={expanded ? 'keyboard_arrow_down' : 'keyboard_arrow_up'}
			label={expanded ? 'Fewer narration controls' : 'More narration controls'}
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

	.title {
		overflow: hidden;
		font-size: var(--md-sys-typescale-label-large-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		text-overflow: ellipsis;
		white-space: nowrap;
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
