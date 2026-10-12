<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		clampFontScale,
		isBackendError,
		type PointAnchor,
		type ReaderPreferencesPatch,
		type TocEntry
	} from '@book/core';
	import { createEngine, type ReaderEngine, type VisibleRange } from '@book/reader-core';
	import { Button, Dialog, IconButton, Progress, prefersReducedMotion } from '@book/ui';
	import { onDestroy, onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import { describeError, type DescribedError } from '$lib/errors';
	import { getStores } from '$lib/services';
	import { preferences } from '$lib/state/preferences.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import { openBook, type OpenedBook } from './open-book';
	import PreferencesSheet from './PreferencesSheet.svelte';
	import { ProgressSaver } from './progress';
	import { readingFontFaces } from './reading-fonts';
	import Scrubber from './Scrubber.svelte';
	import { layoutOf, pageTurnOf, themeTokensOf, typographyOf } from './settings';
	import ShortcutsDialog from './ShortcutsDialog.svelte';
	import TocSheet from './TocSheet.svelte';

	/**
	 * The reader (P1-RDR-02 to P1-RDR-05; DESIGN.md §9, plan §6 Phase 1.2 UX notes). Full screen,
	 * calm: the chrome fades after the first page turn and comes back on a centre tap, Esc or Tab.
	 * Position comes only from the engine's `relocated` event (§9.1), as Anchors.
	 */
	let { bookId }: { bookId: string } = $props();

	type Phase =
		| { kind: 'opening' }
		| { kind: 'ready' }
		| { kind: 'entitlement'; slug: string | null }
		| { kind: 'error'; error: DescribedError };

	let phase = $state<Phase>({ kind: 'opening' });
	let opened = $state.raw<OpenedBook>();
	let engine: ReaderEngine | undefined;
	let host = $state<HTMLElement>();
	let visible = $state.raw<VisibleRange | null>(null);
	let chrome = $state(true);
	let tocOpen = $state(false);
	let prefsOpen = $state(false);
	let shortcutsOpen = $state(false);
	let back = $state.raw<{ anchor: PointAnchor } | null>(null);
	let backTimer: ReturnType<typeof setTimeout> | undefined;
	let announcement = $state('');
	let pinchPreview = $state<number | null>(null);
	let windowWidth = $state(typeof innerWidth === 'number' ? innerWidth : 1024);
	let windowHeight = $state(typeof innerHeight === 'number' ? innerHeight : 768);
	let saver: ProgressSaver | undefined;
	/** What the engine last got, so effects only send real changes. */
	let applied: { typography: string; layout: string; theme: string; pageTurn: string } | undefined;
	const offs: (() => void)[] = [];

	const systemDark = new MediaQuery('prefers-color-scheme: dark');
	const reducedMotionQuery = new MediaQuery('prefers-reduced-motion: reduce');
	const reducedMotion = $derived(reducedMotionQuery.current || prefersReducedMotion());

	const prefs = $derived(preferences.forBook);
	const manifest = $derived(opened?.manifest);
	const tokens = $derived(themeTokensOf(prefs, systemDark.current));
	const themeStyle = $derived(
		Object.entries(tokens)
			.map(([k, v]) => `${k}:${v}`)
			.join(';')
	);
	const chapter = $derived(manifest?.chapters.find((c) => c.chapterId === visible?.chapterId));
	const tocIndex = $derived.by(() => {
		if (!manifest || !visible) return -1;
		let index = -1;
		manifest.toc.forEach((entry, i) => {
			if (entry.ordinal <= visible!.first.ordinal) index = i;
		});
		return index;
	});
	const chapterTitle = $derived(
		(tocIndex >= 0 ? manifest?.toc[tocIndex]?.label : null) || chapter?.title || ''
	);
	const scrubberChapters = $derived.by(() => {
		if (!manifest) return [];
		const total = Math.max(1, manifest.wordCount - 1);
		return manifest.chapters
			.filter((c) => c.wordCount > 0 && c.linear)
			.map((c) => ({
				title:
					manifest.toc.find((t) => t.chapterId === c.chapterId && !t.fragment)?.label ||
					c.title ||
					'Untitled',
				start: c.firstOrdinal / total
			}));
	});
	const pageLabel = $derived(
		visible?.pageInChapter
			? `Page ${visible.pageInChapter.index + 1} of ${visible.pageInChapter.count}`
			: visible
				? `${Math.round(visible.progression * 100)}%`
				: ''
	);
	const isRtl = $derived(manifest?.dir === 'rtl');

	// ---- opening ----

	onMount(() => {
		void open();
		return () => {
			for (const off of offs) off();
		};
	});

	// Leaving the reader saves at once, before the next screen reads Reading Progress.
	beforeNavigate(() => void saver?.flush());

	onDestroy(() => {
		clearTimeout(backTimer);
		void saver?.close();
		engine?.destroy();
		preferences.closeBook();
	});

	async function open() {
		phase = { kind: 'opening' };
		try {
			await preferences.openBook(bookId);
			const book = await openBook(bookId);
			opened = book;
			const stores = await getStores();
			const progress = await stores.progress.get(bookId);
			saver = new ProgressSaver(stores, bookId, progress);
			const fontFaceCss = await readingFontFaces();
			engine = await createEngine();
			listen(engine);
			const start =
				progress && progress.current.revisionId === book.manifest.revisionId
					? progress.current
					: progress
						? { progression: progress.progression }
						: undefined;
			await engine.mount(host!, book, {
				layout: layoutOf(prefs, windowWidth, windowHeight),
				typography: typographyOf(prefs),
				theme: tokens,
				pageTurn: pageTurnOf(prefs, reducedMotion),
				fontFaceCss,
				start
			});
			applied = {
				typography: JSON.stringify(typographyOf(prefs)),
				layout: layoutOf(prefs, windowWidth, windowHeight),
				theme: themeStyle,
				pageTurn: pageTurnOf(prefs, reducedMotion)
			};
			phase = { kind: 'ready' };
		} catch (error) {
			if (isBackendError(error, 'ENTITLEMENT_REQUIRED')) {
				const details = error.details as { slug?: string } | undefined;
				phase = { kind: 'entitlement', slug: details?.slug ?? null };
				return;
			}
			console.error(error);
			phase = { kind: 'error', error: describeError(error) };
		}
	}

	function listen(e: ReaderEngine) {
		offs.push(
			e.on('relocated', (range) => {
				const previous = visible;
				visible = range;
				saver?.record(range);
				if (range.cause === 'turn' || range.cause === 'scroll') chrome = false;
				if (range.cause === 'link' && previous) showBack(previous.first);
				announce(range);
			}),
			e.on('tap', ({ x }) => onTap(x)),
			e.on('keydown', (event) => onKey(event)),
			e.on('externalLink', ({ href }) => window.open(href, '_blank', 'noopener,noreferrer')),
			e.on('pinch', ({ scale, done }) => {
				const next = clampFontScale(prefs.fontScale * scale);
				pinchPreview = done ? null : next;
				if (done && next !== prefs.fontScale) change({ fontScale: next });
			}),
			e.on('error', ({ message }) => snackbars.show(message, { tone: 'error' }))
		);
	}

	// ---- live preferences (§9.4: every change applies at once and keeps position) ----

	$effect(() => {
		const typography = typographyOf(prefs);
		const layout = layoutOf(prefs, windowWidth, windowHeight);
		const pageTurn = pageTurnOf(prefs, reducedMotion);
		const theme = themeStyle;
		if (phase.kind !== 'ready' || !engine || !applied) return;
		const key = JSON.stringify(typography);
		if (key !== applied.typography) {
			applied.typography = key;
			void engine.setTypography(typography);
		}
		if (layout !== applied.layout) {
			applied.layout = layout;
			void engine.setLayout(layout);
		}
		if (theme !== applied.theme) {
			applied.theme = theme;
			engine.setTheme(tokens);
		}
		if (pageTurn !== applied.pageTurn) {
			applied.pageTurn = pageTurn;
			engine.setPageTurn(pageTurn);
		}
	});

	function change(changes: ReaderPreferencesPatch) {
		if (preferences.bookHasOverrides || bookOnly) void preferences.updateBook(changes);
		else void preferences.update(changes);
	}

	let bookOnly = $state(false);
	$effect(() => {
		if (preferences.bookHasOverrides) bookOnly = true;
	});

	// ---- navigation ----

	async function turn(dir: 1 | -1) {
		if (!engine) return;
		await (dir > 0 ? engine.next() : engine.prev());
		chrome = false;
	}

	function showBack(anchor: PointAnchor) {
		back = { anchor };
		clearTimeout(backTimer);
		backTimer = setTimeout(() => (back = null), 10_000);
	}

	/** A jump the reader may want to undo: TOC, scrubber, chapter start or end (§4.1 "Back"). */
	async function jump(target: Parameters<ReaderEngine['goTo']>[0]) {
		if (!engine) return;
		const from = visible?.first;
		await engine.goTo(target);
		if (from) showBack(from);
	}

	async function goBack() {
		if (!back || !engine) return;
		const target = back.anchor;
		back = null;
		clearTimeout(backTimer);
		await engine.goTo(target);
	}

	function onTap(x: number) {
		const rect = host?.getBoundingClientRect();
		if (!rect) return;
		const f = (x - rect.left) / rect.width;
		if (f < 0.25) void turn(isRtl ? 1 : -1);
		else if (f > 0.75) void turn(isRtl ? -1 : 1);
		else chrome = !chrome;
	}

	function anyOverlayOpen() {
		return tocOpen || prefsOpen || shortcutsOpen;
	}

	function onKey(event: KeyboardEvent) {
		if (phase.kind !== 'ready' || anyOverlayOpen()) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest?.('input, textarea, [role="slider"]')) return;
		const forward = isRtl ? 'ArrowLeft' : 'ArrowRight';
		const backward = isRtl ? 'ArrowRight' : 'ArrowLeft';
		const ctrl = event.ctrlKey || event.metaKey;
		if (ctrl && (event.key === '+' || event.key === '=')) {
			event.preventDefault();
			change({ fontScale: clampFontScale(prefs.fontScale + 0.1) });
		} else if (ctrl && event.key === '-') {
			event.preventDefault();
			change({ fontScale: clampFontScale(prefs.fontScale - 0.1) });
		} else if (ctrl && event.key === '0') {
			event.preventDefault();
			change({ fontScale: 1 });
		} else if (ctrl || event.altKey) {
			return;
		} else if (
			event.key === forward ||
			event.key === 'PageDown' ||
			(event.key === ' ' && !event.shiftKey)
		) {
			event.preventDefault();
			void turn(1);
		} else if (
			event.key === backward ||
			event.key === 'PageUp' ||
			(event.key === ' ' && event.shiftKey)
		) {
			event.preventDefault();
			void turn(-1);
		} else if (event.key === 'Home' && chapter) {
			event.preventDefault();
			void jump({ chapterId: chapter.chapterId });
		} else if (event.key === 'End' && chapter && chapter.wordCount > 0 && manifest) {
			event.preventDefault();
			void jump({
				progression: chapter.lastOrdinal / Math.max(1, manifest.wordCount - 1)
			});
		} else if (event.key === 'Escape') {
			chrome = !chrome;
		} else if (event.key === '?') {
			shortcutsOpen = true;
		} else if (event.key === 'Tab' && !chrome) {
			chrome = true;
		}
	}

	// ---- announcements (§11.7: page and Chapter changes through a live region) ----

	let announceTimer: ReturnType<typeof setTimeout> | undefined;
	let announcedChapter: string | null = null;
	function announce(range: VisibleRange) {
		clearTimeout(announceTimer);
		announceTimer = setTimeout(() => {
			const page = range.pageInChapter
				? `Page ${range.pageInChapter.index + 1} of ${range.pageInChapter.count}.`
				: `${Math.round(range.progression * 100)}% through the book.`;
			const newChapter = announcedChapter !== range.chapterId;
			announcedChapter = range.chapterId;
			announcement = newChapter ? `${chapterTitle}. ${page}` : page;
		}, 250);
	}

	/** TOC entries carry the Ordinal of their first Word; progression maps back to it exactly. */
	function selectToc(entry: TocEntry) {
		if (!manifest) return;
		void jump({ progression: entry.ordinal / Math.max(1, manifest.wordCount - 1) });
	}
</script>

<svelte:window bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} onkeydown={onKey} />
<svelte:head><title>{manifest?.title ?? 'Reading'} · Book Reader</title></svelte:head>

<!-- data-first/last: the visible Words, for tests (never stored, Invariant 1). -->
<div
	class={['reader', { 'chrome-hidden': !chrome }]}
	style={themeStyle}
	data-testid="reader"
	data-ready={phase.kind === 'ready' || undefined}
	data-first={visible?.first.ordinal}
	data-last={visible?.last.ordinal}
	data-first-word={visible?.first.quote.exact}
>
	<header class="bar top" inert={!chrome || undefined}>
		<IconButton icon="arrow_back" label="Back to library" href={resolve('/library')} />
		<div class="titles">
			<span class="book-title">{manifest?.title ?? ''}</span>
			<span class="chapter-title" data-testid="chapter-title">{chapterTitle}</span>
		</div>
		<!-- Placed Bookmark toggle (1.3) and Illustrations (1.4) go here; the titles give way. -->
		<IconButton
			icon="toc"
			label="Contents"
			disabled={phase.kind !== 'ready'}
			onclick={() => (tocOpen = true)}
		/>
		<IconButton
			icon="format_size"
			label="Reading preferences"
			disabled={phase.kind !== 'ready'}
			onclick={() => (prefsOpen = true)}
		/>
	</header>

	<div class="stage" bind:this={host} aria-label="Book text" role="region"></div>

	{#if phase.kind === 'opening'}
		<div class="overlay" role="status">
			<Progress kind="circular" label="Opening the book" />
			<p>Opening the book…</p>
		</div>
	{:else if phase.kind === 'error'}
		<div class="overlay">
			<ErrorState error={phase.error} what="This book" onretry={() => location.reload()} />
			<Button variant="text" href={resolve('/library')}>Back to library</Button>
		</div>
	{/if}

	{#if back}
		<div class="back-chip">
			<Button variant="tonal" icon="undo" onclick={goBack}>Back</Button>
		</div>
	{/if}

	{#if pinchPreview !== null}
		<div class="pinch" aria-hidden="true">{Math.round(pinchPreview * 100)}%</div>
	{/if}

	<footer class="bar bottom" inert={!chrome || undefined}>
		<IconButton
			icon={isRtl ? 'chevron_right' : 'chevron_left'}
			label="Previous page"
			disabled={phase.kind !== 'ready'}
			onclick={() => turn(-1)}
		/>
		<!-- Narration Play (1.5) goes here; the scrubber gives way. -->
		<Scrubber
			progression={visible?.progression ?? 0}
			chapters={scrubberChapters}
			oncommit={(progression) => jump({ progression })}
		/>
		<!-- "in this chapter" (§9.2) is for screen readers; the bar has no room for it on phones. -->
		<span class="page" data-testid="page-label"
			>{pageLabel}{#if visible?.pageInChapter}<span class="visually-hidden">
					in this chapter</span
				>{/if}</span
		>
		<IconButton
			icon={isRtl ? 'chevron_left' : 'chevron_right'}
			label="Next page"
			disabled={phase.kind !== 'ready'}
			onclick={() => turn(1)}
		/>
	</footer>

	<p class="visually-hidden" aria-live="polite" data-testid="announcer">{announcement}</p>
</div>

{#if manifest}
	<TocSheet
		bind:open={tocOpen}
		entries={manifest.toc}
		currentIndex={tocIndex}
		onselect={selectToc}
	/>
{/if}
<PreferencesSheet
	bind:open={prefsOpen}
	{prefs}
	{bookOnly}
	{windowWidth}
	{reducedMotion}
	onchange={change}
	onbookonly={(on) => {
		bookOnly = on;
		if (!on) void preferences.resetBook();
	}}
	onreset={() => {
		void preferences.resetBook();
		bookOnly = false;
	}}
/>
<ShortcutsDialog bind:open={shortcutsOpen} />

<Dialog
	open={phase.kind === 'entitlement'}
	title="Get this book"
	description="This book isn’t in your library yet. Get it from the store to read it."
	onclose={() => history.back()}
>
	{#snippet actions()}
		<Button variant="text" href={resolve('/library')}>Back to library</Button>
		{#if phase.kind === 'entitlement' && phase.slug}
			<Button href={resolve('/(app)/book/[slug]', { slug: phase.slug })}>See it in the store</Button
			>
		{/if}
	{/snippet}
</Dialog>

<style>
	.reader {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: var(--reader-background);
		color: var(--reader-text);
	}

	.stage {
		position: absolute;
		inset: calc(var(--safe-top) + 8px) var(--safe-right) calc(var(--safe-bottom) + 8px)
			var(--safe-left);
	}

	.bar {
		position: absolute;
		right: 0;
		left: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-inline: calc(var(--space-2) + var(--safe-left)) calc(var(--space-2) + var(--safe-right));
		background: var(--md-sys-color-surface-container);
		color: var(--md-sys-color-on-surface);
		box-shadow: var(--md-sys-elevation-1);
		transition:
			opacity var(--duration-base) var(--easing-standard),
			transform var(--duration-base) var(--easing-standard);
	}

	.top {
		top: 0;
		min-height: 56px;
		padding-top: var(--safe-top);
	}

	.bottom {
		bottom: 0;
		min-height: 64px;
		padding-bottom: var(--safe-bottom);
	}

	.chrome-hidden .bar {
		opacity: 0;
		pointer-events: none;
	}

	.chrome-hidden .top {
		transform: translateY(-100%);
	}

	.chrome-hidden .bottom {
		transform: translateY(100%);
	}

	.titles {
		display: grid;
		flex: 1;
		min-width: 0;
		text-align: center;
	}

	.book-title,
	.chapter-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.book-title {
		font-size: var(--md-sys-typescale-label-medium-size);
		color: var(--md-sys-color-on-surface-variant);
	}

	.chapter-title {
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.page {
		flex: none;
		min-width: 6.5em;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.overlay {
		position: absolute;
		inset: 0;
		z-index: 4;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: var(--space-3);
		background: var(--reader-background);
		color: var(--reader-text);
	}

	.back-chip {
		position: absolute;
		bottom: calc(80px + var(--safe-bottom));
		left: 50%;
		z-index: 6;
		transform: translateX(-50%);
		box-shadow: var(--md-sys-elevation-2);
		border-radius: var(--md-sys-shape-corner-full);
	}

	.pinch {
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 6;
		padding: var(--space-3) var(--space-5);
		border-radius: var(--md-sys-shape-corner-large);
		background: var(--md-sys-color-inverse-surface);
		color: var(--md-sys-color-inverse-on-surface);
		font-size: var(--md-sys-typescale-title-large-size);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
