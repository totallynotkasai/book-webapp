/**
 * Reader Preferences (docs/DESIGN.md §9.4): typography, layout, theme and playback.
 * Stored globally per user with optional per-Book overrides. Stored values are always merged
 * over the defaults and validated field by field, so adding a field never breaks old data.
 */
import { z } from 'zod';

export const layoutModes = ['paginated-single', 'paginated-spread', 'scroll'] as const;
export type LayoutMode = (typeof layoutModes)[number];

/** Curated, self-hosted reading fonts (§11.3), plus the EPUB's own. */
export const fontIds = [
	'literata',
	'source-serif-4',
	'merriweather',
	'nunito',
	'atkinson-hyperlegible',
	'opendyslexic',
	'publisher'
] as const;
export type FontId = (typeof fontIds)[number];

/** `custom`: the reader's own page and text colours (P1-UI-04), in `theme.custom`. */
export const themeModes = ['system', 'light', 'dark', 'sepia', 'custom'] as const;
export type ThemeMode = (typeof themeModes)[number];

export const contrastLevels = ['standard', 'medium', 'high'] as const;
export type ContrastLevel = (typeof contrastLevels)[number];

export const illustrationModes = ['popup', 'per-page', 'spread', 'in-text', 'off'] as const;
export type IllustrationMode = (typeof illustrationModes)[number];

export const FONT_SCALE = { min: 0.75, max: 2.5, step: 0.05 } as const;
export const LINE_HEIGHT = { min: 1.2, max: 2 } as const;
export const PARAGRAPH_SPACING = { min: 0, max: 1.5 } as const;
export const NARRATION_RATE = { min: 0.5, max: 3 } as const;

/** The sleep timer's choices (P1-LAY-09): minutes of listening, or the end of the Chapter. */
export const sleepTimerChoices = [5, 15, 30, 60, 'chapter'] as const;
export type SleepTimerChoice = (typeof sleepTimerChoices)[number];

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

/**
 * The reader's own page and text colours (P1-UI-04), as `#rrggbb`. A pair below WCAG AA is
 * stored only once the reader has chosen to keep it after a warning (D-041).
 */
const customColoursSchema = z.object({
	page: z.string().regex(HEX_COLOUR),
	text: z.string().regex(HEX_COLOUR)
});
export type CustomColours = z.infer<typeof customColoursSchema>;

const themeSchema = z.object({
	mode: z.enum(themeModes).catch('system'),
	contrast: z.enum(contrastLevels).catch('standard'),
	seedColor: z.string().regex(HEX_COLOUR).optional().catch(undefined),
	/** Used when `mode` is `custom`; kept while another mode is chosen, for next time. */
	custom: customColoursSchema.optional().catch(undefined)
});

const narrationSchema = z.object({
	rate: z.number().min(NARRATION_RATE.min).max(NARRATION_RATE.max).catch(1),
	autoTurn: z.boolean().catch(true),
	highlight: z.enum(['word', 'sentence', 'off']).catch('word'),
	/**
	 * The reader's last sleep-timer choice (P1-LAY-09), for narration and the device voice alike:
	 * the player marks it. Remembered, never armed by itself.
	 */
	sleepTimer: z.literal(sleepTimerChoices).optional().catch(undefined)
});

/**
 * The device voice (P1-LAY-08): its own speed, since a synthetic voice at 1× isn't a narrator's
 * pace, and the reader's chosen voice for each language (by its primary subtag, `en`), so a
 * French Book doesn't pick up an English voice. Highlighting and auto-turn are narration's.
 */
const deviceVoiceSchema = z.object({
	rate: z.number().min(NARRATION_RATE.min).max(NARRATION_RATE.max).catch(1),
	voices: z.record(z.string(), z.string().min(1)).catch({})
});

/** Validates and completes preferences: missing or invalid fields take their defaults. */
export const readerPreferencesSchema = z.object({
	layout: z.enum(['auto', ...layoutModes]).catch('auto'),
	fontFamily: z.enum(fontIds).catch('literata'),
	fontScale: z.number().min(FONT_SCALE.min).max(FONT_SCALE.max).catch(1),
	lineHeight: z.number().min(LINE_HEIGHT.min).max(LINE_HEIGHT.max).catch(1.6),
	paragraphSpacing: z.number().min(PARAGRAPH_SPACING.min).max(PARAGRAPH_SPACING.max).catch(0.8),
	margins: z.enum(['narrow', 'normal', 'wide']).catch('normal'),
	justify: z.boolean().catch(false),
	hyphenate: z.boolean().catch(false),
	theme: z.preprocess(objectOrEmpty, themeSchema),
	/** `curl`: the page curl (P1-RDR-19), an optional page turn. */
	pageTurn: z.enum(['none', 'slide', 'fade', 'curl']).catch('slide'),
	illustrations: z.enum(illustrationModes).catch('popup'),
	/** Dim everything but the paragraph being read (P1-RDR-11). */
	focusMode: z.boolean().catch(false),
	/**
	 * Reading time left beside the page indicator, from the reader's own pace (P1-RDR-14). Off
	 * also stops learning the pace. On by default (D-040).
	 */
	timeLeft: z.boolean().catch(true),
	narration: z.preprocess(objectOrEmpty, narrationSchema),
	deviceVoice: z.preprocess(objectOrEmpty, deviceVoiceSchema),
	/** One-off hints the reader has dismissed (e.g. `illustrations`), kept with their settings. */
	hintsSeen: z.array(z.string()).catch([]),
	/** Hide AI-generated Books and Layers in the store, the Layers menu and community (§10.6). */
	hideAiGenerated: z.boolean().catch(false),
	/**
	 * Keep reading stats, a streak and achievements on this device (P1-RDR-15). Off hides them
	 * and stops collecting. On by default (D-040). Global only: a Book's override is ignored.
	 */
	readingStats: z.boolean().catch(true),
	/**
	 * Other readers' comments, as a count beside each paragraph that has some (P1-COM-03). Off by
	 * default. Per Book only (D-044): a global value is ignored (`BOOK_ONLY_PREFERENCES`).
	 */
	comments: z.boolean().catch(false),
	/** Passages many readers highlighted, underlined faintly (P1-COM-04). Off; per Book only. */
	popularHighlights: z.boolean().catch(false),
	/** The Bookmark Design new Placed Bookmarks use; the default design when unset (P1-STO-03). */
	bookmarkDesignProductId: z.string().min(1).optional().catch(undefined)
});

export type ReaderPreferences = z.infer<typeof readerPreferencesSchema>;

/** What a store holds: any subset, including partial nested groups. */
export type ReaderPreferencesPatch = Partial<
	Omit<ReaderPreferences, 'theme' | 'narration' | 'deviceVoice'> & {
		theme: Partial<ReaderPreferences['theme']>;
		narration: Partial<ReaderPreferences['narration']>;
		deviceVoice: Partial<ReaderPreferences['deviceVoice']>;
	}
>;

export const defaultReaderPreferences: ReaderPreferences = Object.freeze(
	readerPreferencesSchema.parse({})
);

/**
 * Preferences a reader sets for one Book at a time (D-044): other readers' comments and popular
 * highlights. They live in a Book's override, but don't make it a Book with its own settings
 * ("This book only"), and resetting a Book's settings keeps them.
 */
export const BOOK_ONLY_PREFERENCES = ['comments', 'popularHighlights'] as const;
export type BookOnlyPreference = (typeof BOOK_ONLY_PREFERENCES)[number];

/** A stored layer without the per-Book-only fields: the global one, or a Book's other settings. */
export function withoutBookOnly(layer: unknown): Record<string, unknown> {
	if (!isPlainObject(layer)) return {};
	const rest = { ...layer };
	for (const key of BOOK_ONLY_PREFERENCES) delete rest[key];
	return rest;
}

/** Just the per-Book-only fields of a Book's override. */
export function bookOnlyOf(layer: unknown): Partial<Pick<ReaderPreferences, BookOnlyPreference>> {
	if (!isPlainObject(layer)) return {};
	const kept: Partial<Pick<ReaderPreferences, BookOnlyPreference>> = {};
	for (const key of BOOK_ONLY_PREFERENCES) {
		if (typeof layer[key] === 'boolean') kept[key] = layer[key];
	}
	return kept;
}

function objectOrEmpty(value: unknown): unknown {
	return isPlainObject(value) ? value : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merges plain objects; later layers win. Arrays and other values are replaced. */
function merge(target: Record<string, unknown>, source: Record<string, unknown>) {
	for (const [key, value] of Object.entries(source)) {
		if (value === undefined) continue;
		const existing = target[key];
		target[key] =
			isPlainObject(existing) && isPlainObject(value)
				? merge({ ...existing }, value)
				: isPlainObject(value)
					? merge({}, value)
					: value;
	}
	return target;
}

/**
 * Resolves the effective preferences: defaults, then the global layer, then a per-Book override.
 * Layers come from storage, so they are treated as untrusted (`unknown`).
 */
export function resolvePreferences(...layers: unknown[]): ReaderPreferences {
	const merged: Record<string, unknown> = {};
	for (const layer of layers) if (isPlainObject(layer)) merge(merged, layer);
	return readerPreferencesSchema.parse(merged);
}

/** Merges a change into a stored patch, keeping nested groups partial. */
export function mergePreferencesPatch(
	base: ReaderPreferencesPatch | undefined,
	changes: ReaderPreferencesPatch
): ReaderPreferencesPatch {
	return merge(merge({}, base ?? {}), changes) as ReaderPreferencesPatch;
}

/** Snaps a font scale to the allowed range and step. */
export function clampFontScale(scale: number): number {
	const stepped = Math.round(scale / FONT_SCALE.step) * FONT_SCALE.step;
	return Math.min(FONT_SCALE.max, Math.max(FONT_SCALE.min, Number(stepped.toFixed(2))));
}
