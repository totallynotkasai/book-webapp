<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		chapterForOrdinal,
		clampFontScale,
		isBackendError,
		type Anchor,
		type Annotation,
		type BookmarkDesignDto,
		type PlanDto,
		type HighlightColour,
		type PlacedBookmark,
		type PointAnchor,
		type RangeAnchor,
		type ReaderPreferencesPatch,
		type DraftIllustrationDto,
		type SleepTimerChoice,
		type StudioPackDto,
		type TocEntry
	} from '@book/core';
	import {
		createEngine,
		type ReaderEngine,
		type TableView,
		type VisibleRange
	} from '@book/reader-core';
	import {
		glossaryEntryFor,
		reachedOrdinal,
		storySoFarAt,
		timeLeftMs,
		type GlossaryEntryAt
	} from '@book/domain';
	import { highlightLabels } from '@book/tokens';
	import {
		Badge,
		Button,
		Dialog,
		IconButton,
		iconPaths,
		Menu,
		Progress,
		prefersReducedMotion,
		type MenuItem
	} from '@book/ui';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { copyText } from '$lib/clipboard';
	import BookmarkRibbon from '$lib/components/BookmarkRibbon.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import { migrateToCurrent } from '$lib/data/migration';
	import { describeError, type DescribedError } from '$lib/errors';
	import { formatDate, formatDay, formatDayTime, formatTimeLeft } from '$lib/format';
	import { getPlatform } from '$lib/platform';
	import { getBackend, getStores } from '$lib/services';
	import { preferences } from '$lib/state/preferences.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import SubscribeSheet from '$lib/store/SubscribeSheet.svelte';
	import AttachIllustration from '$lib/studio/AttachIllustration.svelte';
	import LayerDetailsDialog from '$lib/studio/LayerDetailsDialog.svelte';
	import PackPictures from '$lib/studio/PackPictures.svelte';
	import { listingStateLabels, listingStateTones } from '$lib/studio/summaries';
	import { chapterTitleAt } from './chapters';
	import ContentsSheet, { type ContentsTab } from './ContentsSheet.svelte';
	import IllustrationCard from './IllustrationCard.svelte';
	import IllustrationPanel from './IllustrationPanel.svelte';
	import { BookIllustrations, type Current } from './illustrations.svelte';
	import LayersSheet from './LayersSheet.svelte';
	import Lightbox from './Lightbox.svelte';
	import { BookNarration } from './narration.svelte';
	import type { ReadWord } from './narration-timing';
	import NarrationPlayer from './NarrationPlayer.svelte';
	import { BookNotes } from './notes.svelte';
	import { exportFileName, notesMarkdown, notesPlainText } from './notes-export';
	import { openBook, startOfText, type OpenedBook } from './open-book';
	import PreferencesSheet from './PreferencesSheet.svelte';
	import { ProgressSaver } from './progress';
	import { ReadingTime } from './reading-time.svelte';
	import { readingFontFaces } from './reading-fonts';
	import Scrubber from './Scrubber.svelte';
	import SelectionToolbar from './SelectionToolbar.svelte';
	import { primaryLanguage } from './speech-text';
	import type { BookSpeech } from './speech.svelte';
	import { layoutOf, pageTurnOf, themeTokensOf, typographyOf } from './settings';
	import ShortcutsDialog from './ShortcutsDialog.svelte';
	import { BookStory, storyNudgeDue } from './story.svelte';
	import { focusOnPage, ParagraphCache, paragraphAt, step, type Paragraph } from './focus';
	import type { SearchHit } from './search';
	import type { BookSearch } from './search.svelte';
	import TextDialog from './TextDialog.svelte';

	/**
	 * The reader (P1-RDR-02 to P1-RDR-07; DESIGN.md §9, plan §6 Phase 1.2 and 1.3 UX notes). Full
	 * screen, calm: the chrome fades after the first page turn and comes back on a centre tap, Esc
	 * or Tab. Position comes only from the engine's `relocated` event (§9.1), as Anchors.
	 * Selecting text (mouse, long-press, or Shift+arrows) brings up the selection toolbar.
	 * Pictures (§8.2) and narration (§8.3) come from the Book's Layers; any Book can also be read
	 * aloud by the device's own voice (P1-LAY-08), with a sleep timer (P1-LAY-09). Search
	 * (P1-RDR-10), focus mode (P1-RDR-11) and the table viewer (P1-RDR-12) load on first use.
	 * A catalogue Book's story so far (P1-RDR-13) is in Contents, up to where the reader has got.
	 */
	/**
	 * `sample`: "Read sample" for a Book the reader doesn't own (P1-STO-01). `preview`: a Creator
	 * previewing one of their own Revisions (P1-STU-01). `creatorPackId`: Creator mode, building
	 * that Illustration Pack on the Book (P1-LAY-05). Neither of the last two saves Reading Progress.
	 */
	let {
		bookId,
		sample = false,
		preview = null,
		creatorPackId = null,
		startChapter = null
	}: {
		bookId: string;
		sample?: boolean;
		preview?: { revisionId?: string } | null;
		creatorPackId?: string | null;
		/** Open at this Chapter (an ingest report's link into a preview; the welcome's Chapter I). */
		startChapter?: string | null;
	} = $props();
	const studioMode = $derived(!!preview || !!creatorPackId);
	// Read once: the reader route takes ?chapter= out of the address as soon as it's open.
	const openAtChapter = untrack(() => startChapter);

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

	// ---- Creator mode: building an Illustration Pack (P1-LAY-05) ----
	let creatorPack = $state.raw<StudioPackDto | null>(null);
	let attachOpen = $state(false);
	let attaching = $state.raw<{ anchor: RangeAnchor; passage: string } | null>(null);
	let editingPicture = $state.raw<DraftIllustrationDto | null>(null);
	let picturesOpen = $state(false);
	/** The picture whose passage was last shown: its Anchor range is marked. */
	let shownPicture = $state<string | null>(null);
	let publishingPack = $state(false);
	let packDetailsOpen = $state(false);
	/** Back to the Book in the Studio, or (community work) to the Studio's dashboard. */
	const doneHref = $derived(
		creatorPack && !creatorPack.isOfficial
			? resolve('/(app)/studio')
			: resolve('/(app)/studio/books/[bookId]', { bookId })
	);

	async function reloadPack() {
		if (!creatorPack) return;
		packChanged(await (await getBackend()).studio.getPack(creatorPack.id));
	}
	const creatorCount = $derived.by(() => {
		if (!creatorPack) return '';
		const { illustrationCount: n, missingAlt } = creatorPack;
		const pictures = `${n} ${n === 1 ? 'picture' : 'pictures'}`;
		return missingAlt ? `${pictures} · ${missingAlt} need alt text` : pictures;
	});

	function attachFromToolbar() {
		const current = toolbar;
		if (current?.kind !== 'selection') return;
		closeToolbar();
		attaching = { anchor: current.anchor, passage: current.text };
		editingPicture = null;
		attachOpen = true;
	}

	function packChanged(pack: StudioPackDto) {
		creatorPack = pack;
		illustrations?.useDraft(pack, opened?.manifest.creator ?? '');
	}

	async function showPicture(picture: DraftIllustrationDto) {
		picturesOpen = false;
		shownPicture = picture.id;
		await engine?.goTo(picture.anchor);
	}

	function editPicture(picture: DraftIllustrationDto) {
		picturesOpen = false;
		attaching = null;
		editingPicture = picture;
		attachOpen = true;
	}

	async function removePicture(picture: DraftIllustrationDto) {
		if (!creatorPack) return;
		try {
			const backend = await getBackend();
			packChanged(await backend.studio.removeIllustration(creatorPack.id, picture.id));
			snackbars.show('Picture removed.');
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		}
	}

	async function publishPack() {
		if (!creatorPack || publishingPack) return;
		publishingPack = true;
		try {
			const pack = await (await getBackend()).studio.publishPack(creatorPack.id);
			packChanged(pack);
			snackbars.show(
				pack.listingState === 'pending'
					? 'Sent to the author. You’ll hear in your inbox when they decide.'
					: pack.listingState === 'held'
						? 'Held for review: a moderator will look at it first. See your inbox.'
						: 'Published. Readers with this pack now see its pictures.'
			);
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		} finally {
			publishingPack = false;
		}
	}

	// ---- Narration (§8.3) and the device voice (P1-LAY-08) ----
	let narration = $state.raw<BookNarration>();
	let speech = $state.raw<BookSpeech>();
	/** Whichever is reading aloud: narration, or the device voice. Never both. */
	const reading = $derived(speech?.active ? speech : narration?.active ? narration : null);
	/** The Book's narration, which the reader doesn't have yet: the device voice stands in. */
	const narrationInStore = $derived(!!narration?.track && !narration.track.entitled);
	/** What the play button starts here: narration where it covers this Chapter, else the voice. */
	const playsNarration = $derived(!!narration?.available && narration.covers(visible?.chapterId));
	/** The device voice would read this Chapter. */
	const voiceHere = $derived(
		!playsNarration && !!speech?.available && speech.covers(visible?.chapterId)
	);
	const listenLabel = $derived.by(() => {
		const noun = reading === speech ? 'the device voice' : 'narration';
		if (reading?.playing) return `Pause ${noun}`;
		if (reading) return `Play ${noun}`;
		return voiceHere ? 'Read aloud with the device voice' : 'Listen to the narration';
	});
	let playerExpanded = $state(false);
	/**
	 * Set while narration turns the page itself, so the turn isn't taken for the reader's. Reactive,
	 * so following looks again once a turn ends: with the screen off a turn can't finish until it
	 * comes back on, and narration may have stopped at the next Chapter in the meantime (the sleep
	 * timer), leaving nothing else to move the page there.
	 */
	let autoTurning = $state(false);
	let narrationHint = $state(false);
	let narrationHintTimer: ReturnType<typeof setTimeout> | undefined;

	let prefsOpen = $state(false);
	let shortcutsOpen = $state(false);

	// ---- Search in the Book (P1-RDR-10) ----
	let searchOpen = $state(false);
	let search = $state.raw<BookSearch>();
	let SearchView = $state.raw<typeof import('./SearchSheet.svelte').default>();
	/** The result jumped to last: painted with the `search` decoration until the reader moves on. */
	let searchMatch = $state.raw<RangeAnchor | null>(null);
	/** Where the reader was before searching: Back returns there, however many results they visit. */
	let searchOrigin: PointAnchor | null = null;
	let resultShownAt = 0;

	// ---- The story so far (P1-RDR-13): recaps and glossary up to where the reader has got ----
	let story = $state.raw<BookStory>();
	/** The saved furthest position when the Book opened (Invariant 6 counts it as reached). */
	let furthestAtOpen = $state.raw<PointAnchor | null>(null);
	/** The furthest Word on screen this session. */
	let furthestSeen = $state.raw<PointAnchor | null>(null);
	/** When the reader last read this Book, for the catch-up nudge. */
	let lastReadAt: string | undefined;
	let glossaryOpen = $state(false);
	let glossaryEntry = $state.raw<GlossaryEntryAt | null>(null);
	let GlossaryCardView = $state.raw<typeof import('./GlossaryCard.svelte').default>();

	// ---- The table viewer (P1-RDR-12): loads the first time a table is opened ----
	let tableOpen = $state(false);
	let table = $state.raw<TableView | null>(null);
	let TableViewerView = $state.raw<typeof import('./TableViewer.svelte').default>();

	// ---- Focus mode (P1-RDR-11) ----
	let paragraphs: ParagraphCache | undefined;
	/** The paragraph kept bright. */
	let focused = $state.raw<{ chapterId: string; paragraph: Paragraph } | null>(null);
	/** Set while focus mode turns the page itself, so the turn doesn't move the focus again. */
	let focusMoving = false;
	let back = $state.raw<{ anchor: PointAnchor } | null>(null);
	let backTimer: ReturnType<typeof setTimeout> | undefined;
	let announcement = $state('');
	let pinchPreview = $state<number | null>(null);
	let windowWidth = $state(typeof innerWidth === 'number' ? innerWidth : 1024);
	let windowHeight = $state(typeof innerHeight === 'number' ? innerHeight : 768);
	let saver: ProgressSaver | undefined;
	/** The reader has closed: anything still opening must let go at once. */
	let destroyed = false;
	/** What the engine last got, so effects only send real changes. */
	let applied: { typography: string; layout: string; theme: string; pageTurn: string } | undefined;
	const offs: (() => void)[] = [];

	const systemDark = new MediaQuery('prefers-color-scheme: dark');
	const coarsePointer = new MediaQuery('pointer: coarse');
	const reducedMotionQuery = new MediaQuery('prefers-reduced-motion: reduce');
	const reducedMotion = $derived(reducedMotionQuery.current || prefersReducedMotion());

	const prefs = $derived(preferences.forBook);
	const manifest = $derived(opened?.manifest);
	/** What the reader sees of the story so far: nothing from ahead of them (Invariant 6). */
	const storyAt = $derived.by(() => {
		const s = story?.story;
		if (!s || !manifest) return null;
		const reached = reachedOrdinal(manifest.revisionId, furthestAtOpen, furthestSeen);
		return storySoFarAt(s, manifest, reached);
	});
	/** The reader hides AI-generated content (§10.6), and the author's story is. */
	const storyHidden = $derived(story?.story?.aiUse === 'generated' && prefs.hideAiGenerated);
	/** The selection names a glossary entry the reader has met: the toolbar offers it. */
	const selectedEntry = $derived(
		toolbar?.kind === 'selection' && storyAt && !storyHidden
			? glossaryEntryFor(toolbar.text, storyAt)
			: undefined
	);
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
	// ---- Your reading (P1-RDR-14, P1-RDR-15): time left at the reader's pace, and stats ----
	let readingTime = $state.raw<ReadingTime>();
	/** Never while narration or the device voice sets the pace (P1-RDR-14 acceptance). */
	const showTimeLeft = $derived(prefs.timeLeft && !reading && !!readingTime);
	/**
	 * Text after the page and the time left, for screen readers (and wide screens). Expressions,
	 * since Svelte 5 trims the space at the start of an element's text.
	 */
	const IN_THIS_CHAPTER = ' in this chapter';
	const IN_CHAPTER = ' in chapter';
	const timeLeftFor = (words: number) => formatTimeLeft(timeLeftMs(words, readingTime!.pace));
	/** "8 min left", in the Chapter from the first Word on screen. */
	const timeLeftInChapter = $derived.by(() => {
		if (!showTimeLeft || !visible || !chapter) return null;
		return timeLeftFor(chapter.lastOrdinal - visible.first.ordinal + 1);
	});
	/** For the scrubber's bubble: time left in the Book from a point on it. */
	const timeLeftAt = $derived(
		showTimeLeft && manifest
			? (fraction: number) =>
					`${timeLeftFor(Math.round((1 - fraction) * manifest!.wordCount))} in book`
			: undefined
	);
	/** The Book's last Word, when this reader can read it all: reaching it finishes the Book. */
	const bookEnd = $derived(
		opened?.access === 'full' && !opened.locked.length && manifest ? manifest.wordCount - 1 : null
	);
	const isRtl = $derived(manifest?.dir === 'rtl');
	/**
	 * A phone (M3 compact, §11.5): the top bar keeps the bookmark and contents beside the titles,
	 * and puts search, pictures and reading preferences under "More", so the titles have room.
	 */
	const compact = $derived(windowWidth < 600);
	const moreItems = $derived<MenuItem[]>([
		{ label: 'Search in this book', icon: 'search', onselect: () => void openSearch() },
		...(illustrations?.packs.length
			? [
					{
						label: 'Illustrations',
						icon: 'photo_library' as const,
						onselect: () => (layersOpen = true)
					}
				]
			: []),
		{ label: 'Reading preferences', icon: 'format_size', onselect: () => (prefsOpen = true) }
	]);
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
			!creatorPack &&
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
	const playerRoom = $derived(reading ? 72 : 0);
	/** The stage's offsets as applied (changes go through engine.relayout, keeping place). */
	let stageLeft = $state(0);
	let stageTop = $state(0);
	let stageBottom = $state(0);

	// ---- Samples, early access and Chapters to come (P1-STO-01, P1-STO-04, P1-STU-06): the
	// readable text ends early ----
	const locked = $derived(opened?.locked ?? []);
	const storeHref = $derived(
		opened?.slug ? resolve('/(app)/book/[slug]', { slug: opened.slug }) : null
	);
	/** The last readable Word: past it are the locked Chapters. */
	const readableEnd = $derived(
		manifest?.chapters.findLast((c) => c.wordCount > 0)?.lastOrdinal ?? Infinity
	);
	const atReadableEnd = $derived(
		locked.length > 0 && !!visible && visible.last.ordinal >= readableEnd
	);
	let endDismissed = $state(false);
	let earlyPlan = $state.raw<PlanDto | null>(null);
	let subscribeOpen = $state(false);
	const lockedNote = (l: (typeof locked)[number]) =>
		l.reason === 'sample'
			? 'Not in the sample'
			: l.reason === 'scheduled'
				? `Out ${l.releaseAt ? formatDay(l.releaseAt) : 'soon'}`
				: `Early access${l.freeAt ? ` until ${formatDate(l.freeAt)}` : ''}`;

	async function subscribeForEarlyAccess() {
		const first = locked[0];
		if (!first?.planId) return;
		const plans = await (await getBackend()).support.listPlans(first.creatorHandle);
		earlyPlan = plans.find((p) => p.id === first.planId) ?? null;
		subscribeOpen = !!earlyPlan;
	}

	/** The new Chapters open on the next open of the Book: save the place, then open it again. */
	async function reopen() {
		await saver?.flush();
		location.reload();
	}

	// ---- Bookmark Designs (P1-STO-03) ----
	let designs = $state.raw<BookmarkDesignDto[]>([]);
	const ownedDesigns = $derived(designs.filter((d) => d.owned));
	function designOf(bookmark: PlacedBookmark | undefined): BookmarkDesignDto | undefined {
		const id = bookmark?.bookmarkDesignProductId ?? prefs.bookmarkDesignProductId;
		return ownedDesigns.find((d) => d.productId === id) ?? ownedDesigns.find((d) => d.isDefault);
	}

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
	beforeNavigate(() => {
		void saver?.flush();
		void readingTime?.flush();
	});

	onDestroy(() => {
		illustrations?.destroy();
		narration?.destroy();
		speech?.destroy();
		search?.destroy();
		clearTimeout(backTimer);
		clearTimeout(narrationHintTimer);
		destroyed = true;
		void saver?.close();
		void readingTime?.close();
		engine?.destroy();
		preferences.closeBook();
	});

	async function open() {
		phase = { kind: 'opening' };
		// The engine's code and the reading fonts load while the Book opens, not after it
		// (P1-QA-01: on a cold open over 4G they were the last two downloads in a row).
		const engineLoading = createEngine();
		// Awaited below, where a failure is reported; until then it mustn't count as unhandled.
		engineLoading.catch(() => {});
		const fontsLoading = readingFontFaces();
		try {
			await preferences.openBook(bookId);
			const [backend, stores] = await Promise.all([getBackend(), getStores()]);
			if (creatorPackId) creatorPack = await backend.studio.getPack(creatorPackId);
			const book = await openBook(bookId, {
				sample,
				preview: creatorPack
					? { revisionId: creatorPack.revisionId ?? undefined }
					: (preview ?? undefined)
			});
			opened = book;
			// The author published a new version since: move this reader's notes, bookmarks and
			// place to it (§6.2, P1-STU-01). Previews and Creator mode leave the reader's data alone.
			if (book.source === 'catalogue' && book.access === 'full' && !studioMode) {
				const moved = await migrateToCurrent(
					stores,
					backend,
					bookId,
					book.manifest.revisionId,
					book.manifest.wordCount
				);
				if (moved.moved + moved.orphaned > 0) snackbars.show(newVersionNotice(moved));
			}
			notes = new BookNotes(stores, bookId, book.manifest.revisionId);
			await notes.load();
			const progress = await stores.progress.get(bookId);
			saver = studioMode ? undefined : new ProgressSaver(stores, bookId, progress);
			if (!studioMode) {
				const pace = await stores.readingStats.getPace();
				readingTime = new ReadingTime({
					stores,
					bookId,
					pace: pace && { words: pace.words, ms: pace.ms },
					learnPace: () => prefs.timeLeft,
					keepStats: () => preferences.current.readingStats,
					listening: () => !!reading?.playing
				});
				// Closed while the Book was opening: its timer mustn't run on.
				if (destroyed) void readingTime.close();
			}
			furthestAtOpen = progress?.furthest ?? null;
			lastReadAt = progress?.updatedAt;
			const fontFaceCss = await fontsLoading;
			engine = await engineLoading;
			listen(engine);
			// Where the reader left off; a Book opened for the first time starts at its text, past
			// the front matter (P1-RDR-09), unless ?chapter= says where.
			const start =
				progress && progress.current.revisionId === book.manifest.revisionId
					? progress.current
					: progress
						? { progression: progress.progression }
						: openAtChapter
							? undefined
							: await startOfText(book);
			await engine.mount(host!, book, {
				layout: layoutOf(prefs, windowWidth, windowHeight),
				typography: typographyOf(prefs),
				theme: tokens,
				pageTurn: pageTurnOf(prefs, reducedMotion),
				fontFaceCss,
				start,
				tableButton: { label: 'Open table', icon: iconPaths.open_in_full }
			});
			if (openAtChapter) await engine.goTo({ chapterId: openAtChapter });
			void loadLayers(book);
			void loadSpeech(book);
			void loadStory(book);
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

	function newVersionNotice({ moved, orphaned }: { moved: number; orphaned: number }): string {
		const items = (n: number) => `${n} ${n === 1 ? 'note or bookmark' : 'notes and bookmarks'}`;
		const base = 'This book has a new version.';
		if (orphaned === 0) return `${base} Your ${items(moved)} moved to it.`;
		return `${base} ${items(orphaned)} couldn’t be placed because their text changed; find them under “Orphaned” in Notes.`;
	}

	function listen(e: ReaderEngine) {
		offs.push(
			e.on('relocated', (range) => {
				const previous = visible;
				visible = range;
				if (
					!furthestSeen ||
					furthestSeen.revisionId !== range.last.revisionId ||
					range.last.ordinal > furthestSeen.ordinal
				) {
					furthestSeen = range.last;
				}
				if (toolbar && range.first.ordinal !== previous?.first.ordinal) closeToolbar();
				saver?.record(range);
				readingTime?.relocated(range, autoTurning);
				if (bookEnd !== null && range.last.ordinal >= bookEnd) readingTime?.finished();
				if (range.cause === 'turn' || range.cause === 'scroll') chrome = false;
				if (range.cause === 'link' && previous) showBack(previous.first);
				// Reading on from a search result: its highlight goes, and the next search starts here.
				if (
					searchMatch &&
					(range.cause === 'turn' || range.cause === 'scroll' || range.cause === 'link') &&
					performance.now() - resultShownAt > 600
				) {
					searchMatch = null;
				}
				if (prefs.focusMode && !focusMoving) void refocus(range);
				// Turning pages by hand with the player open: auto-turn waits (§8.3), and never
				// pulls the reader back while paused either.
				if (
					!autoTurning &&
					reading &&
					(range.cause === 'turn' || range.cause === 'scroll' || range.cause === 'link')
				) {
					reading.following = false;
				}
				announce(range);
			}),
			e.on('tap', ({ x }) => onTap(x)),
			e.on('selection', (selection) => {
				readingTime?.activity();
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
				// Tap to seek (§8.3): while narration or the voice plays, a Word moves it there.
				const tapped = manifest && chapterForOrdinal(manifest.chapters, anchor.ordinal);
				if (reading?.playing && tapped && reading.covers(tapped.chapterId)) {
					tapConsumed = true;
					void reading.seekToWord(tapped.chapterId, wordId);
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
			e.on('tableActivated', (view) => void openTable(view)),
			e.on('error', ({ message }) => snackbars.show(message, { tone: 'error' }))
		);
	}

	$effect(() => {
		const decorations = notes?.decorations;
		if (phase.kind === 'ready' && engine && decorations) {
			engine.setDecorations('annotations', decorations);
		}
	});

	$effect(() => {
		const match = searchMatch;
		if (phase.kind !== 'ready' || !engine) return;
		engine.setDecorations(
			'search',
			match ? [{ id: 'search', anchor: match, style: 'search' }] : []
		);
	});

	$effect(() => {
		const current = prefs.focusMode ? focused : null;
		if (phase.kind !== 'ready' || !engine || !manifest) return;
		engine.setDecorations(
			'focus',
			current
				? [
						{
							id: 'focus',
							style: 'focus',
							anchor: {
								kind: 'range',
								bookId: manifest.bookId,
								revisionId: manifest.revisionId,
								startWordId: current.paragraph.firstWordId,
								endWordId: current.paragraph.lastWordId,
								startOrdinal: current.paragraph.first,
								endOrdinal: current.paragraph.last,
								quote: { exact: '', prefix: '', suffix: '' }
							}
						}
					]
				: []
		);
	});

	// Focus mode on: focus the first paragraph on the page. Off: nothing is dimmed.
	$effect(() => {
		const on = prefs.focusMode;
		if (phase.kind !== 'ready' || !engine) return;
		if (on) void refocus(untrack(() => visible));
		else focused = null;
	});

	// Reading aloud in focus mode: the paragraph being read is the bright one.
	$effect(() => {
		const word = prefs.focusMode ? (reading?.word ?? null) : null;
		if (!word || phase.kind !== 'ready') return;
		void focusOrdinal(word.chapterId, word.ordinal);
	});

	// Creator mode: every placed picture's passage is underlined; the one just shown is marked.
	$effect(() => {
		const pack = creatorPack;
		const shown = shownPicture;
		if (phase.kind !== 'ready' || !engine || !pack) return;
		engine.setDecorations(
			'creator',
			pack.illustrations
				.filter((i) => i.anchorStatus !== 'orphaned')
				.map((i) => ({
					id: `creator-${i.id}`,
					anchor: i.anchor,
					style: i.id === shown ? ('search' as const) : ('underline' as const),
					color: 'highlight-3'
				}))
		);
	});

	// ---- Narration: the highlight, auto-turn, the hint (§8.3) ----

	$effect(() => {
		const word = reading?.word ?? null;
		// A voice that doesn't report Words can only show its sentence (P1-LAY-08).
		const mode =
			reading === speech && speech && !speech.wordTiming && prefs.narration.highlight === 'word'
				? 'sentence'
				: prefs.narration.highlight;
		if (phase.kind !== 'ready' || !engine || !manifest) return;
		engine.setDecorations(
			'narration',
			word && mode !== 'off'
				? [{ id: 'narration', anchor: narratedRange(word, mode), style: 'narration' }]
				: []
		);
	});

	function narratedRange(word: ReadWord, mode: 'word' | 'sentence'): RangeAnchor {
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

	function onScreen(word: ReadWord, range: VisibleRange | null): boolean {
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
		const source = reading;
		const word = source?.word ?? null;
		const chapterId = source === narration ? narration?.current?.chapterId : undefined;
		if (!source || phase.kind !== 'ready') return;
		if (word) void follow(word, visible);
		// A new Chapter's recording starts with its own introduction: turn to it already.
		else if (chapterId) void followChapter(chapterId, visible);
	});

	async function followChapter(chapterId: string, range: VisibleRange | null) {
		if (!engine || !reading || !range || autoTurning || range.chapterId === chapterId) return;
		if (!reading.following || !prefs.narration.autoTurn) return;
		autoTurning = true;
		try {
			await engine.goTo({ chapterId });
		} finally {
			autoTurning = false;
		}
	}

	async function follow(word: ReadWord, range: VisibleRange | null) {
		const source = reading;
		if (!engine || !source || !range || autoTurning) return;
		if (onScreen(word, range)) {
			source.following = true;
			return;
		}
		if (!source.following || !prefs.narration.autoTurn) return;
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

	function pointOf(word: ReadWord): PointAnchor {
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
		const source = reading;
		if (!source) return;
		source.following = true;
		const word = source.word;
		if (word && !onScreen(word, visible)) {
			autoTurning = true;
			try {
				await engine?.goTo(pointOf(word));
			} finally {
				autoTurning = false;
			}
		}
	}

	/**
	 * The play button: the first press starts narration from the first Word on the page where the
	 * reader has narration for this Chapter; otherwise the device voice reads it (P1-LAY-08),
	 * including where the Book's narration is one the reader doesn't own (D-036).
	 */
	async function readAloud() {
		if (reading) {
			await (reading === speech ? speech.toggle() : narration?.toggle());
			reportReadingError();
			return;
		}
		if (playsNarration) await playNarration();
		else if (speech?.available && speech.covers(visible?.chapterId)) await playDeviceVoice();
		else await playNarration();
	}

	function reportReadingError() {
		const error = reading?.error;
		if (error) snackbars.show(error, { tone: 'error' });
	}

	async function playDeviceVoice() {
		if (!speech) return;
		narration?.stop();
		await speech.toggle(
			visible ? { chapterId: visible.chapterId, ordinal: visible.first.ordinal } : undefined
		);
		reportReadingError();
		showReadAloudHint();
	}

	async function playNarration() {
		if (!narration) {
			snackbars.show('This device has no voice to read this book aloud.');
			return;
		}
		if (!narration.track?.entitled) {
			const slug = opened?.slug;
			snackbars.show('You don’t have the narration for this book yet.', {
				action: slug
					? {
							label: 'See it in the store',
							run: () => void goto(resolve('/(app)/book/[slug]', { slug }))
						}
					: undefined
			});
			return;
		}
		if (!narration.active && !narration.covers(visible?.chapterId)) {
			snackbars.show(`Narration covers ${narration.coverage}.`);
			return;
		}
		speech?.stop();
		await narration.toggle(
			visible ? { chapterId: visible.chapterId, ordinal: visible.first.ordinal } : undefined
		);
		if (narration.error) snackbars.show(narration.error, { tone: 'error' });
		showReadAloudHint();
	}

	/** The first time anything reads aloud: tapping a Word moves it there. */
	function showReadAloudHint() {
		if (!reading?.playing || preferences.current.hintsSeen.includes('narration')) return;
		narrationHint = true;
		clearTimeout(narrationHintTimer);
		// Seen once it has been up a while (the gesture is the same in every Book).
		narrationHintTimer = setTimeout(dismissNarrationHint, 8000);
	}

	function dismissNarrationHint() {
		narrationHint = false;
		clearTimeout(narrationHintTimer);
		if (preferences.current.hintsSeen.includes('narration')) return;
		void preferences.update({ hintsSeen: [...preferences.current.hintsSeen, 'narration'] });
	}

	function closeNarration() {
		narration?.stop();
		speech?.stop();
		playerExpanded = false;
		narrationHint = false;
	}

	/** The sleep timer (P1-LAY-09): the last choice is remembered, globally, but never re-armed. */
	function setSleep(choice: SleepTimerChoice | null) {
		reading?.setSleep(choice);
		if (choice !== null && choice !== preferences.current.narration.sleepTimer) {
			void preferences.update({ narration: { sleepTimer: choice } });
		}
	}

	$effect(() => {
		narration?.setRate(prefs.narration.rate);
	});

	$effect(() => {
		speech?.setRate(prefs.deviceVoice.rate);
	});

	/** The voice the reader chose for this Book's language (`deviceVoice.voices`). */
	const chosenVoice = $derived(
		manifest ? prefs.deviceVoice.voices[primaryLanguage(manifest.lang)] : undefined
	);
	$effect(() => {
		speech?.setVoice(chosenVoice);
	});

	function chooseVoice(voiceId: string) {
		if (!manifest) return;
		change({ deviceVoice: { voices: { [primaryLanguage(manifest.lang)]: voiceId } } });
	}

	/** The device voice can read any Book, even offline or without Layers (P1-LAY-08). */
	async function loadSpeech(book: OpenedBook) {
		if (creatorPack) return;
		try {
			// Loaded after the Book opens, so the reader route's first load doesn't carry it (§12.3).
			const { BookSpeech } = await import('./speech.svelte');
			const voice = new BookSpeech({
				speech: getPlatform().speech,
				manifest: book.manifest,
				textOf: (chapterId) => engine!.chapterText(chapterId)
			});
			await voice.load(chosenVoice);
			voice.setRate(prefs.deviceVoice.rate);
			speech = voice;
		} catch (error) {
			console.warn('The device voice didn’t load', error);
		}
	}

	// ---- The story so far (P1-RDR-13) ----

	/**
	 * A catalogue Book's recaps and glossary, fetched once, so the sheet works offline from then
	 * on. A reader back after a week or more is offered them, if there's something to show.
	 */
	async function loadStory(book: OpenedBook) {
		if (book.source !== 'catalogue' || studioMode) return;
		const loading = new BookStory(await getBackend(), bookId);
		story = loading;
		await loading.load();
		if (
			storyNudgeDue(lastReadAt, Date.now()) &&
			storyAt &&
			!storyHidden &&
			(storyAt.recaps.length > 0 || storyAt.glossary.length > 0)
		) {
			snackbars.show('Back after a while? Catch up with the story so far.', {
				action: { label: 'Story so far', run: () => openContents('story') }
			});
		}
	}

	async function showGlossary(entry: GlossaryEntryAt) {
		closeToolbar();
		glossaryEntry = entry;
		// Loads the first time it's used.
		GlossaryCardView ??= (await import('./GlossaryCard.svelte')).default;
		glossaryOpen = true;
	}

	// ---- Illustrations: loading, the panels' room, and in-text figures ----

	/** Pictures and narration are extra: the book reads fine without them (offline, an import). */
	async function loadLayers(book: OpenedBook) {
		try {
			const [backend, stores] = await Promise.all([getBackend(), getStores()]);
			void backend.catalogue.listBookmarkDesigns().then(
				(all) => (designs = all),
				() => {}
			);
			const pictures = new BookIllustrations(backend, stores, bookId, book.manifest.revisionId);
			if (creatorPack) {
				// Creator mode: the pack being built, as readers will see it; no narration.
				pictures.useDraft(creatorPack, book.manifest.creator);
				illustrations = pictures;
				return;
			}
			const layers = await backend.layers.list(bookId);
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

	/** "Open table" above a squeezed table: the viewer, loaded the first time (P1-RDR-12). */
	async function openTable(view: TableView) {
		try {
			TableViewerView ??= (await import('./TableViewer.svelte')).default;
		} catch (error) {
			console.error(error);
			snackbars.show('The table couldn’t open. Check your connection and try again.', {
				tone: 'error'
			});
			return;
		}
		table = view;
		tableOpen = true;
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

	function showBack(anchor: PointAnchor, ms = 10_000) {
		back = { anchor };
		clearTimeout(backTimer);
		backTimer = setTimeout(() => (back = null), ms);
	}

	/** A jump the reader may want to undo: TOC, scrubber, chapter start or end (§4.1 "Back"). */
	async function jump(target: Parameters<ReaderEngine['goTo']>[0]) {
		if (!engine) return;
		if (reading) reading.following = false;
		const from = visible?.first;
		await engine.goTo(target);
		if (from) showBack(from);
	}

	async function goBack() {
		if (!back || !engine) return;
		const target = back.anchor;
		back = null;
		clearTimeout(backTimer);
		searchMatch = null;
		searchOrigin = null;
		await engine.goTo(target);
	}

	// ---- Search in the Book (P1-RDR-10) ----

	/** Opens search, loading it the first time (new reader features load on first use). */
	async function openSearch() {
		const e = engine;
		const m = manifest;
		if (!e || !m || phase.kind !== 'ready') return;
		if (!search || !SearchView) {
			try {
				const [{ BookSearch }, sheet] = await Promise.all([
					import('./search.svelte'),
					import('./SearchSheet.svelte')
				]);
				search = new BookSearch({ manifest: m, textOf: (chapterId) => e.chapterText(chapterId) });
				SearchView = sheet.default;
				void search.prepare();
			} catch (error) {
				console.error(error);
				snackbars.show('Search couldn’t open. Check your connection and try again.', {
					tone: 'error'
				});
				return;
			}
		}
		// A new search starts from here, unless the reader is still at a result they jumped to.
		if (!searchMatch || !searchOrigin) searchOrigin = visible?.first ?? null;
		searchOpen = true;
	}

	/** Jumps to a result and marks it; Back returns to where the reader was before searching. */
	async function showResult(hit: SearchHit) {
		if (!engine || !manifest) return;
		const range: RangeAnchor = {
			kind: 'range',
			bookId: manifest.bookId,
			revisionId: manifest.revisionId,
			startWordId: hit.startWordId,
			endWordId: hit.endWordId,
			startOrdinal: hit.startOrdinal,
			endOrdinal: hit.endOrdinal,
			quote: { exact: hit.match, prefix: '', suffix: '' }
		};
		if (reading) reading.following = false;
		searchMatch = range;
		resultShownAt = performance.now();
		await engine.goTo(range);
		resultShownAt = performance.now();
		announcement = `Result: ${hit.before}${hit.match}${hit.after}`;
		if (searchOrigin) showBack(searchOrigin, 60_000);
	}

	// ---- Focus mode (P1-RDR-11) ----

	function paragraphCache(): ParagraphCache {
		return (paragraphs ??= new ParagraphCache((chapterId) => engine!.chapterText(chapterId)));
	}

	/**
	 * Focuses a paragraph on the page, unless the focused one is still on it: when focus mode
	 * comes on, and when the reader moves by other means (a swipe, a jump). `end`: the last one
	 * that starts on the page, stepping back into a Chapter.
	 */
	async function refocus(range: VisibleRange | null, end: 'start' | 'end' = 'start') {
		if (!range || !prefs.focusMode || !engine) return;
		const list = await paragraphCache().get(range.chapterId);
		const current = focused;
		if (
			end === 'start' &&
			current?.chapterId === range.chapterId &&
			current.paragraph.last >= range.first.ordinal &&
			current.paragraph.first <= range.last.ordinal
		) {
			return;
		}
		const i = focusOnPage(list, { first: range.first.ordinal, last: range.last.ordinal }, end);
		focused = i >= 0 ? { chapterId: range.chapterId, paragraph: list[i]! } : null;
	}

	async function focusOrdinal(chapterId: string, ordinal: number) {
		const current = focused;
		if (
			current?.chapterId === chapterId &&
			ordinal >= current.paragraph.first &&
			ordinal <= current.paragraph.last
		) {
			return;
		}
		const list = await paragraphCache().get(chapterId);
		const i = paragraphAt(list, ordinal);
		if (i >= 0) focused = { chapterId, paragraph: list[i]! };
	}

	/** The next (+1) or previous (-1) paragraph, turning the page when it has to. */
	async function focusStep(dir: 1 | -1) {
		const range = visible;
		if (!engine || !range || !manifest || focusMoving) return;
		const list = await paragraphCache().get(range.chapterId);
		const page = { first: range.first.ordinal, last: range.last.ordinal };
		const current = focused;
		let index =
			current?.chapterId === range.chapterId ? paragraphAt(list, current.paragraph.first) : -1;
		if (index < 0) index = focusOnPage(list, page);
		const next = step(list, index, page, dir);
		focusMoving = true;
		try {
			if (next.kind === 'turn') {
				if (list[index]) focused = { chapterId: range.chapterId, paragraph: list[index] };
				await turn(dir);
			} else if (next.kind === 'focus') {
				const paragraph = list[next.index]!;
				focused = { chapterId: range.chapterId, paragraph };
				if (next.turn) {
					await turn(dir);
					const now = engine.getVisibleRange();
					if (now && (paragraph.last < now.first.ordinal || paragraph.first > now.last.ordinal)) {
						await engine.goTo({
							kind: 'point',
							bookId: manifest.bookId,
							revisionId: manifest.revisionId,
							wordId: paragraph.firstWordId,
							ordinal: paragraph.first,
							quote: { exact: '', prefix: '', suffix: '' }
						});
					}
				}
			} else {
				await turn(dir);
				focused = null;
				await refocus(engine.getVisibleRange(), dir > 0 ? 'start' : 'end');
			}
		} finally {
			focusMoving = false;
		}
	}

	function onTap(x: number) {
		readingTime?.activity();
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
		// In focus mode the sides move the focus a paragraph at a time (it turns pages as needed).
		const move = (dir: 1 | -1) => void (prefs.focusMode ? focusStep(dir) : turn(dir));
		if (f < 0.25) move(isRtl ? 1 : -1);
		else if (f > 0.75) move(isRtl ? -1 : 1);
		else chrome = !chrome;
	}

	function anyOverlayOpen() {
		return (
			contentsOpen ||
			prefsOpen ||
			shortcutsOpen ||
			searchOpen ||
			textDialog !== null ||
			layersOpen ||
			cardOpen ||
			lightboxOpen ||
			tableOpen ||
			glossaryOpen
		);
	}

	function onKey(event: KeyboardEvent) {
		readingTime?.activity();
		if (phase.kind !== 'ready' || anyOverlayOpen()) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest?.('input, textarea, [role="slider"]')) return;
		// The "Open table" button in the book presses with Enter and Space, not turn the page.
		if ((event.key === ' ' || event.key === 'Enter') && target?.closest?.('[data-rd-table]')) {
			return;
		}
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
		} else if (!ctrl && !event.altKey && event.key === '/') {
			event.preventDefault();
			void openSearch();
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
			prefs.focusMode &&
			(event.key === forward || event.key === 'ArrowDown' || (event.key === ' ' && !event.shiftKey))
		) {
			event.preventDefault();
			void focusStep(1);
		} else if (
			prefs.focusMode &&
			(event.key === backward || event.key === 'ArrowUp' || (event.key === ' ' && event.shiftKey))
		) {
			event.preventDefault();
			void focusStep(-1);
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
		const created = await notes.addBookmark(
			visible.first,
			undefined,
			preferences.current.bookmarkDesignProductId
		);
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

{#if creatorPack}
	<!-- Creator mode (P1-LAY-05): always visible, so it's clear these pictures aren't public yet. -->
	<div class="creator-bar" data-testid="creator-bar">
		<span class="creator-label"><strong>Creator mode</strong> · {creatorPack.name}</span>
		<span class="creator-count">{creatorCount}</span>
		<Button variant="text" icon="photo_library" onclick={() => (picturesOpen = true)}
			>Pictures</Button
		>
		<Button variant="text" icon="edit" onclick={() => (packDetailsOpen = true)}>Details</Button>
		{#if creatorPack.listingState === 'listed'}
			<Badge tone="primary" icon="public">Published</Badge>
		{:else if ['pending', 'held', 'removed'].includes(creatorPack.listingState)}
			<Badge tone={listingStateTones[creatorPack.listingState]}
				>{listingStateLabels[creatorPack.listingState]}</Badge
			>
		{:else}
			<Button
				variant="tonal"
				icon="publish"
				pending={publishingPack}
				onclick={() => void publishPack()}
				>{creatorPack.isOfficial ? 'Publish pack' : 'Submit pack'}</Button
			>
		{/if}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- doneHref resolves -->
		<Button variant="text" href={doneHref}>Done</Button>
	</div>
	{#if creatorPack.relabelRequired}
		<p class="relabel" role="status">
			A moderator asked you to correct this pack’s AI label. Answer the AI question again in
			Details, and they’ll review it.
		</p>
	{/if}
{:else if preview}
	<div class="creator-bar" data-testid="preview-bar">
		<span class="creator-label"><strong>Preview</strong> · only you can see this version</span>
		<Button variant="text" href={resolve('/(app)/studio/books/[bookId]', { bookId })}>Done</Button>
	</div>
{/if}

<!-- data-first/last: the visible Words; data-narrated: the narrated one. For tests, never stored. -->
<div
	class={['reader', { 'chrome-hidden': !chrome, studio: studioMode }]}
	style={themeStyle}
	style:--panel-width={`${panelWidth}px`}
	style:--panel-height={`${panelHeight}px`}
	data-testid="reader"
	data-ready={phase.kind === 'ready' || undefined}
	data-first={visible?.first.ordinal}
	data-last={visible?.last.ordinal}
	data-first-word={visible?.first.quote.exact}
	data-narrated={reading?.word?.ordinal}
	data-narrated-start={reading === narration ? narration?.word?.startMs : undefined}
	data-following={reading?.following}
>
	<header class="bar top" inert={!chrome || undefined}>
		<IconButton icon="arrow_back" label="Back to library" href={resolve('/library')} />
		<div class="titles">
			<span class="book-title"
				>{manifest?.title ?? ''}{#if opened?.access === 'sample'}<Badge tone="primary">Sample</Badge
					>{/if}</span
			>
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
		{#if compact}
			<!-- On a phone the titles keep their room: the rest is under "More" (Phase 1.13). -->
			<IconButton
				icon="toc"
				label="Contents and notes"
				disabled={phase.kind !== 'ready'}
				onclick={() => openContents('contents')}
			/>
			{#if phase.kind === 'ready'}
				<Menu label="More reading options" items={moreItems} />
			{:else}
				<IconButton icon="more_vert" label="More reading options" disabled />
			{/if}
		{:else}
			{#if illustrations?.packs.length}
				<IconButton
					icon="photo_library"
					label="Illustrations"
					onclick={() => (layersOpen = true)}
				/>
			{/if}
			<IconButton
				icon="search"
				label="Search in this book"
				disabled={phase.kind !== 'ready'}
				onclick={() => void openSearch()}
			/>
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
		{/if}
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
		<!-- A ribbon on the page edge in the bookmark's Bookmark Design (§9.3, P1-STO-03). -->
		{@const design = designOf(pageBookmarks[0])}
		<div
			class="ribbon"
			data-testid="bookmark-ribbon"
			data-design={design?.productId}
			aria-hidden="true"
		>
			{#if design}<BookmarkRibbon look={design.look} />{:else}<span class="plain"></span>{/if}
		</div>
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
	<div class={['dock', { player: !!reading, lowered: !chrome }]}>
		{#if back || (reading && !reading.following)}
			<div class="chips">
				{#if back}
					<Button variant="tonal" icon="undo" onclick={goBack}>Back</Button>
				{/if}
				{#if reading && !reading.following}
					<Button variant="tonal" icon="headphones" onclick={() => void backToNarration()}
						>{reading === speech ? 'Back to the voice' : 'Back to narration'}</Button
					>
				{/if}
			</div>
		{/if}
		{#if reading}
			{#if narrationHint}
				<div class="narration-hint" role="status" data-testid="narration-hint">
					<span
						>Tap any word to move {reading === speech ? 'the voice' : 'the narration'} there.</span
					>
					<IconButton icon="close" size="small" label="Got it" onclick={dismissNarrationHint} />
				</div>
			{/if}
			{#if reading === speech}
				<NarrationPlayer
					source={{ kind: 'device', speech, storeHref: narrationInStore ? storeHref : null }}
					prefs={prefs.narration}
					rate={prefs.deviceVoice.rate}
					bind:expanded={playerExpanded}
					onchange={(patch) => change({ narration: patch })}
					onrate={(rate) => change({ deviceVoice: { rate } })}
					onvoice={chooseVoice}
					onsleep={setSleep}
					onclose={closeNarration}
				/>
			{:else if narration}
				<NarrationPlayer
					source={{ kind: 'narration', narration }}
					prefs={prefs.narration}
					rate={prefs.narration.rate}
					bind:expanded={playerExpanded}
					onchange={(patch) => change({ narration: patch })}
					onrate={(rate) => change({ narration: { rate } })}
					onsleep={setSleep}
					onclose={closeNarration}
				/>
			{/if}
		{/if}
	</div>

	{#if atReadableEnd && !endDismissed && locked[0]}
		{@const next = locked[0]}
		<div class="end-card" role="status" data-testid="locked-end">
			{#if next.reason === 'sample'}
				<p class="end-title">That’s the end of the sample</p>
				<p>Get <strong>{manifest?.title}</strong> to keep reading.</p>
				<div class="end-actions">
					<Button variant="text" onclick={() => (endDismissed = true)}>Not now</Button>
					{#if storeHref}<Button href={storeHref}>Get the book</Button>{/if}
				</div>
			{:else if next.reason === 'scheduled'}
				<p class="end-title">Next: {next.title}</p>
				<p>
					It comes out {next.releaseAt ? formatDayTime(next.releaseAt) : 'soon'}. Follow {next.creatorName}
					to hear when it’s out.
				</p>
				<div class="end-actions">
					<Button variant="text" onclick={() => (endDismissed = true)}>Not now</Button>
					{#if next.creatorHandle}
						<Button
							variant="tonal"
							icon="person"
							href={resolve('/(app)/creator/[handle]', { handle: next.creatorHandle })}
							>{next.creatorName}</Button
						>
					{/if}
				</div>
			{:else}
				<p class="end-title">Next: {next.title}</p>
				<p>
					It’s early access for {next.creatorName}’s subscribers{next.freeAt
						? `, and free for everyone who owns the book from ${formatDate(next.freeAt)}`
						: ''}.
				</p>
				<div class="end-actions">
					<Button variant="text" onclick={() => (endDismissed = true)}>Not now</Button>
					{#if next.planId}
						<Button icon="card_membership" onclick={() => void subscribeForEarlyAccess()}
							>Subscribe</Button
						>
					{/if}
				</div>
			{/if}
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
		{#if narration?.track || speech?.available}
			<!-- Unavailable here: it looks disabled but still says why when pressed. -->
			<IconButton
				icon={reading?.playing ? 'pause' : reading ? 'play_arrow' : 'headphones'}
				label={listenLabel}
				aria-disabled={!reading && !playsNarration && !voiceHere ? 'true' : undefined}
				aria-describedby={!reading && !playsNarration && !voiceHere
					? 'narration-reason'
					: undefined}
				disabled={phase.kind !== 'ready' || !!narration?.loading || !!speech?.loading}
				onclick={() => void readAloud()}
			/>
			<span id="narration-reason" class="visually-hidden"
				>{!narration?.track
					? 'There’s nothing to read aloud on this page.'
					: narration.track.entitled
						? `Narration covers ${narration.coverage}.`
						: 'You don’t have the narration for this book yet.'}</span
			>
		{/if}
		<Scrubber
			progression={visible?.progression ?? 0}
			chapters={scrubberChapters}
			{timeLeftAt}
			oncommit={(progression) => jump({ progression })}
		/>
		<span class="where">
			<!-- "in this chapter" (§9.2) is for screen readers; the bar has no room for it on phones. -->
			<span class="page" data-testid="page-label"
				>{pageLabel}{#if visible?.pageInChapter}<span class="visually-hidden"
						>{IN_THIS_CHAPTER}</span
					>{/if}</span
			>
			{#if timeLeftInChapter}
				<span class="time-left" data-testid="time-left"
					>{timeLeftInChapter}<span class="in-chapter">{IN_CHAPTER}</span></span
				>
			{/if}
		</span>
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
		locked={locked.map((l) => ({ chapterId: l.chapterId, title: l.title, note: lockedNote(l) }))}
		onlocked={() => {
			endDismissed = false;
			void jump({ progression: 1 });
		}}
		designs={ownedDesigns}
		designOf={(b) => designOf(b)}
		ondesignbookmark={(b, productId) => void notes?.designBookmark(b.id, productId)}
		story={story && (story.story || story.status === 'error') ? story : undefined}
		{storyAt}
		{storyHidden}
		titleOf={(chapterId) => {
			const c = manifest.chapters.find((ch) => ch.chapterId === chapterId);
			return c ? chapterTitleAt(manifest, c.firstOrdinal) : '';
		}}
	/>
	{#if GlossaryCardView}
		<GlossaryCardView
			bind:open={glossaryOpen}
			entry={glossaryEntry}
			where={glossaryEntry
				? chapterTitleAt(manifest, glossaryEntry.firstAppearance.startOrdinal)
				: ''}
			onfirst={() => {
				if (glossaryEntry) void jump(glossaryEntry.firstAppearance);
			}}
		/>
	{/if}
{/if}

<SubscribeSheet
	bind:open={subscribeOpen}
	plan={earlyPlan}
	ondone={() => {
		snackbars.show('Early access is open. Opening the new chapters…');
		setTimeout(() => void reopen(), 1200);
	}}
/>

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
		onattach={creatorPack && toolbar.kind === 'selection' ? attachFromToolbar : undefined}
		onglossary={selectedEntry ? () => void showGlossary(selectedEntry) : undefined}
		onclose={closeToolbar}
	/>
{/if}

{#if creatorPack}
	<AttachIllustration
		bind:open={attachOpen}
		packId={creatorPack.id}
		anchor={attaching?.anchor}
		passage={attaching?.passage}
		editing={editingPicture}
		onsaved={(pack) => {
			packChanged(pack);
			snackbars.show(editingPicture ? 'Picture saved.' : 'Picture attached.');
		}}
	/>
	<LayerDetailsDialog
		bind:open={packDetailsOpen}
		kind="pack"
		{bookId}
		existing={{
			id: creatorPack.id,
			name: creatorPack.name,
			description: creatorPack.description,
			credit: creatorPack.credit,
			price: creatorPack.price,
			aiUse: creatorPack.aiUse
		}}
		onsaved={() => {
			void reloadPack();
			snackbars.show('Saved.');
		}}
	/>
	<PackPictures
		bind:open={picturesOpen}
		pack={creatorPack}
		thumbnail={(ill) => illustrations?.url(creatorPack!.id, ill, 56) ?? Promise.resolve(null)}
		onshow={(ill) => void showPicture(ill)}
		onedit={editPicture}
		onremove={(ill) => void removePicture(ill)}
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
{#if search && SearchView}
	<SearchView bind:open={searchOpen} {search} onresult={(hit) => void showResult(hit)} />
{/if}

{#if illustrations}
	<LayersSheet
		bind:open={layersOpen}
		mode={prefs.illustrations}
		{illustrations}
		onmode={(illustrationsMode) => change({ illustrations: illustrationsMode })}
		{storeHref}
		hideAi={prefs.hideAiGenerated}
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
{#if TableViewerView}
	<TableViewerView bind:open={tableOpen} view={table} />
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

	/* Below the Creator mode or preview bar, which takes the safe area at the top. */
	.reader.studio {
		top: calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) + 48px);
		--safe-top: 0px;
	}

	.creator-bar {
		position: fixed;
		top: 0;
		right: 0;
		left: 0;
		z-index: 8;
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: var(--space-2);
		min-height: 48px;
		padding: var(--safe-top) calc(var(--space-2) + var(--safe-right)) 0
			calc(var(--space-3) + var(--safe-left));
		overflow-x: auto;
		background: var(--md-sys-color-tertiary-container);
		color: var(--md-sys-color-on-tertiary-container);
		--md-sys-color-primary: var(--md-sys-color-on-tertiary-container);
	}

	.relabel {
		position: fixed;
		top: calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) + 48px);
		right: 0;
		left: 0;
		z-index: 8;
		margin: 0;
		padding: var(--space-2) var(--space-4);
		background: var(--md-sys-color-error-container);
		color: var(--md-sys-color-on-error-container);
	}

	.creator-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.creator-count {
		flex: none;
		font-size: var(--md-sys-typescale-body-small-size);
	}

	@media (max-width: 599.98px) {
		.creator-count {
			display: none;
		}
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

	.where {
		display: grid;
		flex: none;
		justify-items: center;
		min-width: 6.5em;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
		line-height: 1.3;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	/* On a phone the bar has room for "8 min left" under the page; "in chapter" is still read out. */
	@media (max-width: 599.98px) {
		.in-chapter {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
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
		display: flex;
		pointer-events: none;
	}

	/* Before the designs have loaded: the default look. */
	.ribbon .plain {
		width: 22px;
		height: 44px;
		background: var(--md-sys-color-primary);
		clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%);
	}

	.end-card {
		position: absolute;
		right: calc(var(--safe-right) + var(--space-4));
		bottom: calc(var(--safe-bottom) + 96px);
		left: calc(var(--safe-left) + var(--space-4));
		z-index: 6;
		display: grid;
		gap: var(--space-2);
		max-width: 28rem;
		margin-inline: auto;
		padding: var(--space-4) var(--space-4) var(--space-2);
		border-radius: var(--md-sys-shape-corner-large);
		background: var(--md-sys-color-surface-container-high);
		color: var(--md-sys-color-on-surface);
		box-shadow: var(--md-sys-elevation-3);
	}

	.end-card p {
		margin: 0;
	}

	.end-title {
		font-size: var(--md-sys-typescale-title-medium-size);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.end-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.book-title :global(.badge) {
		margin-inline-start: var(--space-2);
		vertical-align: middle;
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
