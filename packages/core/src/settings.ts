export const themeIds = ['light', 'sepia', 'dark', 'high-contrast'] as const;
export type ThemeId = (typeof themeIds)[number];

export const fontIds = ['serif', 'sans', 'dyslexic'] as const;
export type FontId = (typeof fontIds)[number];

export type ViewMode = 'single' | 'spread' | 'overview' | 'scroll';
export type PageTransition = 'curl' | 'slide' | 'instant';

export type ReaderSettings = {
	theme: ThemeId;
	font: FontId;
	/** Multiplier on the base reading size (1 = 100%). */
	fontScale: number;
	lineHeight: number;
	paragraphSpacing: number;
	/** Page margin in rem. */
	margin: number;
	textAlign: 'start' | 'justify';
	/** 'auto' picks single on narrow screens and spread on wide ones. */
	viewMode: ViewMode | 'auto';
	pageTransition: PageTransition;
};

export const defaultReaderSettings: ReaderSettings = {
	theme: 'light',
	font: 'serif',
	fontScale: 1,
	lineHeight: 1.6,
	paragraphSpacing: 0.8,
	margin: 2,
	textAlign: 'start',
	viewMode: 'auto',
	pageTransition: 'curl'
};

/** Merges stored (possibly partial or outdated) settings over the defaults. */
export function resolveSettings(stored?: Partial<ReaderSettings> | null): ReaderSettings {
	return { ...defaultReaderSettings, ...stored };
}
