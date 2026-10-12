<script lang="ts">
	// SPIKE (P0-07): throwaway checks of the phone's capabilities for ADR-004. Deleted with the spike.
	import { createEngine, openPublication, type SpikeEngine } from '@book/reader-core/spike';
	import { getPlatform } from '$lib/platform';
	import { onDestroy, onMount } from 'svelte';

	const platform = getPlatform();

	// ---- 1. Platform and safe areas ----
	let info = $state<Record<string, string>>({});
	function readInfo() {
		const probe = document.createElement('div');
		probe.style.cssText =
			'position:fixed;top:env(safe-area-inset-top,0px);left:env(safe-area-inset-left,0px);' +
			'right:env(safe-area-inset-right,0px);bottom:env(safe-area-inset-bottom,0px);';
		document.body.append(probe);
		const r = probe.getBoundingClientRect();
		probe.remove();
		const css = getComputedStyle(document.documentElement);
		const vars = ['top', 'right', 'bottom', 'left']
			.map((s) => css.getPropertyValue(`--safe-area-inset-${s}`).trim() || '–')
			.join(' / ');
		info = {
			Platform: platform.kind,
			'User agent': navigator.userAgent,
			Viewport: `${innerWidth}×${innerHeight} @${devicePixelRatio}`,
			'env(safe-area-inset-*) T/R/B/L': `${r.top} / ${innerWidth - r.right} / ${innerHeight - r.bottom} / ${r.left}`,
			'--safe-area-inset-* (Capacitor) T/R/B/L': vars,
			'Media Session API': String('mediaSession' in navigator),
			'CSS Custom Highlight API': String('highlights' in CSS)
		};
	}

	// ---- 2. Storage ----
	let storage = $state('');
	let marker = $state('');
	const MARKER_DB = 'book-spike-marker';
	function markerDb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const open = indexedDB.open(MARKER_DB, 1);
			open.onupgradeneeded = () => open.result.createObjectStore('marker');
			open.onsuccess = () => resolve(open.result);
			open.onerror = () => reject(open.error);
		});
	}
	async function readStorage() {
		const persisted = await navigator.storage?.persisted?.();
		const estimate = await navigator.storage?.estimate?.();
		storage = `persisted: ${persisted}; usage ${Math.round((estimate?.usage ?? 0) / 1024)} KB of ${Math.round((estimate?.quota ?? 0) / 1024 / 1024)} MB quota`;
		const db = await markerDb();
		const value = await new Promise<string | undefined>((resolve) => {
			const get = db.transaction('marker').objectStore('marker').get('written');
			get.onsuccess = () => resolve(get.result as string | undefined);
			get.onerror = () => resolve(undefined);
		});
		db.close();
		marker = value ? `A marker written ${value} is still here.` : 'No marker yet.';
	}
	async function writeMarker() {
		const db = await markerDb();
		await new Promise<void>((resolve) => {
			const tx = db.transaction('marker', 'readwrite');
			tx.objectStore('marker').put(new Date().toLocaleString(), 'written');
			tx.oncomplete = () => resolve();
		});
		db.close();
		await readStorage();
	}
	async function requestPersist() {
		await navigator.storage?.persist?.();
		await readStorage();
	}

	// ---- 3. File import ----
	let file = $state('');
	async function pickEpub() {
		const started = performance.now();
		const [picked] = await platform.files.pickFiles({ accept: ['.epub', 'application/epub+zip'] });
		if (!picked) {
			file = 'Cancelled.';
			return;
		}
		const bytes = new Uint8Array(await picked.arrayBuffer());
		const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
		const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
		const hex = [...hash.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
		file = `${picked.name}, ${Math.round(picked.size / 1024)} KB, ${zip ? 'a ZIP' : 'not a ZIP'}, SHA-256 ${hex}…, read in ${Math.round(performance.now() - started)} ms`;
	}

	// ---- 4. Background audio ----
	const AUDIO = '/demo/audio/alice/ch01.m4a';
	let audioLog = $state<string[]>([]);
	let audioState = $state('Not started. Audio never starts by itself (Invariant 11).');
	let hiddenSince: { at: number; position: number } | null = null;
	const log = (line: string) =>
		(audioLog = [`${new Date().toLocaleTimeString()} ${line}`, ...audioLog].slice(0, 40));
	async function playAudio() {
		const response = await fetch(AUDIO, { method: 'HEAD' }).catch(() => null);
		if (!response?.ok) {
			audioState = `No narration file at ${AUDIO}. Run npm run fixtures:narration, then npm run cap:android.`;
			return;
		}
		await platform.audio.load(AUDIO, {
			title: 'Chapter 1: Down the Rabbit-Hole',
			artist: 'Lewis Carroll, read by Kara Shallenberg',
			album: "Alice's Adventures in Wonderland"
		});
		await platform.audio.play();
		audioState = 'Playing. Now lock the phone, wait a minute, check the lock screen, then unlock.';
		log('play');
	}
	function onVisibility() {
		if (document.visibilityState === 'hidden') {
			hiddenSince = { at: Date.now(), position: platform.audio.positionMs };
			log(`hidden at ${Math.round(platform.audio.positionMs / 1000)} s`);
		} else if (hiddenSince) {
			const away = (Date.now() - hiddenSince.at) / 1000;
			const played = (platform.audio.positionMs - hiddenSince.position) / 1000;
			log(`visible again: away ${away.toFixed(0)} s, audio advanced ${played.toFixed(0)} s`);
			hiddenSince = null;
		}
	}

	// ---- 5. Long-press selection with our own toolbar ----
	let readerEl = $state<HTMLDivElement>();
	let engine: SpikeEngine | undefined;
	let selection = $state('');
	let suppressNative = $state(false);
	let toolbar = $state<{ x: number; y: number } | null>(null);
	async function openReader() {
		if (!readerEl) return;
		const buffer = await (await fetch('/books/alice.epub')).arrayBuffer();
		const publication = await openPublication(buffer, { marking: 'offsets' });
		engine = await createEngine('foliate');
		await engine.mount(readerEl, publication, { fontScale: 1, layout: 'paginated' });
		await engine.goToSection(2);
		engine.onSelection((s) => {
			selection = s ? `Words ${s.startWordId}–${s.endWordId}: “${s.text.slice(0, 50)}”` : '';
			const doc = engine?.documents()[0];
			const range = doc?.getSelection()?.rangeCount ? doc.getSelection()!.getRangeAt(0) : null;
			const frame = doc?.defaultView?.frameElement?.getBoundingClientRect();
			const box = range?.getBoundingClientRect();
			toolbar =
				s && box && frame ? { x: frame.left + box.left, y: frame.top + box.top - 56 } : null;
		});
		for (const doc of engine.documents()) {
			doc.addEventListener('contextmenu', (e) => {
				if (suppressNative) e.preventDefault();
			});
		}
	}

	onMount(() => {
		readInfo();
		readStorage();
		document.addEventListener('visibilitychange', onVisibility);
		platform.audio.on('pause', () => log('pause'));
		platform.audio.on('ended', () => log('ended'));
		openReader();
	});
	onDestroy(() => {
		document.removeEventListener('visibilitychange', onVisibility);
		platform.audio.pause();
		engine?.destroy();
	});
</script>

<main>
	<h1>Mobile capabilities spike</h1>
	<p class="muted">P0-07, for ADR-004. Try each section on the phone and note what happens.</p>

	<section>
		<h2>1. Platform and safe areas</h2>
		<dl>
			{#each Object.entries(info) as [k, v] (k)}<dt>{k}</dt>
				<dd>{v}</dd>{/each}
		</dl>
		<p class="muted">The green frame should sit just inside the notch and gesture bar.</p>
	</section>

	<section>
		<h2>2. Storage</h2>
		<p data-testid="storage">{storage}</p>
		<p data-testid="marker">{marker}</p>
		<div class="row">
			<button onclick={writeMarker}>Write a marker</button>
			<button onclick={requestPersist}>Request persistent storage</button>
		</div>
		<p class="muted">
			Write a marker, then close the app, use Settings → Apps → Book Reader → Storage → Clear cache,
			and reopen. Is the marker still here?
		</p>
	</section>

	<section>
		<h2>3. Import a file</h2>
		<button onclick={pickEpub}>Choose an EPUB…</button>
		<p data-testid="file">{file}</p>
	</section>

	<section>
		<h2>4. Background narration</h2>
		<button onclick={playAudio}>Play chapter 1</button>
		<button onclick={() => platform.audio.pause()}>Pause</button>
		<p>{audioState}</p>
		<ol class="log">
			{#each audioLog as line (line)}<li>{line}</li>{/each}
		</ol>
	</section>

	<section>
		<h2>5. Long-press selection</h2>
		<label class="check">
			<input type="checkbox" bind:checked={suppressNative} />
			Suppress the native context menu (preventDefault on contextmenu)
		</label>
		<p class="muted">
			Long-press a word in the page below, drag the handles. Does Android's own menu (Copy, Share…)
			appear? Does our toolbar stay clear of the handles?
		</p>
		<p data-testid="selection">{selection || 'No selection.'}</p>
		<div class="reader" bind:this={readerEl}></div>
	</section>

	{#if toolbar}
		<div
			class="toolbar"
			style:left="{Math.max(8, toolbar.x)}px"
			style:top="{Math.max(8, toolbar.y)}px"
		>
			<button>Highlight</button>
			<button>Note</button>
			<button>Copy</button>
		</div>
	{/if}
	<div class="safe-frame" aria-hidden="true"></div>
</main>

<style>
	main {
		padding: calc(var(--space-4) + var(--safe-top)) calc(var(--space-4) + var(--safe-right))
			calc(var(--space-7) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
	}

	h2 {
		font-size: 1.1rem;
		margin-top: var(--space-6);
	}

	.muted {
		color: var(--color-text-muted);
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1) var(--space-3);
		font-size: 0.85rem;
		word-break: break-word;
	}

	dd {
		margin: 0;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	button {
		min-height: var(--touch-target);
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.check {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		min-height: var(--touch-target);
	}

	.log {
		font-size: 0.8rem;
	}

	.reader {
		position: relative;
		height: 60vh;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: #fff;
		color: #1f1d1a;
	}

	.toolbar {
		position: fixed;
		z-index: 10;
		display: flex;
		gap: var(--space-1);
		padding: var(--space-1);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: 0 2px 12px rgb(0 0 0 / 0.25);
	}

	.safe-frame {
		position: fixed;
		inset: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
		border: 2px solid #2e7d32;
		pointer-events: none;
	}
</style>
