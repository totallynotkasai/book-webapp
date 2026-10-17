<script lang="ts">
	import { asset, resolve } from '$app/paths';
	import type { BookSummaryDto, OrderDto, PersonaDto } from '@book/core';
	import { formatPrice } from '$lib/format';
	import { featureFlags, flags, profile } from '$lib/flags';
	import ImportDialog from '$lib/library/ImportDialog.svelte';
	import {
		editedAlice,
		editedSerial,
		editedStatusWindow,
		retitledStatusWindow,
		serialWithNextChapter
	} from '$lib/library/test-books';
	import { getPlatform } from '$lib/platform';
	import { narrationKit } from '$lib/studio/test-kit';
	import { snackbars } from '$lib/state/snackbar.svelte';
	// Test books for the Phase 1.2 and 1.3 Try-it lists, bundled as files (never inlined).
	import statusWindowUrl from '../../../../../../fixtures/epub/status-window.epub?url';
	import rackhamUrl from '../../../../../../fixtures/epub/alice-rackham-gutenberg.epub?url';
	// The demo serial's seventh Chapter, for serial release schedules (P1-STU-06).
	import ledgerChapter7 from '../../../../../../fixtures/src/lamplighters-ledger-next/chapter-7.xhtml?raw';
	import {
		getBackend,
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
	let orders = $state<(OrderDto & { userId: string })[]>([]);

	async function refresh() {
		controls ??= await getDevControls();
		personas = await controls.personas();
		currentUserId = controls.currentUserId();
		simulation = { ...controls.simulation() };
		now = controls.clock.now();
		orders = await controls.orders();
	}

	/** Refunds revoke what the order granted, a Bundle's children too (P1-STO-02). */
	async function refund(order: OrderDto) {
		await controls?.refundOrder(order.id);
		snackbars.show('Refunded (simulated). What it granted is revoked.');
		await refresh();
	}

	const personaName = (userId: string) =>
		personas.find((p) => p.user.id === userId)?.label ?? userId;

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
	async function importTestBook(name: string, url: string, edit?: (b: Uint8Array) => Uint8Array) {
		try {
			const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
			await importer?.run(name, edit ? edit(bytes) : bytes);
		} catch (error) {
			snackbars.show(error instanceof Error ? error.message : String(error), { tone: 'error' });
		}
	}

	// ---- Studio test files (plan §6 Phase 1.7 Try-it) ----
	let kitBooks = $state<BookSummaryDto[]>([]);
	let kitBook = $state('');
	let kitChapter = $state(1);

	$effect(() => {
		void (async () => {
			try {
				const books = await (await getBackend()).studio.listBooks({ limit: 100 });
				kitBooks = books.items.filter((b) => b.listingState === 'listed');
				kitBook ||= kitBooks[0]?.id ?? '';
			} catch {
				kitBooks = []; // Not a Creator: the Studio refuses, and there is nothing to narrate.
			}
		})();
	});

	async function downloadBook(name: string, url: string, edit?: (b: Uint8Array) => Uint8Array) {
		try {
			const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
			const data = edit ? edit(bytes) : bytes;
			await getPlatform().files.saveFile({
				name,
				mimeType: 'application/epub+zip',
				data: new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/epub+zip' })
			});
		} catch (error) {
			snackbars.show(error instanceof Error ? error.message : String(error), { tone: 'error' });
		}
	}

	async function downloadKit() {
		try {
			const kit = await narrationKit(await getBackend(), kitBook, kitChapter);
			const base = `${kitBooks.find((b) => b.id === kitBook)?.slug ?? 'book'}-chapter-${kitChapter}`;
			const files = getPlatform().files;
			await files.saveFile({ name: `${base}.wav`, mimeType: 'audio/wav', data: kit.audio });
			await files.saveFile({
				name: `${base}.sync.json`,
				mimeType: 'application/json',
				data: JSON.stringify(kit.syncMap)
			});
			snackbars.show(`Narration test kit for “${kit.chapterTitle}” saved.`);
		} catch (error) {
			snackbars.show(error instanceof Error ? error.message : String(error), { tone: 'error' });
		}
	}

	// ---- Bulk upload (plan §6 Phase 1.8 Try-it): ten Books in a row fire `upload_volume` ----
	let bulk = $state<string | null>(null);

	async function bulkUpload() {
		const studio = (await getBackend()).studio;
		const bytes = new Uint8Array(await (await fetch(statusWindowUrl)).arrayBuffer());
		const stamp = Date.now().toString(36);
		try {
			for (let i = 1; i <= 10; i++) {
				bulk = `Publishing ${i} of 10…`;
				const file = retitledStatusWindow(bytes, `Bulk test ${stamp}-${i}`);
				const upload = await studio.upload(
					new Blob([file as Uint8Array<ArrayBuffer>], { type: 'application/epub+zip' })
				);
				for (let wait = 0; wait < 600; wait++) {
					const book = await studio.getBook(upload.bookId);
					const state = book.revisions.find((r) => r.id === upload.id)?.state;
					if (state === 'failed') throw new Error('A bulk test book couldn’t be processed.');
					if (state !== 'processing') break;
					await new Promise((r) => setTimeout(r, 100));
				}
				await studio.publishRevision(upload.bookId, { revisionId: upload.id, aiUse: 'none' });
			}
			bulk = 'Published 10 books. The Moderator’s queue now has an upload-volume Flag.';
		} catch (error) {
			bulk = error instanceof Error ? error.message : String(error);
		}
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

	<section aria-labelledby="orders-heading">
		<h2 id="orders-heading">Purchases</h2>
		{#if orders.length}
			<ul class="orders">
				{#each orders as order (order.id)}
					<li>
						<span
							>{personaName(order.userId)}: {order.items.map((i) => i.title).join(', ')} · {formatPrice(
								order.total
							)} · {order.status}</span
						>
						{#if order.status !== 'refunded'}
							<button onclick={() => void refund(order)}>Refund</button>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">No purchases yet. Orders from every Persona show here, to refund.</p>
		{/if}
	</section>

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
			<button
				onclick={() =>
					importTestBook('alice-rackham-edited.epub', rackhamUrl, (bytes) => editedAlice(bytes))}
				>Import an edited copy of Rackham’s Alice</button
			>
		</div>
		<p class="muted">
			The edited copy changes one paragraph and deletes another in Chapter I, so it imports as a new
			version: notes elsewhere stay put, and a note on the deleted text becomes orphaned.
		</p>
	</section>

	<section aria-labelledby="studio-files-heading">
		<h2 id="studio-files-heading">Studio test files</h2>
		<p class="muted">
			To upload in the Creator Studio as the Author. They download (on Android, the share sheet
			opens).
		</p>
		<div class="row">
			<button onclick={() => downloadBook('status-window.epub', statusWindowUrl)}
				>Download the status-window fixture</button
			>
			<button
				onclick={() =>
					downloadBook('status-window-edited.epub', statusWindowUrl, editedStatusWindow)}
				>Download an edited copy of it</button
			>
			<button
				onclick={() =>
					downloadBook(
						'the-lamplighters-ledger-edited.epub',
						asset('/demo/books/the-lamplighters-ledger.epub'),
						editedSerial
					)}>Download an edited copy of The Lamplighter’s Ledger</button
			>
			<button
				onclick={() =>
					downloadBook(
						'the-lamplighters-ledger-chapter-7.epub',
						asset('/demo/books/the-lamplighters-ledger.epub'),
						(bytes) => serialWithNextChapter(bytes, ledgerChapter7)
					)}>Download The Lamplighter’s Ledger with a seventh chapter</button
			>
		</div>
		<p class="muted">
			The edited copies change one paragraph, so they upload as a new version. The Ledger with a
			seventh chapter is its next version, for scheduling a chapter’s release.
		</p>
		{#if kitBooks.length}
			<div class="row">
				<label for="kit-book">Book</label>
				<select id="kit-book" bind:value={kitBook}>
					{#each kitBooks as book (book.id)}<option value={book.id}>{book.title}</option>{/each}
				</select>
				<label for="kit-chapter">Chapter</label>
				<input id="kit-chapter" type="number" min="1" bind:value={kitChapter} />
				<button onclick={downloadKit} disabled={!kitBook}>Download a narration test kit</button>
			</div>
			<p class="muted">
				A silent recording and a Sync Map with made-up timings, some marked as guessed, so the
				chapter needs review. Real ones come from <code>npm run narration</code> (tools/align).
			</p>
		{:else}
			<p class="muted">Sign in as the Author and publish a book to make a narration test kit.</p>
		{/if}
		{#if currentUserId === 'user-author'}
			<div class="row">
				<button onclick={bulkUpload} disabled={bulk?.startsWith('Publishing')}
					>Bulk upload: publish 10 test books</button
				>
			</div>
			<p class="muted" role="status">
				{bulk ??
					'Publishes the status-window fixture ten times under new titles, without an AI label, to fire upload_volume (§10.6). The tenth is held for review.'}
			</p>
		{/if}
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

	.orders {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.orders li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
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
