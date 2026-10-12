<script lang="ts">
	// SPIKE (P0-06): throwaway page for ADR-003. Plays an aligned LibriVox chapter of Alice with
	// the current Word highlighted, auto page-turn and tap-to-seek. Deleted with the other spikes.
	import { timeToWordIndex, wordIndexMap } from '@book/alignment';
	import { isInterpolated, parseSyncMap, type SyncMap, type WordId } from '@book/core';
	import {
		createEngine,
		openPublication,
		type EngineId,
		type SpikeEngine,
		type SpikePublication
	} from '@book/reader-core/spike';
	import { getPlatform } from '$lib/platform';
	import { onDestroy, onMount, tick as settled } from 'svelte';

	const ALICE = '/books/alice.epub';
	const CHAPTERS = [1, 2] as const;
	const pad = (n: number) => String(n).padStart(2, '0');
	const syncUrl = (n: number) => `/demo/sync/alice/ch${pad(n)}.json`;
	const audioUrl = (n: number) => `/demo/audio/alice/ch${pad(n)}.m4a`;
	const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
	const ENGINES: { id: EngineId; label: string }[] = [
		{ id: 'foliate', label: 'foliate-js' },
		{ id: 'readium', label: 'Readium' }
	];

	type AudioState = 'checking' | 'missing' | 'unsupported' | 'ready';

	const audio = getPlatform().audio;
	let container = $state<HTMLDivElement>();
	let engineId = $state<EngineId>('foliate');
	let chapter = $state<number>(1);
	let status = $state('Loading…');
	let error = $state<string>();
	let audioState = $state<AudioState>('checking');
	let syncMap = $state.raw<SyncMap>();
	let playing = $state(false);
	let rate = $state(1);
	let positionMs = $state(0);
	let current = $state(-1);
	let following = $state(true);
	let lags = $state.raw<number[]>([]);
	let highlightCosts = $state.raw<number[]>([]);
	let turns = $state(0);
	let ready = $state(false);
	let mounts = $state(0);

	let engine: SpikeEngine | undefined;
	let publication: SpikePublication | undefined;
	let sectionIndex = -1;
	/** Reading order of each Word in the chapter (Invariant 4: never order by WordId). */
	let order = new Map<WordId, number>();
	let byWord = new Map<WordId, number>();
	let frame = 0;
	let turning = false;
	let quietUntil = 0;
	const wired = new WeakSet<Document>();

	const words = $derived(syncMap?.words ?? []);
	const interpolatedCount = $derived(words.filter(isInterpolated).length);
	const currentWord = $derived(current >= 0 ? words[current] : undefined);

	function percentile(xs: readonly number[], p: number): number | undefined {
		if (!xs.length) return undefined;
		const sorted = [...xs].sort((a, b) => a - b);
		return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
	}
	const fmtMs = (n?: number) => (n === undefined ? '–' : `${Math.round(n)} ms`);
	const clock = (ms: number) => {
		const s = Math.max(0, Math.floor(ms / 1000));
		return `${Math.floor(s / 60)}:${pad(s % 60)}`;
	};

	/** Which spine item holds "CHAPTER <n>." (Gutenberg titles chapters with Roman numerals). */
	function findChapter(pub: SpikePublication, n: number): number {
		const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n];
		return pub.sections.findIndex((s) => s.title.toUpperCase().startsWith(`CHAPTER ${roman}.`));
	}

	/** The prepared chapter's Words in reading order, straight from the spans the engine renders. */
	async function chapterWords(pub: SpikePublication, index: number): Promise<[WordId, string][]> {
		const section = pub.sections[index];
		if (!section) return [];
		const doc = new DOMParser().parseFromString(
			await pub.document(section.href),
			'application/xhtml+xml'
		);
		return [...doc.querySelectorAll('[data-w]')].map((el) => [
			Number(el.getAttribute('data-w')),
			el.textContent ?? ''
		]);
	}

	async function checkAudio(url: string): Promise<AudioState> {
		try {
			// Static hosts (and our serve.mjs) answer unknown paths with the app shell, so check the type.
			const response = await fetch(url, { method: 'HEAD' });
			const type = response.headers.get('content-type') ?? '';
			if (!response.ok || !/^(audio|video)\//.test(type)) return 'missing';
		} catch {
			return 'missing';
		}
		const probe = document.createElement('audio');
		return probe.canPlayType('audio/mp4; codecs="mp4a.40.2"') ? 'ready' : 'unsupported';
	}

	async function load() {
		stop();
		ready = false;
		error = undefined;
		status = 'Loading…';
		current = -1;
		lags = [];
		highlightCosts = [];
		turns = 0;
		following = true;
		try {
			await engine?.destroy();
			engine = undefined;
			// A fresh container per engine: Svelte re-creates it, so nothing is left from the last one.
			mounts++;
			await settled();
			publication ??= await openPublication(await (await fetch(ALICE)).arrayBuffer(), {
				marking: 'spans'
			});
			sectionIndex = findChapter(publication, chapter);
			if (sectionIndex < 0) throw new Error(`Chapter ${chapter} not found in the EPUB`);
			order = new Map((await chapterWords(publication, sectionIndex)).map(([id], i) => [id, i]));

			const response = await fetch(syncUrl(chapter));
			const isJson = /json/.test(response.headers.get('content-type') ?? '');
			syncMap = response.ok && isJson ? parseSyncMap(await response.json()) : undefined;
			byWord = syncMap ? wordIndexMap(syncMap.words) : new Map();

			audioState = 'checking';
			audioState = await checkAudio(audioUrl(chapter));
			if (audioState === 'ready') {
				// Loads metadata only. Nothing plays until the reader presses Play (Invariant 11).
				await audio.load(audioUrl(chapter), {
					title: `Chapter ${chapter}`,
					artist: 'Kara Shallenberg (LibriVox)',
					album: "Alice's Adventures in Wonderland"
				});
				audio.setRate(rate);
			}

			const started = performance.now();
			const next = await createEngine(engineId);
			await next.mount(container!, publication, { fontScale: 1, layout: 'paginated' });
			engine = next;
			await next.goToSection(sectionIndex);
			next.onRelocate(onRelocate);
			wireDocuments();
			status = `Opened in ${Math.round(performance.now() - started)} ms`;
			ready = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			status = 'Failed';
			console.error(e);
		}
	}

	function onRelocate() {
		wireDocuments();
		// A relocation we didn't cause while narration plays means the reader paged by hand (§8.3).
		if (playing && !turning && performance.now() > quietUntil) following = false;
	}

	/** Tap or click a Word to move the narration there (§8.3). */
	function wireDocuments() {
		for (const doc of engine?.documents() ?? []) {
			if (wired.has(doc)) continue;
			wired.add(doc);
			doc.addEventListener('click', (event) => {
				if (!doc.getSelection()?.isCollapsed) return;
				const target = event.target as Element | null;
				const id = Number(target?.closest?.('[data-w]')?.getAttribute('data-w'));
				const index = byWord.get(id);
				if (index === undefined || audioState !== 'ready') return;
				seek(words[index]![1]);
			});
		}
	}

	function show(index: number) {
		current = index;
		const word = words[index];
		if (!engine || !word) return;
		const t = performance.now();
		engine.highlight(word[0], word[0]);
		highlightCosts = [...highlightCosts, performance.now() - t];
		void follow(word[0]);
	}

	/** Turns the page when the highlighted Word leaves the visible range (§8.3). */
	async function follow(wordId: WordId) {
		if (!engine || turning) return;
		const visible = engine.visibleWords();
		const at = order.get(wordId);
		const first = visible?.first == null ? undefined : order.get(visible.first);
		const last = visible?.last == null ? undefined : order.get(visible.last);
		if (at === undefined || first === undefined || last === undefined) return;
		const onScreen = at >= first && at <= last;
		if (!following) {
			// Following resumes when the narration reaches what's on screen.
			if (onScreen) following = true;
			return;
		}
		if (onScreen) return;
		turning = true;
		try {
			if (at === last + 1 || (at > last && at - last < 20)) await engine.next();
			const now = engine.visibleWords();
			const nowFirst = now?.first == null ? undefined : order.get(now.first);
			const nowLast = now?.last == null ? undefined : order.get(now.last);
			if (nowFirst === undefined || nowLast === undefined || at < nowFirst || at > nowLast)
				await engine.goToWord(wordId);
			turns++;
		} finally {
			turning = false;
			quietUntil = performance.now() + 1000;
		}
	}

	function tick() {
		frame = 0;
		if (!playing) return;
		const t = audio.positionMs;
		positionMs = t;
		const index = timeToWordIndex(words, t);
		if (index !== current && index >= 0) {
			// Lag: how long after the Word starts in the audio its highlight reaches the screen.
			// Big jumps are seeks, not lag.
			if (current >= 0 && index > current && index - current <= 3)
				lags = [...lags, Math.max(0, t - words[index]![1])];
			show(index);
		}
		frame = requestAnimationFrame(tick);
	}

	function stop() {
		cancelAnimationFrame(frame);
		frame = 0;
		audio.pause();
		playing = false;
	}

	async function togglePlay() {
		if (audioState !== 'ready') return;
		if (playing) return stop();
		await audio.play();
		playing = true;
		following = true;
		frame = requestAnimationFrame(tick);
	}

	function seek(ms: number) {
		const target = Math.max(0, Math.min(ms, syncMap?.durationMs ?? ms));
		audio.seek(target);
		positionMs = target;
		following = true;
		const index = timeToWordIndex(words, target);
		if (index >= 0) show(index);
	}

	function setRate(value: number) {
		rate = value;
		audio.setRate(value);
	}

	function backToNarration() {
		following = true;
		const word = words[current];
		if (word) void follow(word[0]);
	}

	async function turnByHand(direction: 'next' | 'prev') {
		if (!engine) return;
		if (playing) following = false;
		await engine[direction]();
	}

	function onKey(event: KeyboardEvent) {
		if ((event.target as HTMLElement).closest('input, textarea, select, button')) return;
		if (event.key === 'ArrowRight' || event.key === 'PageDown') void turnByHand('next');
		if (event.key === 'ArrowLeft' || event.key === 'PageUp') void turnByHand('prev');
	}

	const offs = [
		audio.on('pause', () => {
			if (playing) stop();
		}),
		audio.on('ended', () => stop())
	];

	function results() {
		return {
			engine: engineId,
			chapter,
			audioState,
			coverage: syncMap?.coverage,
			words: words.length,
			interpolated: interpolatedCount,
			current,
			currentWordId: currentWord?.[0],
			positionMs: audio.positionMs,
			playing,
			rate,
			following,
			turns,
			lagSamples: lags.length,
			lagP50: percentile(lags, 50),
			lagP95: percentile(lags, 95),
			lagMax: percentile(lags, 100),
			highlightP50: percentile(highlightCosts, 50),
			highlightP95: percentile(highlightCosts, 95),
			visible: engine?.visibleWords() ?? null
		};
	}

	/** Where a Word is on screen, in top-level page coordinates (for the Playwright spec). */
	function wordRect(id: WordId) {
		for (const doc of engine?.documents() ?? []) {
			const el = doc.querySelector(`[data-w="${id}"]`);
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			let x = rect.left;
			let y = rect.top;
			let win: Window | null = doc.defaultView;
			while (win && win.frameElement) {
				const frameRect = win.frameElement.getBoundingClientRect();
				x += frameRect.left;
				y += frameRect.top;
				win = win.parent;
			}
			return { x, y, width: rect.width, height: rect.height };
		}
		return null;
	}

	// Spike-only hooks for the Playwright spec and tools/align-spike/word-index.mjs.
	(globalThis as unknown as { __narrationSpike?: unknown }).__narrationSpike = {
		get ready() {
			return ready;
		},
		results,
		wordRect,
		startOf: (id: WordId) => {
			const index = byWord.get(id);
			return index === undefined ? undefined : words[index]![1];
		},
		/** `[wordId, text]` per chapter, from the same prepared spans the engines render. */
		async wordIndex(chapters: number[]) {
			const pub =
				publication ??
				(await openPublication(await (await fetch(ALICE)).arrayBuffer(), { marking: 'spans' }));
			const out = [];
			for (const n of chapters) {
				const index = findChapter(pub, n);
				const section = pub.sections[index]!;
				out.push({
					chapter: n,
					sectionIndex: index,
					href: section.href,
					title: section.title,
					firstWordId: section.firstWordId,
					lastWordId: section.lastWordId,
					words: await chapterWords(pub, index)
				});
			}
			return out;
		}
	};

	onMount(() => {
		const params = new URLSearchParams(location.search);
		if (params.get('engine') === 'readium') engineId = 'readium';
		const n = Number(params.get('chapter'));
		if ((CHAPTERS as readonly number[]).includes(n)) chapter = n;
		void load();
	});

	onDestroy(() => {
		stop();
		for (const off of offs) off();
		void engine?.destroy();
		publication?.release();
	});
</script>

<svelte:window onkeydown={onKey} />

<main>
	<header>
		<h1>Narration spike</h1>
		<p class="muted">
			P0-06. A LibriVox reading of <em>Alice</em>, aligned to the text with whisper.cpp. Press Play
			and the Word being read is highlighted; pages turn by themselves. Tap a Word to move the
			narration there. Throwaway page.
		</p>
	</header>

	<div class="controls" role="toolbar" aria-label="Narration controls">
		<label>
			Engine
			<select bind:value={engineId} onchange={load}>
				{#each ENGINES as e (e.id)}<option value={e.id}>{e.label}</option>{/each}
			</select>
		</label>
		<label>
			Chapter
			<select bind:value={chapter} onchange={load}>
				{#each CHAPTERS as n (n)}<option value={n}>Chapter {n}</option>{/each}
			</select>
		</label>
		<div class="group">
			<button
				class="primary"
				onclick={togglePlay}
				disabled={audioState !== 'ready' || !ready}
				aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚ Pause' : '▶ Play'}</button
			>
			<button
				onclick={() => seek(positionMs - 15_000)}
				disabled={audioState !== 'ready'}
				aria-label="Back 15 seconds">−15 s</button
			>
			<button
				onclick={() => seek(positionMs + 15_000)}
				disabled={audioState !== 'ready'}
				aria-label="Forward 15 seconds">+15 s</button
			>
			<output aria-label="Position" data-testid="position"
				>{clock(positionMs)} / {clock(syncMap?.durationMs ?? 0)}</output
			>
		</div>
		<label>
			Speed
			<select value={rate} onchange={(e) => setRate(Number(e.currentTarget.value))}>
				{#each SPEEDS as s (s)}<option value={s}>{s}×</option>{/each}
			</select>
		</label>
		<div class="group">
			<button onclick={() => turnByHand('prev')} aria-label="Previous page">‹ Prev</button>
			<button onclick={() => turnByHand('next')} aria-label="Next page">Next ›</button>
		</div>
		{#if playing && !following}
			<button class="chip" onclick={backToNarration}>Back to narration</button>
		{/if}
	</div>

	{#if audioState === 'missing'}
		<div class="notice" role="status" data-testid="audio-missing">
			<strong>The narration audio isn't in this copy of the app.</strong> It is generated, not
			committed. Run <code>npm run fixtures:narration</code> (needs ffmpeg; see
			<code>apps/web/static/demo/audio/README.md</code>), then reload. The text and Sync Map still
			work below.
		</div>
	{:else if audioState === 'unsupported'}
		<div class="notice" role="status" data-testid="audio-unsupported">
			This browser can't play AAC (<code>.m4a</code>) audio, so narration is off here.
		</div>
	{/if}
	{#if !syncMap && ready}
		<div class="notice" role="status" data-testid="sync-missing">
			No Sync Map for chapter {chapter}. Run <code>npm run fixtures:narration -- --force</code>.
		</div>
	{/if}

	<dl class="metrics">
		<div>
			<dt>Status</dt>
			<dd data-testid="status">{status}</dd>
		</div>
		<div>
			<dt>Coverage</dt>
			<dd data-testid="coverage">
				{syncMap ? `${(syncMap.coverage * 100).toFixed(1)}%` : '–'}
				<span class="muted">({interpolatedCount} of {words.length} Words interpolated)</span>
			</dd>
		</div>
		<div>
			<dt>Current Word</dt>
			<dd data-testid="current">
				{#if currentWord}#{currentWord[0]} at {fmtMs(currentWord[1])}{isInterpolated(currentWord)
						? ' (interpolated)'
						: ''}{:else}–{/if}
			</dd>
		</div>
		<div>
			<dt>Highlight lag</dt>
			<dd data-testid="lag">
				p50 {fmtMs(percentile(lags, 50))}, p95 {fmtMs(percentile(lags, 95))}
				<span class="muted">({lags.length} Words)</span>
			</dd>
		</div>
		<div>
			<dt>Highlight call</dt>
			<dd>{fmtMs(percentile(highlightCosts, 50))} <span class="muted">(median)</span></dd>
		</div>
		<div>
			<dt>Auto page-turns</dt>
			<dd>{turns}{following ? '' : ' (paused: you paged by hand)'}</dd>
		</div>
	</dl>
	{#if error}<p class="error" data-testid="error">{error}</p>{/if}

	{#key mounts}<div class="viewport" bind:this={container}></div>{/key}
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

	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	button.primary,
	button.chip {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}

	button.chip {
		border-radius: 999px;
	}

	.notice {
		margin-block: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.metrics {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
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

	.error {
		color: #b3261e;
	}

	.viewport {
		position: relative;
		height: min(70vh, 52rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: #fff;
		color: #1f1d1a;
	}
</style>
