/**
 * The `ReaderEngine` interface (DESIGN.md §9.1). App code talks only to this; `FoliateEngine` is
 * the one implementation (ADR-001). Positions in and out are Anchors (Invariant 2): the engine's
 * own Locators (a section index and a DOM Range) never leave this package and are never stored.
 */
import type {
	Anchor,
	LayoutMode,
	PointAnchor,
	RangeAnchor,
	RevisionManifest,
	WordId
} from '@book/core';

export type { LayoutMode };

/** Reads a Revision's files by path (§6.7): from IndexedDB now, from a content token in Phase 2. */
export interface ContentLoader {
	read(path: string): Promise<Blob>;
}

export interface PublicationHandle {
	manifest: RevisionManifest;
	loader: ContentLoader;
}

export interface VisibleRange {
	chapterId: string;
	first: PointAnchor;
	last: PointAnchor;
	/** 0..1 across the whole Book, from the first visible Word's Ordinal. */
	progression: number;
	/** Display only, never stored (Invariant 1). Absent in scroll mode. */
	pageInChapter?: { index: number; count: number };
	/** Why it moved: a page turn or swipe, a jump we asked for, a link in the book, scrolling. */
	cause?: 'turn' | 'navigation' | 'link' | 'scroll';
}

/**
 * `focus` (P1-RDR-11) marks the passage to keep bright: every other paragraph of the Chapter is
 * dimmed. The rest are painted over the text without changing the layout.
 */
export type DecorationStyle = 'highlight' | 'underline' | 'narration' | 'search' | 'focus';

export interface Decoration {
	id: string;
	anchor: RangeAnchor;
	style: DecorationStyle;
	/** A token name such as `highlight-3`, never a raw colour. */
	color?: string;
}

export interface FigureInjection {
	id: string;
	anchor: Anchor;
	placement: 'inline' | 'full_page';
	/** A local blob URL (PoC) or content-token URL (Phase 2+). */
	src: string;
	srcset?: string;
	alt: string;
	caption?: string;
	/** The image's size, so its space is kept while it loads and the pages don't shift. */
	width?: number;
	height?: number;
}

/** A Chapter's Words in reading order, with their text (narration's sentences, §8.3). */
export interface ChapterText {
	chapterId: string;
	/** A Word's Ordinal is this plus its position. */
	firstOrdinal: number;
	wordIds: WordId[];
	/** Each Word as on the page, with its punctuation: `“Well!”` (`DocWordMap.punctuatedTexts`). */
	texts: string[];
	/** Each Word's Block, so paragraphs and headings can be told apart. */
	blocks: number[];
}

export interface TypographySettings {
	/** A CSS font-family list, or null to keep the book's own fonts ("Publisher default"). */
	fontFamily: string | null;
	/** 0.75–2.5. */
	fontScale: number;
	lineHeight: number;
	/** em. */
	paragraphSpacing: number;
	margins: 'narrow' | 'normal' | 'wide';
	justify: boolean;
	hyphenate: boolean;
}

/** Concrete colours for the reading surface: the reader's frames can't see the app's CSS. */
export type ReaderThemeTokens = Record<`--${string}`, string>;

export type PageTurn = 'none' | 'slide' | 'fade';

export interface EngineOptions {
	layout: LayoutMode;
	typography: TypographySettings;
	theme: ReaderThemeTokens;
	pageTurn: PageTurn;
	/** @font-face rules for the reading fonts, with absolute URLs. */
	fontFaceCss: string;
	/** Where to open; the first linear Chapter when absent. */
	start?: Anchor | { progression: number };
}

export interface EngineEvents {
	relocated: VisibleRange;
	/**
	 * The reader's selection, snapped to whole Words (Invariant 5), once it has settled: after the
	 * mouse button is released, or after a pause while touch handles are dragged.
	 */
	selection: {
		anchor: RangeAnchor;
		text: string;
		clientRect: DOMRect;
		pointer: 'mouse' | 'touch' | 'pen' | 'keyboard';
	} | null;
	/** A tap or click on a Word. */
	wordActivated: { wordId: WordId; anchor: PointAnchor; clientRect: DOMRect };
	/**
	 * A right-click (or long-press) in the book: the selection, if any, and the Word under the
	 * pointer. Call `preventDefault` to replace the browser's own menu.
	 */
	contextMenu: {
		anchor: RangeAnchor | null;
		word: PointAnchor | null;
		x: number;
		y: number;
		pointer: 'mouse' | 'touch' | 'pen';
		preventDefault: () => void;
	};
	figureActivated: { id: string };
	/** A tap outside any link or Word, in top-level coordinates (tap zones, §9.2). */
	tap: { x: number; y: number };
	/** Keys pressed while focus is inside the book, so shortcuts work there too. */
	keydown: KeyboardEvent;
	/** A link out of the book; the app decides how to open it. */
	externalLink: { href: string };
	/** Pinch or Ctrl+wheel over the book: a text-size factor (§4.1 text zoom). `done` on release. */
	pinch: { scale: number; done: boolean };
	error: { code: string; message: string };
}

export type EngineEvent = keyof EngineEvents;

export interface ReaderEngine {
	mount(el: HTMLElement, publication: PublicationHandle, opts: EngineOptions): Promise<void>;
	destroy(): void;

	goTo(target: Anchor | { progression: number } | { chapterId: string }): Promise<void>;
	next(): Promise<void>;
	prev(): Promise<void>;

	setLayout(mode: LayoutMode): Promise<void>;
	setTypography(t: TypographySettings): Promise<void>;
	setTheme(tokens: ReaderThemeTokens): void;
	setPageTurn(turn: PageTurn): void;

	/** Replaces a group's decorations (e.g. `annotations`, `narration`). */
	setDecorations(group: string, items: Decoration[]): void;
	/** Replaces all injected figures (`in-text` Illustrations, §8.2); re-paginates, keeping place. */
	injectFigures(items: FigureInjection[]): void;
	/**
	 * Re-lays out around a change to the element the book is mounted in (a panel opening beside
	 * it), keeping the first visible Word on screen (§9.1). `change` makes the change.
	 */
	relayout(change: () => void | Promise<void>): Promise<void>;

	getVisibleRange(): VisibleRange | null;
	/**
	 * Selects whole Words on screen by Ordinal (keyboard selection), or clears the selection with
	 * `null`. The result arrives as a `selection` event with its Anchor.
	 */
	select(range: { startOrdinal: number; endOrdinal: number } | null): void;
	/** Where an Anchor is on screen, in top-level coordinates, or null when it isn't shown. */
	rectOf(anchor: Anchor): DOMRect | null;
	/** A Chapter's Words with their text, read from the Revision (it needn't be on screen). */
	chapterText(chapterId: string): Promise<ChapterText>;
	on<E extends EngineEvent>(event: E, cb: (payload: EngineEvents[E]) => void): () => void;
}
