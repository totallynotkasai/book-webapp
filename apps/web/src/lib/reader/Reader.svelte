<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		chapterForOrdinal,
		clampFontScale,
		isBackendError,
		type Anchor,
		type Annotation,
		type HighlightColour,
		type PlacedBookmark,
		type PointAnchor,
		type RangeAnchor,
		type ReaderPreferencesPatch,
		type TocEntry
	} from '@book/core';
	import { createEngine, type ReaderEngine, type VisibleRange } from '@book/reader-core';
	import { highlightLabels } from '@book/tokens';
	import { Button, Dialog, IconButton, Progress, prefersReducedMotion } from '@book/ui';
	import { onDestroy, onMount, tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { copyText } from '$lib/clipboard';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import { describeError, type DescribedError } from '$lib/errors';
	import { getPlatform } from '$lib/platform';
	import { getBackend, getStores } from '$lib/services';
	import { preferences } from '$lib/state/preferences.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import { chapterTitleAt } from './chapters';
	import ContentsSheet, { type ContentsTab } from './ContentsSheet.svelte';
	import IllustrationCard from './IllustrationCard.svelte';
	import IllustrationPanel from './IllustrationPanel.svelte';
	import { BookIllustrations, type Current } from './illustrations.svelte';
	import LayersSheet from './LayersSheet.svelte';
	import Lightbox from './Lightbox.svelte';
	import { BookNarration, type NarratedWord } from './narration.svelte';
	import NarrationPlayer from './NarrationPlayer.svelte';
	import { BookNotes } from './notes.svelte';
	import { exportFileName, notesMarkdown, notesPlainText } from './notes-export';
	import { openBook, type OpenedBook } from './open-book';
	import PreferencesSheet from './PreferencesSheet.svelte';
	import { ProgressSaver } from './progress';
	import { readingFontFaces } from './reading-fonts';
	import Scrubber from './Scrubber.svelte';
	import SelectionToolbar from './SelectionToolbar.svelte';
	import { layoutOf, pageTurnOf, themeTokensOf, typographyOf } from './settings';
	import ShortcutsDialog from './ShortcutsDialog.svelte';
	import TextDialog from './TextDialog.svelte';

	/**
	 * The reader (P1-RDR-02 to P1-RDR-07; DESIGN.md §9, plan §6 Phase 1.2 and 1.3 UX notes). Full
	 * screen, calm: the chrome fades after the first page turn and comes back on a centre tap, Esc
	 * or Tab. Position comes only from the engine's `relocated` event (§9.1), as Anchors.
	 * Selecting text (mouse, long-press, or Shift+arrows) brings up the selection toolbar.
	 * Pictures (§8.2) and narration (§8.3) come from the Book's Layers.
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
	let contentsOpen = $state(false);
	let contentsTab = $state<ContentsTab>('contents');
	let notes = $state.raw<BookNotes>();
	type Toolbar =
		| { kind: 'selection'; anchor: RangeAnchor; text: string; rect: DOMRect; pointer: Pointer }
		| { kind: 'annotation'; annotation: Annotation; rect: DOMRect; pointer: Pointer };
	type Pointer = 'mouse' | 'touch' | 'pen' | 'keyboard';
	let toolbar = $state.raw<Toolbar | null>(null);
	let textDialog = $state.raw<
		| { kind: 'note'; anchor: RangeAnchor; annotation?: Annotation }
		| { kind: 'bookmark'; bookmark: PlacedBookmark }
		| null
	>(null);
	/** Shift+arrow selection, by Ordinal. */
	let keyboardSelection: { start: number; end: number } | null = null;
	/** Set when a tap opened or closed the toolbar, so it doesn't also turn the page. */
	let tapConsumed = false;
	let lastColour: HighlightColour = 1;

	// ---- Illustrations (§8.2) ----
	let illustrations = $state.raw<BookIllustrations>();
	let layersOpen = $state(false);
	let cardOpen = $state(false);
	let packIndex = $state(0);
	let lightboxOpen = $state(false);
	let lightbox = $state.raw<Current | null>(null);
	/** The picture last looked at, so the button's dot can say when there's a new one. */
	let lastSeen = $state<string | null>(null);
	let panelCollapsed = $state(false);

	// ---- Narration (§8.3) ----
	let narration = $state.raw<BookNarration>();
	let playerExpanded = $state(false);
	/** Set while narration turns the page itself, so the turn isn't taken for the reader's. */
	let autoTurning = false;
	let narrationHint = $state(false);
	let narrationHintTimer: ReturnType<typeof setTimeout> | undefined;

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
	const coarsePointer = new MediaQuery('pointer: coarse');
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
	/** A Book without packs the reader holds shows no pictures, whatever the mode. */
	const illustrationMode = $derived(illustrations?.available ? prefs.illustrations : 'off');
	/** Each enabled pack's current Illustration: never one past the last visible Word. */
	const currents = $derived(illustrations && visible ? illustrations.currentAt(visible.last) : []);
	const shownKey = $derived(
		currents[0] ? `${currents[0].pack.id}/${currents[0].illustration.id}` : null
	);
	const newPicture = $derived(shownKey !== null && shownKey !== lastSeen);
	const showHint = $derived(
		phase.kind === 'ready' &&
			illustrationMode === 'popup' &&
			!prefs.hintsSeen.includes('illustrations')
	);
	/** per-page sits beside the book from 600 px; spread (and compact per-page) above it. */
	const panelBeside = $derived(illustrationMode === 'per-page' && windowWidth >= 600);
	const panelAbove = $derived(
		illustrationMode === 'spread' || (illustrationMode === 'per-page' && windowWidth < 600)
	);
	const panelWidth = $derived(
		panelBeside ? Math.round(Math.min(480, Math.max(240, windowWidth * 0.34))) : 0
	);
	const panelHeight = $derived(
		!panelAbove
			? 0
			: panelCollapsed
				? 72
				: Math.round(
						windowHeight *
							(illustrationMode === 'spread' ? (windowWidth > windowHeight ? 0.42 : 0.3) : 0.32)
					)
	);
	/** The mini-player's room at the foot of the page, so it never covers the text. */
	const playerRoom = $derived(narration?.active ? 72 : 0);
	/** The stage's offsets as applied (changes go through engine.relayout, keeping place). */
	let stageLeft = $state(0);
	let stageTop = $state(0);
	let stageBottom = $state(0);

	/** Placed Bookmarks on the visible page: the ribbon shows and the toggle is on. */
	const pageBookmarks = $derived(
		visible && notes ? notes.bookmarksBetween(visible.first.ordinal, visible.last.ordinal) : []
	);

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
		illustrations?.destroy();
		narration?.destroy();
		clearTimeout(backTimer);
		clearTimeout(narrationHintTimer);
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
			notes = new BookNotes(stores, bookId, book.manifest.revisionId);
			await notes.load();
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
			void loadLayers(book);
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
				if (toolbar && range.first.ordinal !== previous?.first.ordinal) closeToolbar();
				saver?.record(range);
				if (range.cause === 'turn' || range.cause === 'scroll') chrome = false;
				if (range.cause === 'link' && previous) showBack(previous.first);
				// Turning pages by hand with the player open: auto-turn waits (§8.3), and never
				// pulls the reader back while paused either.
				if (
					!autoTurning &&
					narration?.active &&
					(range.cause === 'turn' || range.cause === 'scroll' || range.cause === 'link')
				) {
					narration.following = false;
				}
				announce(range);
			}),
			e.on('tap', ({ x }) => onTap(x)),
			e.on('selection', (selection) => {
				if (selection) {
					if (selection.pointer !== 'keyboard') keyboardSelection = null;
					toolbar = {
						kind: 'selection',
						anchor: selection.anchor,
						text: selection.text,
						rect: selection.clientRect,
						pointer: selection.pointer
					};
					if (selection.pointer === 'keyboard') {
						announcement = `Selected: ${selection.text}. Press Tab for highlight and note.`;
					}
				} else if (toolbar?.kind === 'selection') {
					toolbar = null;
					keyboardSelection = null;
				}
			}),
			e.on('wordActivated', ({ wordId, anchor, clientRect }) => {
				if (toolbar) {
					closeToolbar();
					tapConsumed = true;
					return;
				}
				// Tap to seek (§8.3): while narration plays, a Word moves it there.
				const tapped = manifest && chapterForOrdinal(manifest.chapters, anchor.ordinal);
				if (narration?.playing && tapped && narration.covers(tapped.chapterId)) {
					tapConsumed = true;
					void narration.seekToWord(tapped.chapterId, wordId);
					dismissNarrationHint();
					return;
				}
				const annotation = notes?.at(anchor.ordinal);
				if (!annotation) return;
				tapConsumed = true;
				toolbar = {
					kind: 'annotation',
					annotation,
					rect: engine?.rectOf(annotation.anchor) ?? clientRect,
					pointer: coarsePointer.current ? 'touch' : 'mouse'
				};
			}),
			e.on('contextMenu', (menu) => {
				// Touch keeps Android's own long-press selection (ADR-004); the toolbar follows it.
				if (menu.pointer !== 'mouse') return;
				const at = new DOMRect(menu.x, menu.y, 0, 0);
				if (menu.anchor) {
					menu.preventDefault();
					toolbar = {
						kind: 'selection',
						anchor: menu.anchor,
						text: menu.anchor.quote.exact,
						rect: at,
						pointer: 'mouse'
					};
					return;
				}
				const annotation = menu.word ? notes?.at(menu.word.ordinal) : undefined;
				if (annotation) {
					menu.preventDefault();
					toolbar = { kind: 'annotation', annotation, rect: at, pointer: 'mouse' };
				}
			}),
			e.on('keydown', (event) => onKey(event)),
			e.on('externalLink', ({ href }) => window.open(href, '_blank', 'noopener,noreferrer')),
			e.on('pinch', ({ scale, done }) => {
				const next = clampFontScale(prefs.fontScale * scale);
				pinchPreview = done ? null : next;
				if (done && next !== prefs.fontScale) change({ fontScale: next });
			}),
			e.on('figureActivated', ({ id }) => {
				const [packId, illustrationId] = id.split('::');
				const pack = packId ? illustrations?.opened.get(packId) : undefined;
				const illustration = pack?.illustrations.find((i) => i.id === illustrationId);
				if (pack && illustration) zoomInto({ pack: pack.pack, illustration, previous: null });
			}),
			e.on('error', ({ message }) => snackbars.show(message, { tone: 'error' }))
		);
	}

	$effect(() => {
		const decorations = notes?.decorations;
		if (phase.kind === 'ready' && engine && decorations) {
			engine.setDecorations('annotations', decorations);
		}
	});

	// ---- Narration: the highlight, auto-turn, the hint (§8.3) ----

	$effect(() => {
		const word = narration?.active ? narration.word : null;
		const mode = prefs.narration.highlight;
		if (phase.kind !== 'ready' || !engine || !manifest) return;
		engine.setDecorations(
			'narration',
			word && mode !== 'off'
				? [{ id: 'narration', anchor: narratedRange(word, mode), style: 'narration' }]
				: []
		);
	});

	function narratedRange(word: NarratedWord, mode: 'word' | 'sentence'): RangeAnchor {
		const sentence = mode === 'sentence';
		return {
			kind: 'range',
			bookId: manifest!.bookId,
			revisionId: manifest!.revisionId,
			startWordId: sentence ? word.sentence.firstWordId : word.wordId,
			endWordId: sentence ? word.sentence.lastWordId : word.wordId,
			startOrdinal: sentence ? word.sentence.first : word.ordinal,
			endOrdinal: sentence ? word.sentence.last : word.ordinal,
			quote: { exact: word.text, prefix: '', suffix: '' }
		};
	}

	function onScreen(word: NarratedWord, range: VisibleRange | null): boolean {
		return (
			!!range &&
			range.chapterId === word.chapterId &&
			word.ordinal >= range.first.ordinal &&
			word.ordinal <= range.last.ordinal
		);
	}

	// Whenever the narrated Word or the page changes: keep the Word on screen while following,
	// and start following again once the narration reaches what's on screen.
	$effect(() => {
		const active = narration?.active;
		const word = active ? narration!.word : null;
		const current = active ? narration!.current : undefined;
		if (!active || phase.kind !== 'ready') return;
		if (word) void follow(word, visible);
		// A new Chapter's recording starts with its own introduction: turn to it already.
		else if (current) void followChapter(current.chapterId, visible);
	});

	async function followChapter(chapterId: string, range: VisibleRange | null) {
		if (!engine || !narration || !range || autoTurning || range.chapterId === chapterId) return;
		if (!narration.following || !prefs.narration.autoTurn) return;
		autoTurning = true;
		try {
			await engine.goTo({ chapterId });
		} finally {
			autoTurning = false;
		}
	}

	async function follow(word: NarratedWord, range: VisibleRange | null) {
		if (!engine || !narration || !range || autoTurning) return;
		if (onScreen(word, range)) {
			narration.following = true;
			return;
		}
		if (!narration.following || !prefs.narration.autoTurn) return;
		autoTurning = true;
		try {
			// Just past the page: turn it, as a reader would. Further: go straight there.
			const span = range.last.ordinal - range.first.ordinal + 1;
			if (
				range.chapterId === word.chapterId &&
				word.ordinal > range.last.ordinal &&
				word.ordinal <= range.last.ordinal + span
			) {
				await engine.next();
			}
			if (!onScreen(word, engine.getVisibleRange())) await engine.goTo(pointOf(word));
		} finally {
			autoTurning = false;
		}
	}

	function pointOf(word: NarratedWord): PointAnchor {
		return {
			kind: 'point',
			bookId: manifest!.bookId,
			revisionId: manifest!.revisionId,
			wordId: word.wordId,
			ordinal: word.ordinal,
			quote: { exact: word.text, prefix: '', suffix: '' }
		};
	}

	async function backToNarration() {
		if (!narration) return;
		narration.following = true;
		const word = narration.word;
		if (word && !onScreen(word, visible)) {
			autoTurning = true;
			try {
				await engine?.goTo(pointOf(word));
			} finally {
				autoTurning = false;
			}
		}
	}

	/** The play button: the first press starts narration from the first Word on the page. */
	async function playNarration() {
		if (!narration) return;
		if (!narration.track?.entitled) {
			snackbars.show('You don’t have the narration for this book yet.');
			return;
		}
		if (!narration.active && !narration.covers(visible?.chapterId)) {
			snackbars.show(`Narration covers ${narration.coverage}.`);
			return;
		}
		const first = !narration.active;
		await narration.toggle(
			visible ? { chapterId: visible.chapterId, ordinal: visible.first.ordinal } : undefined
		);
		if (narration.error) snackbars.show(narration.error, { tone: 'error' });
		if (first && narration.playing && !preferences.current.hintsSeen.includes('narration')) {
			narrationHint = true;
			clearTimeout(narrationHintTimer);
			// Seen once it has been up a while (the gesture is the same in every Book).
			narrationHintTimer = setTimeout(dismissNarrationHint, 8000);
		}
	}

	function dismissNarrationHint() {
		narrationHint = false;
		clearTimeout(narrationHintTimer);
		if (preferences.current.hintsSeen.includes('narration')) return;
		void preferences.update({ hintsSeen: [...preferences.current.hintsSeen, 'narration'] });
	}

	function closeNarration() {
		narration?.stop();
		playerExpanded = false;
		narrationHint = false;
	}

	$effect(() => {
		narration?.setRate(prefs.narration.rate);
	});

	// ---- Illustrations: loading, the panels' room, and in-text figures ----

	/** Pictures and narration are extra: the book reads fine without them (offline, an import). */
	async function loadLayers(book: OpenedBook) {
		try {
			const [backend, stores] = await Promise.all([getBackend(), getStores()]);
			const layers = await backend.layers.list(bookId);
			const pictures = new BookIllustrations(backend, stores, bookId, book.manifest.revisionId);
			const voice = new BookNarration({
				backend,
				audio: getPlatform().audio,
				manifest: book.manifest,
				textOf: (chapterId) => engine!.chapterText(chapterId)
			});
			voice.setRate(prefs.narration.rate);
			await Promise.all([
				pictures.load(layers).then(
					() => (illustrations = pictures),
					(error) => console.warn('Illustrations didn’t load', error)
				),
				voice.load(layers).then(
					() => (narration = voice),
					(error) => console.warn('Narration didn’t load', error)
				)
			]);
		} catch (error) {
			console.warn('Layers didn’t load', error);
		}
	}

	$effect(() => {
		const left = panelWidth;
		const top = panelAbove ? 56 + panelHeight : 0;
		const bottom = playerRoom;
		if (phase.kind !== 'ready' || !engine) return;
		if (left === stageLeft && top === stageTop && bottom === stageBottom) return;
		void engine.relayout(async () => {
			stageLeft = left;
			stageTop = top;
			stageBottom = bottom;
			await tick();
		});
	});

	let injected = '';
	$effect(() => {
		const source = illustrations;
		const key =
			illustrationMode === 'in-text' && source
				? `${source.enabled.join(',')}|${[...source.opened.keys()].join(',')}`
				: '';
		if (phase.kind !== 'ready' || !engine || key === injected) return;
		injected = key;
		if (!key || !source) {
			engine.injectFigures([]);
			return;
		}
		void injectFigures(source, key);
	});

	async function injectFigures(source: BookIllustrations, key: string) {
		const width = Math.min(900, windowWidth);
		const items = await Promise.all(
			source.all().map(async ({ pack, illustration }) => ({
				id: `${pack.pack.id}::${illustration.id}`,
				anchor: illustration.anchor,
				placement:
					illustration.placement === 'full_page' ? ('full_page' as const) : ('inline' as const),
				src: (await source.url(pack.pack.id, illustration, width)) ?? '',
				alt: illustration.alt,
				caption: illustration.caption,
				width: illustration.image.width,
				height: illustration.image.height
			}))
		);
		if (injected !== key || !engine) return;
		engine.injectFigures(items.filter((i) => i.src));
	}

	function openPicture() {
		if (!currents.length) return;
		packIndex = 0;
		cardOpen = true;
		lastSeen = shownKey;
		dismissHint();
	}

	function zoomInto(current: Current) {
		lightbox = current;
		lightboxOpen = true;
	}

	function dismissHint() {
		if (prefs.hintsSeen.includes('illustrations')) return;
		void preferences.update({ hintsSeen: [...preferences.current.hintsSeen, 'illustrations'] });
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
		if (narration?.active) narration.following = false;
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
		if (tapConsumed) {
			tapConsumed = false;
			return;
		}
		if (toolbar) {
			closeToolbar();
			return;
		}
		const rect = host?.getBoundingClientRect();
		if (!rect) return;
		const f = (x - rect.left) / rect.width;
		if (f < 0.25) void turn(isRtl ? 1 : -1);
		else if (f > 0.75) void turn(isRtl ? -1 : 1);
		else chrome = !chrome;
	}

	function anyOverlayOpen() {
		return (
			contentsOpen ||
			prefsOpen ||
			shortcutsOpen ||
			textDialog !== null ||
			layersOpen ||
			cardOpen ||
			lightboxOpen
		);
	}

	function onKey(event: KeyboardEvent) {
		if (phase.kind !== 'ready' || anyOverlayOpen()) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest?.('input, textarea, [role="slider"]')) return;
		const forward = isRtl ? 'ArrowLeft' : 'ArrowRight';
		const backward = isRtl ? 'ArrowRight' : 'ArrowLeft';
		const ctrl = event.ctrlKey || event.metaKey;
		if (target?.closest?.('[role="toolbar"]')) return;
		if (event.shiftKey && !ctrl && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
			// Shift+arrows select Words on the page, from the first one (keyboard selection).
			event.preventDefault();
			extendSelection(event.key === forward ? 1 : -1);
		} else if (toolbar && event.key === 'Tab' && !event.shiftKey) {
			event.preventDefault();
			document.querySelector<HTMLElement>('[data-testid="selection-toolbar"] button')?.focus();
		} else if (toolbar && event.key === 'Escape') {
			closeToolbar();
		} else if (toolbar && !ctrl && (event.key === 'h' || event.key === 'H')) {
			void highlightWith(lastColour);
		} else if (!ctrl && !event.altKey && (event.key === 'b' || event.key === 'B')) {
			void toggleBookmark();
		} else if (!ctrl && !event.altKey && (event.key === 'n' || event.key === 'N')) {
			openContents('notes');
		} else if (!ctrl && !event.altKey && (event.key === 'i' || event.key === 'I')) {
			if (illustrationMode === 'popup') openPicture();
			else if (illustrations?.packs.length) layersOpen = true;
		} else if (ctrl && (event.key === '+' || event.key === '=')) {
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

	// ---- selection, Annotations and Placed Bookmarks (§9.3) ----

	function closeToolbar() {
		toolbar = null;
		keyboardSelection = null;
		engine?.select(null);
	}

	function extendSelection(dir: 1 | -1) {
		if (!visible || !engine) return;
		const first = visible.first.ordinal;
		const last = visible.last.ordinal;
		let next = keyboardSelection;
		if (!next && toolbar?.kind === 'selection') {
			next = { start: toolbar.anchor.startOrdinal, end: toolbar.anchor.endOrdinal };
		}
		if (!next) next = { start: first, end: first };
		else if (dir > 0) next = { ...next, end: Math.min(last, next.end + 1) };
		else next = { ...next, end: Math.max(next.start, next.end - 1) };
		keyboardSelection = next;
		engine.select({ startOrdinal: next.start, endOrdinal: next.end });
	}

	async function highlightWith(colour: HighlightColour) {
		const current = toolbar;
		if (!current || !notes) return;
		lastColour = colour;
		closeToolbar();
		if (current.kind === 'selection') await notes.highlight(current.anchor, colour);
		else await notes.update(current.annotation.id, { colour });
	}

	function noteFromToolbar() {
		const current = toolbar;
		if (!current) return;
		closeToolbar();
		textDialog =
			current.kind === 'selection'
				? { kind: 'note', anchor: current.anchor }
				: { kind: 'note', anchor: current.annotation.anchor, annotation: current.annotation };
	}

	function editNote(annotation: Annotation) {
		textDialog = { kind: 'note', anchor: annotation.anchor, annotation };
	}

	async function saveText(value: string) {
		const dialog = textDialog;
		textDialog = null;
		if (!dialog || !notes) return;
		const text = value.trim();
		if (dialog.kind === 'bookmark') {
			await notes.renameBookmark(dialog.bookmark.id, text);
		} else if (dialog.annotation) {
			await notes.update(dialog.annotation.id, { note: text || undefined });
		} else if (text) {
			await notes.highlight(dialog.anchor, lastColour, text);
		}
	}

	async function copyFromToolbar() {
		const current = toolbar;
		if (!current) return;
		const text =
			current.kind === 'selection' ? current.text : current.annotation.anchor.quote.exact;
		closeToolbar();
		if (await copyText(text.replace(/\s+/g, ' ').trim())) snackbars.show('Copied');
		else snackbars.show('Couldn’t copy that. Try selecting it again.', { tone: 'error' });
	}

	async function removeFromToolbar() {
		const current = toolbar;
		if (!current || !notes) return;
		closeToolbar();
		await removeAnnotations(
			current.kind === 'selection' ? notes.overlapping(current.anchor) : [current.annotation]
		);
	}

	async function removeAnnotations(list: Annotation[]) {
		if (!notes || !list.length) return;
		const removed: Annotation[] = [];
		for (const a of list) {
			const gone = await notes.remove(a.id);
			if (gone) removed.push(gone);
		}
		snackbars.show(
			removed.length === 1 ? 'Highlight deleted' : `${removed.length} highlights deleted`,
			{
				action: {
					label: 'Undo',
					run: () => void Promise.all(removed.map((a) => notes?.restore(a)))
				}
			}
		);
	}

	async function toggleBookmark() {
		if (!notes || !visible || phase.kind !== 'ready') return;
		if (pageBookmarks.length) {
			const removed: PlacedBookmark[] = [];
			for (const b of pageBookmarks) {
				const gone = await notes.removeBookmark(b.id);
				if (gone) removed.push(gone);
			}
			snackbars.show('Bookmark removed', {
				action: {
					label: 'Undo',
					run: () => void Promise.all(removed.map((b) => notes?.restoreBookmark(b)))
				}
			});
			return;
		}
		const created = await notes.addBookmark(visible.first);
		snackbars.show('Page bookmarked', {
			action: {
				label: 'Add label',
				run: () => (textDialog = { kind: 'bookmark', bookmark: created })
			}
		});
	}

	async function removeBookmark(bookmark: PlacedBookmark) {
		const gone = await notes?.removeBookmark(bookmark.id);
		if (!gone) return;
		snackbars.show('Bookmark deleted', {
			action: { label: 'Undo', run: () => void notes?.restoreBookmark(gone) }
		});
	}

	function openContents(tab: ContentsTab) {
		contentsTab = tab;
		contentsOpen = true;
	}

	async function exportNotes(format: 'md' | 'txt') {
		if (!notes || !manifest) return;
		const m = manifest;
		const input = {
			title: m.title,
			creator: m.creator ?? undefined,
			chapterOf: (ordinal: number) => chapterTitleAt(m, ordinal),
			annotations: notes.live,
			bookmarks: notes.liveBookmarks,
			orphaned: [...notes.orphaned, ...notes.orphanedBookmarks],
			colourName: (c: HighlightColour) => highlightLabels[c],
			exportedOn: new Date().toLocaleDateString(undefined, { dateStyle: 'long' })
		};
		const saved = await getPlatform().files.saveFile({
			name: exportFileName(m.title, format),
			mimeType: format === 'md' ? 'text/markdown' : 'text/plain',
			data: format === 'md' ? notesMarkdown(input) : notesPlainText(input)
		});
		if (saved === 'saved') snackbars.show('Notes exported');
	}

	/** TOC entries carry the Ordinal of their first Word; progression maps back to it exactly. */
	function selectToc(entry: TocEntry) {
		if (!manifest) return;
		void jump({ progression: entry.ordinal / Math.max(1, manifest.wordCount - 1) });
	}
</script>

<svelte:window bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} onkeydown={onKey} />
<svelte:head><title>{manifest?.title ?? 'Reading'} · Book Reader</title></svelte:head>

<!-- data-first/last: the visible Words; data-narrated: the narrated one. For tests, never stored. -->
<div
	class={['reader', { 'chrome-hidden': !chrome }]}
	style={themeStyle}
	style:--panel-width={`${panelWidth}px`}
	style:--panel-height={`${panelHeight}px`}
	data-testid="reader"
	data-ready={phase.kind === 'ready' || undefined}
	data-first={visible?.first.ordinal}
	data-last={visible?.last.ordinal}
	data-first-word={visible?.first.quote.exact}
	data-narrated={narration?.active ? narration.word?.ordinal : undefined}
	data-narrated-start={narration?.active ? narration.word?.startMs : undefined}
	data-following={narration?.active ? narration.following : undefined}
>
	<header class="bar top" inert={!chrome || undefined}>
		<IconButton icon="arrow_back" label="Back to library" href={resolve('/library')} />
		<div class="titles">
			<span class="book-title">{manifest?.title ?? ''}</span>
			<span class="chapter-title" data-testid="chapter-title">{chapterTitle}</span>
		</div>
		<IconButton
			icon="bookmark"
			selectedIcon="bookmark-fill"
			label="Bookmark this page"
			selected={pageBookmarks.length > 0}
			disabled={phase.kind !== 'ready'}
			onclick={toggleBookmark}
		/>
		{#if illustrations?.packs.length}
			<IconButton icon="photo_library" label="Illustrations" onclick={() => (layersOpen = true)} />
		{/if}
		<IconButton
			icon="toc"
			label="Contents and notes"
			disabled={phase.kind !== 'ready'}
			onclick={() => openContents('contents')}
		/>
		<IconButton
			icon="format_size"
			label="Reading preferences"
			disabled={phase.kind !== 'ready'}
			onclick={() => (prefsOpen = true)}
		/>
	</header>

	<div
		class="stage"
		bind:this={host}
		aria-label="Book text"
		role="region"
		style:--stage-left={`${stageLeft}px`}
		style:--stage-top={`${stageTop}px`}
		style:--stage-bottom={`${stageBottom}px`}
	></div>

	{#if illustrations && (panelBeside || panelAbove)}
		<IllustrationPanel
			mode={illustrationMode === 'spread' ? 'spread' : 'per-page'}
			above={panelAbove}
			collapsed={panelCollapsed}
			{currents}
			bind:index={packIndex}
			{illustrations}
			wide={windowWidth >= 900}
			onzoom={zoomInto}
			oncollapse={(c) => (panelCollapsed = c)}
		/>
	{/if}

	{#if illustrationMode === 'popup' && illustrations}
		<div class={['picture-button', { lowered: chrome }]}>
			<IconButton
				variant="filled"
				icon="image"
				label={currents.length
					? newPicture
						? 'Show the new picture'
						: 'Show the picture'
					: 'No picture yet on this page'}
				dot={newPicture}
				disabled={!currents.length}
				onclick={openPicture}
			/>
			{#if showHint}
				<div class="hint" role="status" data-testid="illustration-hint">
					<p>This book has pictures. Tap here to see the one for where you are.</p>
					<Button variant="text" onclick={dismissHint}>Got it</Button>
				</div>
			{/if}
		</div>
	{/if}

	{#if pageBookmarks.length}
		<!-- The default Bookmark Design: a ribbon on the page edge (§9.3). -->
		<div class="ribbon" data-testid="bookmark-ribbon" aria-hidden="true"></div>
	{/if}

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

	<!-- The foot of the page: the Back chips, then the narration hint and mini-player (§8.3). -->
	<div class={['dock', { player: narration?.active, lowered: !chrome }]}>
		{#if back || (narration?.active && !narration.following)}
			<div class="chips">
				{#if back}
					<Button variant="tonal" icon="undo" onclick={goBack}>Back</Button>
				{/if}
				{#if narration?.active && !narration.following}
					<Button variant="tonal" icon="headphones" onclick={() => void backToNarration()}
						>Back to narration</Button
					>
				{/if}
			</div>
		{/if}
		{#if narration?.active}
			{#if narrationHint}
				<div class="narration-hint" role="status" data-testid="narration-hint">
					<span>Tap any word to move the narration there.</span>
					<IconButton icon="close" size="small" label="Got it" onclick={dismissNarrationHint} />
				</div>
			{/if}
			<NarrationPlayer
				{narration}
				prefs={prefs.narration}
				bind:expanded={playerExpanded}
				onchange={(patch) => change({ narration: patch })}
				onclose={closeNarration}
			/>
		{/if}
	</div>

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
		{#if narration?.track}
			<!-- Unavailable here: it looks disabled but still says why when pressed. -->
			<IconButton
				icon={narration.playing ? 'pause' : narration.active ? 'play_arrow' : 'headphones'}
				label={narration.playing
					? 'Pause narration'
					: narration.active
						? 'Play narration'
						: 'Listen to the narration'}
				aria-disabled={!narration.active &&
				!(narration.available && narration.covers(visible?.chapterId))
					? 'true'
					: undefined}
				aria-describedby={!narration.active && !narration.covers(visible?.chapterId)
					? 'narration-reason'
					: undefined}
				disabled={phase.kind !== 'ready' || narration.loading}
				onclick={() => void playNarration()}
			/>
			<span id="narration-reason" class="visually-hidden"
				>{narration.track.entitled
					? `Narration covers ${narration.coverage}.`
					: 'You don’t have the narration for this book yet.'}</span
			>
		{/if}
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
	<ContentsSheet
		bind:open={contentsOpen}
		bind:tab={contentsTab}
		entries={manifest.toc}
		currentIndex={tocIndex}
		onselecttoc={selectToc}
		{notes}
		titleAt={(ordinal) => chapterTitleAt(manifest, ordinal)}
		onjump={(anchor: Anchor) => void jump(anchor)}
		oneditnote={editNote}
		onremovenote={(a) => void removeAnnotations([a])}
		onrenamebookmark={(bookmark) => (textDialog = { kind: 'bookmark', bookmark })}
		onremovebookmark={(b) => void removeBookmark(b)}
		onexport={(format) => void exportNotes(format)}
	/>
{/if}

{#if toolbar}
	<SelectionToolbar
		rect={toolbar.rect}
		pointer={toolbar.pointer}
		bottomInset={(chrome ? 72 : 0) + playerRoom}
		colour={toolbar.kind === 'annotation' ? toolbar.annotation.colour : undefined}
		hasNote={toolbar.kind === 'annotation' && !!toolbar.annotation.note}
		canRemove={toolbar.kind === 'annotation' ||
			(notes?.overlapping(toolbar.anchor).length ?? 0) > 0}
		onhighlight={(c) => void highlightWith(c)}
		onnote={noteFromToolbar}
		oncopy={() => void copyFromToolbar()}
		onremove={() => void removeFromToolbar()}
		onclose={closeToolbar}
	/>
{/if}

<TextDialog
	open={textDialog !== null}
	title={textDialog?.kind === 'bookmark'
		? 'Bookmark label'
		: textDialog?.annotation?.note
			? 'Edit note'
			: 'Add note'}
	label={textDialog?.kind === 'bookmark' ? 'Label' : 'Note'}
	value={textDialog?.kind === 'bookmark'
		? (textDialog.bookmark.label ?? '')
		: (textDialog?.annotation?.note ?? '')}
	quote={textDialog?.kind === 'note'
		? textDialog.anchor.quote.exact
		: textDialog?.kind === 'bookmark'
			? `${textDialog.bookmark.anchor.quote.exact} ${textDialog.bookmark.anchor.quote.suffix}…`
			: undefined}
	multiline={textDialog?.kind === 'note'}
	ondelete={textDialog?.kind === 'note' && textDialog.annotation?.note
		? () => {
				const a = textDialog?.kind === 'note' ? textDialog.annotation : undefined;
				textDialog = null;
				if (a) void notes?.update(a.id, { note: undefined });
			}
		: undefined}
	deleteLabel="Delete note"
	onsave={(value) => void saveText(value)}
	onclose={() => (textDialog = null)}
/>
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

{#if illustrations}
	<LayersSheet
		bind:open={layersOpen}
		mode={prefs.illustrations}
		{illustrations}
		onmode={(illustrationsMode) => change({ illustrations: illustrationsMode })}
	/>
	<IllustrationCard
		bind:open={cardOpen}
		{currents}
		bind:index={packIndex}
		{illustrations}
		onzoom={zoomInto}
	/>
	<Lightbox bind:open={lightboxOpen} current={lightbox} {illustrations} />
{/if}

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
		inset: calc(var(--safe-top) + 8px + var(--stage-top, 0px)) var(--safe-right)
			calc(var(--safe-bottom) + 8px + var(--stage-bottom, 0px))
			calc(var(--safe-left) + var(--stage-left, 0px));
	}

	/* Over the page's top-right corner, and still there when the chrome fades (it's the showpiece). */
	.picture-button {
		position: absolute;
		top: calc(var(--safe-top) + 12px);
		right: calc(var(--safe-right) + 12px);
		z-index: 6;
		display: grid;
		justify-items: end;
		gap: var(--space-2);
		transition: top var(--duration-base) var(--easing-standard);
	}

	.picture-button.lowered {
		top: calc(var(--safe-top) + 64px);
	}

	.picture-button .hint {
		max-width: 16rem;
		padding: var(--space-3) var(--space-3) var(--space-1);
		border-radius: var(--md-sys-shape-corner-large);
		background: var(--md-sys-color-inverse-surface);
		color: var(--md-sys-color-inverse-on-surface);
		box-shadow: var(--md-sys-elevation-2);
		--md-sys-color-primary: var(--md-sys-color-inverse-primary);
	}

	.picture-button .hint p {
		margin: 0;
		font-size: var(--md-sys-typescale-body-medium-size);
	}

	@media (prefers-reduced-motion: reduce) {
		.picture-button {
			transition: none;
		}
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

	.ribbon {
		position: absolute;
		top: var(--safe-top);
		right: calc(var(--safe-right) + 24px);
		z-index: 4;
		width: 22px;
		height: 44px;
		background: var(--md-sys-color-primary);
		clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%);
		box-shadow: var(--md-sys-elevation-1);
		pointer-events: none;
	}

	/* Above the bottom bar while it shows; with the player, at the foot of the page otherwise. */
	.dock {
		position: absolute;
		right: calc(var(--safe-right) + var(--space-2));
		bottom: calc(80px + var(--safe-bottom));
		left: calc(var(--safe-left) + var(--space-2));
		z-index: 6;
		display: grid;
		justify-items: center;
		gap: var(--space-2);
		pointer-events: none;
		transition: bottom var(--duration-base) var(--easing-standard);
	}

	.dock > :global(*) {
		pointer-events: auto;
	}

	.dock.player.lowered {
		bottom: calc(var(--safe-bottom) + var(--space-2));
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
	}

	.chips > :global(*) {
		box-shadow: var(--md-sys-elevation-2);
		border-radius: var(--md-sys-shape-corner-full);
	}

	.narration-hint {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
		border-radius: var(--md-sys-shape-corner-full);
		background: var(--md-sys-color-inverse-surface);
		color: var(--md-sys-color-inverse-on-surface);
		box-shadow: var(--md-sys-elevation-2);
		font-size: var(--md-sys-typescale-body-medium-size);
		--md-sys-color-on-surface: var(--md-sys-color-inverse-on-surface);
	}

	@media (prefers-reduced-motion: reduce) {
		.dock {
			transition: none;
		}
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
