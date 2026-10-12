<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PersonaDto } from '@book/core';
	import { featureFlags, flags, profile } from '$lib/flags';
	import ImportDialog from '$lib/library/ImportDialog.svelte';
	// Test books for the Phase 1.2 Try-it list, bundled as files (never inlined).
	import statusWindowUrl from '../../../../../../fixtures/epub/status-window.epub?url';
	import rackhamUrl from '../../../../../../fixtures/epub/alice-rackham-gutenberg.epub?url';
	import {
		getDevControls,
		wipeDeviceData,
		type DevControls,
		type SimulationSettings
	} from '$lib/services';

	// The owner's dev panel (P0-09). It talks to backend-local's controls directly, never through
	// the simulated Backend, so it keeps working at a 100% failure rate or offline.
	const DAY = 86_400_000;

	let controls = $state<DevControls>();
	let personas = $state<PersonaDto[]>([]);
	let currentUserId = $state('');
	let simulation = $state<SimulationSettings>();
	let now = $state(new Date());
	let busy = $state(false);
	/** Changes save to IndexedDB asynchronously; say when they have landed. */
	let saving = $state(0);
	let saved = $state(false);

	async function refresh() {
		controls ??= await getDevControls();
		personas = await controls.personas();
		currentUserId = controls.currentUserId();
		simulation = { ...controls.simulation() };
		now = controls.clock.now();
	}

	$effect(() => {
		refresh();
	});

	async function update(changes: Partial<SimulationSettings>) {
		if (!controls) return;
		saving++;
		try {
			simulation = { ...(await controls.setSimulation(changes)) };
			now = controls.clock.now();
		} finally {
			saving--;
			saved = saving === 0;
		}
	}

	async function switchPersona(persona: PersonaDto) {
		if (!controls || persona.user.id === currentUserId) return;
		busy = true;
		await controls.switchPersona(persona.id);
		// Reload so every screen and the per-Persona Stores open as the new user.
		location.reload();
	}

	async function advance(ms: number) {
		await controls?.advanceClock(ms);
		await refresh();
	}

	async function resetDemoData() {
		if (!controls || !confirm('Reset the demo store, Personas and clock to the seed?')) return;
		busy = true;
		await controls.resetDemoData();
		location.reload();
	}

	async function wipe() {
		if (
			!confirm(
				'Delete everything stored on this device: every Persona’s notes, progress and preferences, and the demo store?'
			)
		) {
			return;
		}
		busy = true;
		await wipeDeviceData();
		location.assign(resolve('/'));
	}

	let importer = $state<ImportDialog>();
	async function importTestBook(name: string, url: string) {
		const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
		await importer?.run(name, bytes);
	}

	const percent = (rate: number) => Math.round(rate * 100);
	const formatted = (date: Date) =>
		date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<div class="dev">
	<p><a href={resolve('/you')}>← You</a></p>
	<h1>Developer panel</h1>
	<p class="muted">
		Owner builds only. Everything here is <strong>simulated</strong>: no real accounts, servers or
		money. Profile: <code>{profile}</code>.
	</p>

	<section aria-labelledby="persona-heading">
		<h2 id="persona-heading">Persona</h2>
		<p class="muted">Each Persona has its own notes, progress and preferences on this device.</p>
		<div class="personas" role="radiogroup" aria-label="Signed in as">
			{#each personas as persona (persona.id)}
				<label class="persona">
					<input
						type="radio"
						name="persona"
						value={persona.id}
						checked={persona.user.id === currentUserId}
						disabled={busy}
						onchange={() => switchPersona(persona)}
					/>
					<span>
						<strong>{persona.label}</strong> · {persona.user.displayName}
						<span class="muted block">{persona.description}</span>
					</span>
				</label>
			{/each}
		</div>
	</section>

	{#if simulation}
		<p class="muted" role="status" data-testid="simulation-status">
			{saving > 0 ? 'Saving…' : saved ? 'Saved' : ''}
		</p>

		<section aria-labelledby="network-heading">
			<h2 id="network-heading">Network</h2>
			<div class="row">
				<label>
					Latency from (ms)
					<input
						type="number"
						min="0"
						step="50"
						value={simulation.latencyMs.min}
						onchange={(e) => {
							const min = Math.max(0, e.currentTarget.valueAsNumber || 0);
							update({ latencyMs: { min, max: Math.max(min, simulation!.latencyMs.max) } });
						}}
					/>
				</label>
				<label>
					to (ms)
					<input
						type="number"
						min="0"
						step="50"
						value={simulation.latencyMs.max}
						onchange={(e) => {
							const max = Math.max(0, e.currentTarget.valueAsNumber || 0);
							update({ latencyMs: { min: Math.min(max, simulation!.latencyMs.min), max } });
						}}
					/>
				</label>
			</div>
			<!-- <output> is labelable too, so it sits outside the <label> or it would take its name. -->
			<div class="stack">
				<label for="failure-rate">Failure rate</label>
				<output for="failure-rate">{percent(simulation.failureRate)}%</output>
				<input
					id="failure-rate"
					type="range"
					min="0"
					max="100"
					step="5"
					value={percent(simulation.failureRate)}
					aria-valuetext="{percent(simulation.failureRate)}%"
					onchange={(e) => update({ failureRate: e.currentTarget.valueAsNumber / 100 })}
				/>
			</div>
			<label class="check">
				<input
					type="checkbox"
					checked={simulation.offline}
					onchange={(e) => update({ offline: e.currentTarget.checked })}
				/>
				Offline
			</label>
			<label class="check">
				<input
					type="checkbox"
					checked={simulation.emptyLists}
					onchange={(e) => update({ emptyLists: e.currentTarget.checked })}
				/>
				Empty lists (try every screen's empty state)
			</label>
		</section>

		<section aria-labelledby="outcomes-heading">
			<h2 id="outcomes-heading">Outcomes</h2>
			<div class="row">
				<label>
					Payment outcome
					<select
						value={simulation.paymentOutcome}
						onchange={(e) =>
							update({
								paymentOutcome: e.currentTarget.value as SimulationSettings['paymentOutcome']
							})}
					>
						<option value="succeed">Succeed</option>
						<option value="decline">Decline</option>
						<option value="fail">Fail</option>
					</select>
				</label>
				<label>
					AI detector verdict
					<select
						value={simulation.aiDetectorVerdict}
						onchange={(e) =>
							update({
								aiDetectorVerdict: e.currentTarget.value as SimulationSettings['aiDetectorVerdict']
							})}
					>
						<option value="clean">Clean</option>
						<option value="suspect">Suspect</option>
					</select>
				</label>
			</div>
		</section>

		<section aria-labelledby="clock-heading">
			<h2 id="clock-heading">Clock</h2>
			<p>
				Simulated time: <strong data-testid="simulated-now">{formatted(now)}</strong>
				{#if simulation.clockOffsetMs > 0}
					<span class="muted">({Math.round(simulation.clockOffsetMs / DAY)} days ahead)</span>
				{/if}
			</p>
			<div class="row">
				<button onclick={() => advance(DAY)}>+1 day</button>
				<button onclick={() => advance(7 * DAY)}>+1 week</button>
				<button onclick={() => advance(30 * DAY)}>+30 days</button>
				<button
					onclick={() => update({ clockOffsetMs: 0 })}
					disabled={simulation.clockOffsetMs === 0}>Back to real time</button
				>
			</div>
		</section>
	{/if}

	<section aria-labelledby="data-heading">
		<h2 id="data-heading">Data</h2>
		<div class="row">
			<button onclick={resetDemoData} disabled={busy}>Reset demo data</button>
			<button class="danger" onclick={wipe} disabled={busy}>Wipe device data</button>
		</div>
	</section>

	<section aria-labelledby="test-books-heading">
		<h2 id="test-books-heading">Test books</h2>
		<p class="muted">Imported into this Persona’s library, like any EPUB of your own.</p>
		<div class="row">
			<button onclick={() => importTestBook('status-window.epub', statusWindowUrl)}
				>Import the status-window fixture</button
			>
			<button onclick={() => importTestBook('alice-rackham-gutenberg.epub', rackhamUrl)}
				>Import Rackham’s illustrated Alice</button
			>
		</div>
	</section>

	<section aria-labelledby="tools-heading">
		<h2 id="tools-heading">Tools</h2>
		<ul class="flags">
			<li>
				<a href={resolve('/dev/components')}>Component gallery</a>: every `@book/ui` component, in
				the current theme
			</li>
		</ul>
	</section>

	<section aria-labelledby="flags-heading">
		<h2 id="flags-heading">Feature flags</h2>
		<ul class="flags">
			{#each featureFlags as flag (flag)}
				<li><code>{flag}</code>: {flags[flag] ? 'on' : 'off'}</li>
			{/each}
		</ul>
	</section>
</div>

<ImportDialog bind:this={importer} />

<style>
	.dev {
		max-width: 48rem;
	}

	h1,
	h2 {
		font-family: var(--font-display);
	}

	h2 {
		margin-top: var(--space-6);
		font-size: 1.15rem;
	}

	.muted {
		color: var(--md-sys-color-on-surface-variant);
	}

	.block {
		display: block;
	}

	a {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch-target);
	}

	.personas {
		display: grid;
		gap: var(--space-2);
	}

	.persona,
	.check {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		min-height: var(--touch-target);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--md-sys-color-outline-variant);
		border-radius: var(--radius-md);
		cursor: pointer;
	}

	.check {
		border: none;
		padding-inline: 0;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: end;
	}

	label {
		display: grid;
		gap: var(--space-1);
	}

	.stack {
		display: grid;
		gap: var(--space-1);
		margin-block: var(--space-3);
	}

	input[type='radio'],
	input[type='checkbox'] {
		width: 1.25rem;
		height: 1.25rem;
	}

	input[type='number'],
	select,
	button {
		min-height: var(--touch-target);
		padding: 0 var(--space-3);
		border: 1px solid var(--md-sys-color-outline-variant);
		border-radius: var(--radius-md);
		background: var(--md-sys-color-surface);
	}

	input[type='range'] {
		min-height: var(--touch-target);
		width: min(100%, 24rem);
	}

	button {
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.danger {
		border-color: var(--md-sys-color-error);
		color: var(--md-sys-color-error);
	}

	.flags {
		padding-left: var(--space-5);
	}
</style>
