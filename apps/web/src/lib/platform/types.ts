/**
 * Device adapters (docs/DESIGN.md §9.7). Feature code imports these interfaces through
 * `$lib/platform`, never an implementation, so web, Android and (later) iOS can differ underneath.
 * The Capacitor implementations are stubs until ADR-004 (P0-07) names the plugins.
 */

/** One file of a playlist: for narration, a Chapter. */
export interface AudioItem {
	/** Absolute, or relative to the app's own origin. */
	src: string;
	/** Shown on the lock screen, e.g. the Chapter's title. */
	title: string;
}

/** What the lock screen shows for every item. */
export interface AudioTrackInfo {
	/** The narrator. */
	artist?: string;
	/** The Book. */
	album?: string;
	artworkUrl?: string;
}

/**
 * `play`/`pause`: playing started or stopped, from the app or the lock screen. `item`: another
 * item became current (the last one ended, or "next" on the lock screen). `ended`: the last item
 * finished. `error`: an item couldn't be played; `error` says why.
 */
export type AudioEvent = 'play' | 'pause' | 'item' | 'ended' | 'error';

/**
 * Narration playback as a playlist, with lock-screen and Media Session controls where the
 * platform has them (DESIGN.md §8.3, ADR-004). On Android it's native (Media3), so it keeps
 * playing, and moves on to the next Chapter, while the app is in the background.
 */
export interface AudioAdapter {
	/** Loads a playlist, ready at an item and position. Never starts playing (Invariant 11). */
	load(
		items: AudioItem[],
		info: AudioTrackInfo,
		start: { index: number; positionMs: number }
	): Promise<void>;
	play(): Promise<void>;
	pause(): void;
	/** Moves within the current item, or to a position in another one. */
	seek(positionMs: number, index?: number): void;
	/** 0.5–3; keeps the pitch. */
	setRate(rate: number): void;
	/** Stops, and removes the lock-screen controls. */
	unload(): void;
	readonly index: number;
	/** Current to within a frame, so it can drive highlighting (§8.3: within 100 ms). */
	readonly positionMs: number;
	/** The current item's duration, or 0 while unknown. */
	readonly durationMs: number;
	readonly playing: boolean;
	readonly error: string | null;
	on(event: AudioEvent, callback: () => void): () => void;
}

export interface PickFilesOptions {
	/** MIME types or extensions, e.g. `['application/epub+zip', '.epub']`. */
	accept: string[];
	multiple?: boolean;
}

export interface SaveFileOptions {
	/** The suggested file name, with its extension. */
	name: string;
	mimeType: string;
	data: string | Blob;
}

export interface FilesAdapter {
	/** Resolves with no files if the user cancels. */
	pickFiles(options: PickFilesOptions): Promise<File[]>;
	/**
	 * Hands a file to the reader: a download on the web; on Android the share sheet, where it can
	 * be saved to Files or Drive or sent to an app.
	 */
	saveFile(options: SaveFileOptions): Promise<'saved' | 'cancelled'>;
}

export interface ShareContent {
	title?: string;
	text?: string;
	url?: string;
}

export interface ShareAdapter {
	readonly supported: boolean;
	share(content: ShareContent): Promise<'shared' | 'cancelled' | 'unsupported'>;
}

export interface HapticsAdapter {
	/** A short tap of feedback. Does nothing where unsupported or under reduced motion. */
	impact(strength: 'light' | 'medium' | 'heavy'): void;
}

export interface DeepLinksAdapter {
	/** Calls back when the app is opened from a link. Returns an unsubscribe function. */
	onOpen(callback: (url: URL) => void): () => void;
}

export interface LifecycleAdapter {
	/**
	 * Calls back when the app is leaving the screen: backgrounded, switched away from or closed,
	 * the moment to save anything pending. Returns an unsubscribe function.
	 */
	onHide(callback: () => void): () => void;
}

/** The colours behind the system bars, from the page's own (P1-MOB-01). */
export interface SystemBarsColors {
	/** Behind the status bar, as a CSS hex colour. */
	top: string;
	/** Behind the navigation or gesture bar. */
	bottom: string;
}

export interface SystemBarsAdapter {
	/** Matches the system bars (and the browser's own toolbar, where it has one) to the page. */
	setColors(colors: SystemBarsColors): void;
}

export interface Platform {
	kind: 'web' | 'android' | 'ios';
	audio: AudioAdapter;
	files: FilesAdapter;
	share: ShareAdapter;
	haptics: HapticsAdapter;
	deepLinks: DeepLinksAdapter;
	systemBars: SystemBarsAdapter;
	lifecycle: LifecycleAdapter;
}
