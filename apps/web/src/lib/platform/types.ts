/**
 * Device adapters (docs/DESIGN.md §9.7). Feature code imports these interfaces through
 * `$lib/platform`, never an implementation, so web, Android and (later) iOS can differ underneath.
 * The Capacitor implementations are stubs until ADR-004 (P0-07) names the plugins.
 */

export interface AudioTrackInfo {
	title: string;
	artist?: string;
	album?: string;
	artworkUrl?: string;
}

export type AudioEvent = 'play' | 'pause' | 'timeupdate' | 'ended' | 'error';

/** Narration playback, including lock-screen controls where the platform has them. */
export interface AudioAdapter {
	/** Never starts playing by itself (Invariant 11). */
	load(src: string, info: AudioTrackInfo): Promise<void>;
	play(): Promise<void>;
	pause(): void;
	seek(positionMs: number): void;
	setRate(rate: number): void;
	readonly positionMs: number;
	readonly playing: boolean;
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

export interface Platform {
	kind: 'web' | 'android' | 'ios';
	audio: AudioAdapter;
	files: FilesAdapter;
	share: ShareAdapter;
	haptics: HapticsAdapter;
	deepLinks: DeepLinksAdapter;
}
