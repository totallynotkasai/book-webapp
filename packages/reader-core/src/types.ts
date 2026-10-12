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

export type DecorationStyle = 'highlight' | 'underline' | 'narration' | 'search';

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
	selection: { anchor: RangeAnchor; text: string; clientRect: DOMRect } | null;
	/** A tap or click on a Word. */
	wordActivated: { wordId: WordId; anchor: PointAnchor };
	contextMenu: { anchor: RangeAnchor | null; x: number; y: number };
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
	/** Replaces all injected figures (`in-text` Illustrations, §8.2). */
	injectFigures(items: FigureInjection[]): void;

	getVisibleRange(): VisibleRange | null;
	on<E extends EngineEvent>(event: E, cb: (payload: EngineEvents[E]) => void): () => void;
}
