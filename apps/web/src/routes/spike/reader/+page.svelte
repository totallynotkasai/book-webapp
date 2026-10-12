<script lang="ts">
	// SPIKE (P0-04): throwaway side-by-side page for ADR-001. Deleted when ADR-001 is accepted.
	import {
		createEngine,
		openPublication,
		type EngineId,
		type SpikeEngine,
		type SpikeLayout,
		type SpikePublication,
		type SpikeSelection
	} from '@book/reader-core/spike';
	import { onDestroy, onMount } from 'svelte';

	// Served from static/; the spike runs at the site root.
	const aliceUrl = '/books/alice.epub';

	interface BookChoice {
		id: string;
		label: string;
		url: string;
		merge?: { from: number; to: number };
	}

	const BOOKS: BookChoice[] = [
		{ id: 'alice', label: "Alice's Adventures in Wonderland", url: aliceUrl },
		{
			id: 'alice-long',
			label: 'Alice, chapters 1–5 as one ~10,800-word chapter (budget test)',
			url: aliceUrl,
			merge: { from: 2, to: 6 }
		}
	];

	const ENGINES: { id: EngineId; label: string }[] = [
		{ id: 'foliate', label: 'foliate-js' },
		{ id: 'readium', label: 'Readium' }
	];

	interface Kept {
		ok: boolean;
		corrected: boolean;
		correctionMs: number;
		word: number;
		now: string;
	}

	interface Pane {
		id: EngineId;
		label: string;
		el?: HTMLDivElement;
		engine?: SpikeEngine;
		status: string;
		turns: number[];
		relayouts: number[];
		lastTurn?: number;
		lastRelayout?: number;
		kept?: Kept;
		keptLog: Kept[];
		highlights: number;
		visible: string;
		pages: number;
		figure?: string;
		selection: SpikeSelection | null;
		error?: string;
	}

	let bookId = $state('alice');
	let show = $state<'both' | EngineId>(
		typeof window !== 'undefined' && window.innerWidth < 1100 ? 'foliate' : 'both'
	);
	let fontScale = $state(1);
	let layout = $state<SpikeLayout>('paginated');
	let chapter = $state(0);
	let publication = $state<SpikePublication>();
	let panes = $state<Pane[]>(
		ENGINES.map((e) => ({
			id: e.id,
			label: e.label,
			status: 'Not loaded',
			turns: [],
			relayouts: [],
			visible: '–',
			pages: 0,
			selection: null,
			keptLog: [],
			highlights: 0
		}))
	);

	// Feel scores, kept on this device until copied into ADR-001.
	const SCORE_KEY = 'spike-reader-scores';
	let scores = $state<Record<EngineId, { feel: number; notes: string }>>(
		(() => {
			try {
				return JSON.parse(localStorage.getItem(SCORE_KEY) ?? '') as Record<
					EngineId,
					{ feel: number; notes: string }
				>;
			} catch {
				return { foliate: { feel: 0, notes: '' }, readium: { feel: 0, notes: '' } };
			}
		})()
	);
	$effect(() => {
		localStorage.setItem(SCORE_KEY, JSON.stringify(scores));
	});

	const visiblePanes = $derived(panes.filter((p) => show === 'both' || p.id === show));
	const median = (xs: number[]) =>
		xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : undefined;
	const ms = (n?: number) => (n === undefined ? '–' : `${Math.round(n)} ms`);

	function refresh(pane: Pane) {
		const v = pane.engine?.visibleWords();
		pane.visible = v?.first ? `Words ${v.first}–${v.last} (${v.count})` : '–';
		pane.pages = pane.engine?.pageCount() ?? 0;
	}

	async function load() {
		const book = BOOKS.find((b) => b.id === bookId)!;
		for (const pane of panes) {
			await pane.engine?.destroy();
			pane.engine = undefined;
			pane.el?.replaceChildren();
			pane.turns = [];
			pane.relayouts = [];
			pane.kept = undefined;
			pane.keptLog = [];
			pane.highlights = 0;
			pane.figure = undefined;
			pane.error = undefined;
		}
		publication?.release();
		const buffer = await (await fetch(book.url)).arrayBuffer();
		publication = await openPublication(buffer, { marking: 'spans', mergeChapters: book.merge });
		chapter = publication.sections.findIndex((s) => s.linear && s.wordCount > 0);
		for (const pane of visiblePanes) await mount(pane);
	}

	async function mount(pane: Pane) {
		if (!publication || !pane.el) return;
		pane.status = 'Loading…';
		try {
			const started = performance.now();
			const engine = await createEngine(pane.id);
			(globalThis as unknown as { __spikeMounting?: unknown }).__spikeMounting = engine;
			await engine.mount(pane.el, publication, { fontScale, layout });
			pane.engine = engine;
			// Spike-only: inspect engines from the console.
			(globalThis as unknown as { __spike?: Record<string, unknown> }).__spike = {
				...(globalThis as unknown as { __spike?: Record<string, unknown> }).__spike,
				[pane.id]: engine
			};
			pane.status = `Opened in ${Math.round(performance.now() - started)} ms`;
			engine.onRelocate(() => refresh(pane));
			engine.onSelection((s) => (pane.selection = s));
			refresh(pane);
		} catch (error) {
			pane.error = error instanceof Error ? error.message : String(error);
			pane.status = 'Failed';
			console.error(error);
		}
	}

	async function each(action: (pane: Pane, engine: SpikeEngine) => Promise<void>) {
		await Promise.all(
			visiblePanes.map(async (pane) => {
				if (!pane.engine) return;
				try {
					await action(pane, pane.engine);
				} catch (error) {
					pane.error = error instanceof Error ? error.message : String(error);
				}
				refresh(pane);
			})
		);
	}

	/** Input to the first frame showing different Words (§12.3 budget: < 100 ms). */
	async function firstChange(engine: SpikeEngine, started: number, before: number | null) {
		while (performance.now() - started < 2000) {
			await new Promise((r) => requestAnimationFrame(r));
			if ((engine.visibleWords()?.first ?? null) !== before) return performance.now() - started;
		}
		return undefined;
	}

	function turn(direction: 'next' | 'prev') {
		return each(async (pane, engine) => {
			const before = engine.visibleWords()?.first ?? null;
			const started = performance.now();
			const settled = engine[direction]();
			const changed = await firstChange(engine, started, before);
			await settled;
			pane.lastTurn = changed ?? performance.now() - started;
			pane.turns = [...pane.turns, pane.lastTurn];
		});
	}

	/** Criterion 2: the first visible Word must still be on screen after the change. */
	function relayout(change: (engine: SpikeEngine) => Promise<void>) {
		return each(async (pane, engine) => {
			const anchor = engine.visibleWords()?.first ?? null;
			const started = performance.now();
			await change(engine);
			pane.lastRelayout = performance.now() - started;
			pane.relayouts = [...pane.relayouts, pane.lastRelayout];
			const after = engine.visibleWords();
			if (anchor === null || after?.first == null || after.last == null) return;
			const native = anchor >= after.first && anchor <= after.last;
			let corrected = native;
			let correctionMs = 0;
			if (!native) {
				// What our adapter would do (P1-RDR-01): jump back to the anchor Word.
				const t = performance.now();
				await engine.goToWord(anchor);
				correctionMs = performance.now() - t;
				const fixed = engine.visibleWords();
				corrected = !!fixed?.first && anchor >= fixed.first && anchor <= (fixed.last ?? 0);
			}
			const now = engine.visibleWords();
			pane.kept = {
				ok: native,
				corrected,
				correctionMs,
				word: anchor,
				now: `${now?.first}–${now?.last}`
			};
			pane.keptLog = [...pane.keptLog, pane.kept];
		});
	}

	function scale(delta: number) {
		fontScale = Math.min(2.5, Math.max(0.75, Math.round((fontScale + delta) * 100) / 100));
		return relayout((engine) => engine.setFontScale(fontScale));
	}

	function setLayout(next: SpikeLayout) {
		layout = next;
		return relayout((engine) => engine.setLayout(next));
	}

	function goToChapter() {
		return each((_, engine) => engine.goToSection(chapter));
	}

	function highlight() {
		return each(async (pane, engine) => {
			const v = engine.visibleWords();
			if (v?.first) engine.highlight(v.first, Math.min(v.first + 12, v.last ?? v.first));
			await new Promise((r) => setTimeout(r, 300));
			pane.highlights = engine.highlightCount();
		});
	}

	function clearHighlights() {
		return each(async (_, engine) => engine.clearHighlights());
	}

	const FIGURE = `data:image/svg+xml;utf8,${encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="#1b6b6b"/><text x="300" y="400" font-size="48" fill="white" text-anchor="middle" font-family="sans-serif">Injected figure</text></svg>'
	)}`;

	function injectFigure() {
		return each(async (pane, engine) => {
			const v = engine.visibleWords();
			if (!v?.first) return;
			const result = await engine.injectFigure(v.first, FIGURE, 'A placeholder Illustration');
			pane.figure = `${result.before} → ${result.after} pages`;
		});
	}

	function onKey(event: KeyboardEvent) {
		if ((event.target as HTMLElement).closest('input, textarea, select')) return;
		if (event.key === 'ArrowRight' || event.key === 'PageDown') turn('next');
		if (event.key === 'ArrowLeft' || event.key === 'PageUp') turn('prev');
	}

	function results() {
		return {
			date: new Date().toISOString(),
			userAgent: navigator.userAgent,
			viewport: `${innerWidth}×${innerHeight}@${devicePixelRatio}`,
			book: bookId,
			layout,
			fontScale,
			engines: panes.map((p) => ({
				engine: p.label,
				medianTurnMs: median(p.turns),
				medianRelayoutMs: median(p.relayouts),
				turns: p.turns.length,
				lastKept: p.kept,
				keptNative: `${p.keptLog.filter((k) => k.ok).length}/${p.keptLog.length}`,
				keptCorrected: `${p.keptLog.filter((k) => k.corrected).length}/${p.keptLog.length}`,
				medianCorrectionMs: median(p.keptLog.filter((k) => !k.ok).map((k) => k.correctionMs)),
				highlights: p.highlights,
				figure: p.figure,
				error: p.error,
				feel: scores[p.id]
			}))
		};
	}
	// Spike-only: lets the Playwright spec read the measurements.
	(globalThis as unknown as { __spikeResults?: () => unknown }).__spikeResults = () =>
		$state.snapshot(results());

	async function copyResults() {
		await navigator.clipboard.writeText(JSON.stringify(results(), null, 2));
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
	let copied = $state(false);

	// onMount, not $effect: load() reads pane state, and an effect would re-run on every update.
	onMount(load);

	onDestroy(() => {
		for (const pane of panes) pane.engine?.destroy();
		publication?.release();
	});
</script>

<svelte:window onkeydown={onKey} />

<main>
	<header>
		<h1>Reader engine spike</h1>
		<p class="muted">
			P0-04 (OPEN-01). Both engines render the same prepared files, with every Word wrapped in a
			span. Turn pages, change the text size (is the same Word still on screen?), switch layouts,
			select text, and say which one <em>feels</em> better. Throwaway page.
		</p>
	</header>

	<div class="controls" role="toolbar" aria-label="Spike controls">
		<label>
			Book
			<select bind:value={bookId} onchange={load}>
				{#each BOOKS as book (book.id)}<option value={book.id}>{book.label}</option>{/each}
			</select>
		</label>
		<label>
			Show
			<select bind:value={show} onchange={load}>
				<option value="both">Both, side by side</option>
				{#each ENGINES as engine (engine.id)}<option value={engine.id}>{engine.label}</option
					>{/each}
			</select>
		</label>
		<div class="group">
			<button onclick={() => turn('prev')} aria-label="Previous page">‹ Prev</button>
			<button onclick={() => turn('next')} aria-label="Next page">Next ›</button>
		</div>
		<div class="group">
			<button onclick={() => scale(-0.1)} aria-label="Smaller text">A−</button>
			<output aria-label="Text size">{Math.round(fontScale * 100)}%</output>
			<button onclick={() => scale(0.1)} aria-label="Larger text">A+</button>
		</div>
		<div class="group" role="radiogroup" aria-label="Layout">
			{#each [['paginated', 'Single'], ['spread', 'Spread'], ['scroll', 'Scroll']] as [value, label] (value)}
				<button
					role="radio"
					aria-checked={layout === value}
					class:active={layout === value}
					onclick={() => setLayout(value as SpikeLayout)}>{label}</button
				>
			{/each}
		</div>
		{#if publication}
			<label>
				Chapter
				<select bind:value={chapter} onchange={goToChapter}>
					{#each publication.sections as section, i (section.href)}
						<option value={i}>{section.title.slice(0, 50)}</option>
					{/each}
				</select>
			</label>
		{/if}
		<div class="group">
			<button onclick={highlight}>Highlight</button>
			<button onclick={clearHighlights}>Clear</button>
			<button onclick={injectFigure}>Insert figure</button>
		</div>
	</div>

	<div class="panes" class:single={show !== 'both'}>
		{#each panes as pane (pane.id)}
			<section class="pane" hidden={show !== 'both' && show !== pane.id} aria-label={pane.label}>
				<h2>{pane.label}</h2>
				<dl class="metrics">
					<div>
						<dt>Status</dt>
						<dd data-testid="status-{pane.id}">{pane.status}</dd>
					</div>
					<div>
						<dt>Page turn</dt>
						<dd>
							{ms(pane.lastTurn)} <span class="muted">(median {ms(median(pane.turns))})</span>
						</dd>
					</div>
					<div>
						<dt>Re-layout</dt>
						<dd>
							{ms(pane.lastRelayout)}
							<span class="muted">(median {ms(median(pane.relayouts))})</span>
						</dd>
					</div>
					<div>
						<dt>Same Word kept</dt>
						<dd data-testid="kept-{pane.id}">
							{#if pane.kept}{pane.kept.ok
									? '✓ yes'
									: pane.kept.corrected
										? '✗ no, fixed by jumping back'
										: '✗ no'}
								<span class="muted">(Word {pane.kept.word}; now {pane.kept.now})</span>{:else}–{/if}
						</dd>
					</div>
					<div>
						<dt>On screen</dt>
						<dd data-testid="visible-{pane.id}">{pane.visible}</dd>
					</div>
					<div>
						<dt>Pages in chapter</dt>
						<dd data-testid="pages-{pane.id}">{pane.pages}</dd>
					</div>
					{#if pane.figure}<div>
							<dt>Figure injected</dt>
							<dd data-testid="figure-{pane.id}">{pane.figure}</dd>
						</div>{/if}
					{#if pane.selection}
						<div>
							<dt>Selection</dt>
							<dd data-testid="selection-{pane.id}">
								Words {pane.selection.startWordId}–{pane.selection.endWordId}: “{pane.selection.text.slice(
									0,
									60
								)}”
							</dd>
						</div>
					{/if}
					{#if pane.error}<div class="error">
							<dt>Error</dt>
							<dd data-testid="error-{pane.id}">{pane.error}</dd>
						</div>{/if}
				</dl>
				<div class="viewport" bind:this={pane.el}></div>
				<fieldset class="score">
					<legend>How does {pane.label} feel? (1 = poor, 5 = great)</legend>
					{#each [1, 2, 3, 4, 5] as n (n)}
						<label class="score-option">
							<input
								type="radio"
								name="feel-{pane.id}"
								value={n}
								bind:group={scores[pane.id].feel}
							/>
							{n}
						</label>
					{/each}
					<label class="notes">
						Notes
						<textarea rows="2" bind:value={scores[pane.id].notes}></textarea>
					</label>
				</fieldset>
			</section>
		{/each}
	</div>

	<p>
		<button onclick={copyResults}>{copied ? 'Copied' : 'Copy results for ADR-001'}</button>
		<span class="muted">Measurements and your scores, as JSON, to paste back to Claude.</span>
	</p>
</main>

<style>
	main {
		padding: calc(var(--space-3) + var(--safe-top)) calc(var(--space-3) + var(--safe-right))
			var(--space-5) calc(var(--space-3) + var(--safe-left));
	}

	h1 {
		margin: 0;
		font-size: 1.4rem;
	}

	h2 {
		margin: 0 0 var(--space-2);
		font-size: 1.1rem;
	}

	.muted {
		color: var(--color-text-muted);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: end;
		margin-block: var(--space-3);
	}

	.group {
		display: flex;
		gap: var(--space-1);
		align-items: center;
	}

	label {
		display: grid;
		gap: var(--space-1);
		font-size: 0.85rem;
	}

	button,
	select {
		min-height: var(--touch-target);
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		cursor: pointer;
	}

	button.active {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}

	.panes {
		display: grid;
		gap: var(--space-4);
	}

	@media (min-width: 1100px) {
		.panes:not(.single) {
			grid-template-columns: 1fr 1fr;
		}
	}

	.pane[hidden] {
		display: none;
	}

	.metrics {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: var(--space-1) var(--space-3);
		margin: 0 0 var(--space-2);
		font-size: 0.85rem;
	}

	.metrics dt {
		color: var(--color-text-muted);
	}

	.metrics dd {
		margin: 0;
	}

	.error dd {
		color: #b3261e;
	}

	.viewport {
		position: relative;
		height: min(72vh, 52rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: #fff;
		color: #1f1d1a;
	}

	.score {
		margin-top: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.score-option {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: var(--touch-target);
		margin-right: var(--space-3);
	}

	.notes {
		margin-top: var(--space-2);
	}

	textarea {
		width: 100%;
		font: inherit;
	}
</style>
