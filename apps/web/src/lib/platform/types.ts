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
 * The sleep timer (P1-LAY-09): stop after `ms` of playing (it counts only while playing), or at
 * the end of the current item, a Chapter. The adapter keeps it, not the page: on Android the
 * WebView's timers sleep with the screen locked, so the native player stops on time itself.
 */
export type SleepTimer = { kind: 'time'; ms: number } | { kind: 'item' };

/** An armed sleep timer. */
export interface SleepState {
	kind: SleepTimer['kind'];
	/**
	 * Playing time left (`time`; 0 once the device voice is finishing its sentence), or until the
	 * item ends where that's known (`item`, a recording); otherwise null.
	 */
	leftMs: number | null;
}

/** How long a recording fades out before the sleep timer stops it. */
export const SLEEP_FADE_MS = 6000;

/**
 * `play`/`pause`: playing started or stopped, from the app or the lock screen. `item`: another
 * item became current (the last one ended, or "next" on the lock screen). `ended`: the last item
 * finished. `error`: an item couldn't be played; `error` says why. `sleep`: the sleep timer
 * stopped playing (after fading out) and is off again. `seek`: the position jumped while paused
 * (the lock screen moved it, or the app caught up after the screen was locked).
 */
export type AudioEvent = 'play' | 'pause' | 'item' | 'ended' | 'error' | 'sleep' | 'seek';

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
	/** Stops, and removes the lock-screen controls (and any sleep timer). */
	unload(): void;
	/**
	 * Arms the sleep timer, replacing any, or turns it off with null. A recording fades out over
	 * its last `SLEEP_FADE_MS`; at an item's end it stops ready at the start of the next one.
	 */
	setSleep(timer: SleepTimer | null): void;
	/** The armed sleep timer, current whenever it's read; null when off. */
	readonly sleep: SleepState | null;
	readonly index: number;
	/** Current to within a frame, so it can drive highlighting (§8.3: within 100 ms). */
	readonly positionMs: number;
	/** The current item's duration, or 0 while unknown. */
	readonly durationMs: number;
	readonly playing: boolean;
	readonly error: string | null;
	on(event: AudioEvent, callback: () => void): () => void;
}

/** A voice the device speaks with. Only on-device voices are offered (D-036). */
export interface SpeechVoice {
	/** Stable from one launch to the next: the web's `voiceURI`, Android's voice name. */
	id: string;
	/** As the reader sees it. */
	name: string;
	/** BCP 47, e.g. `en-GB`. */
	lang: string;
	/** The platform's own choice for its language. */
	default: boolean;
}

/** One sentence to say. Its `id` comes back in `current`, so the app knows where speech is. */
export interface SpeechUtterance {
	id: number;
	text: string;
}

/** Where speech has reached: an utterance, and the start of the Word in it being said. */
export interface SpeechPosition {
	id: number;
	/** UTF-16 offset into the utterance's text; 0 at its start. */
	charIndex: number;
}

export interface SpeechOptions {
	/** A voice from `voices()`; the platform's default for `lang` when absent or gone. */
	voiceId?: string;
	/** The Book's language. */
	lang: string;
	/** 0.5–3; 1 is the voice's natural pace. */
	rate: number;
}

/**
 * `progress`: `current` moved (a new utterance, or a Word in it). `play`/`pause`: speaking
 * started or stopped, from the app or (Android) the lock screen. `end`: the queue ran out.
 * `error`: `error` says why. `sleep`: the sleep timer stopped speaking and is off again.
 */
export type SpeechEvent = 'progress' | 'play' | 'pause' | 'end' | 'error' | 'sleep';

/**
 * The device's own text-to-speech (P1-LAY-08, ADR-006): the Web Speech API on the web; on
 * Android our `Speech` plugin on `TextToSpeech`, in a foreground service with a media session,
 * so it carries on with the screen locked. Utterances are queued natively, so speech goes on
 * through a Chapter (and the next one, once `enqueue`d) while the page sleeps.
 */
export interface SpeechAdapter {
	/** False where the device can't speak: no Web Speech (WebKit on Windows), no voice, no engine. */
	available(): Promise<boolean>;
	/** On-device voices only (D-036): none that sends the text to a server. */
	voices(): Promise<SpeechVoice[]>;
	/**
	 * Replaces the queue and starts speaking, from `start` or its first utterance. Only ever called
	 * when the reader presses play (Invariant 11).
	 */
	speak(
		utterances: SpeechUtterance[],
		options: SpeechOptions,
		info: AudioTrackInfo & { title: string },
		start?: SpeechPosition
	): Promise<void>;
	/** Adds to the end of the queue (the next Chapter), so speech carries on by itself. */
	enqueue(utterances: SpeechUtterance[], title: string): void;
	/** Moves within the queue: another sentence, or a Word in one. Keeps playing or paused. */
	seek(position: SpeechPosition): void;
	/** Stops speaking but keeps the place; `resume` goes on from the Word it had reached. */
	pause(): void;
	resume(): Promise<void>;
	/** Empties the queue and removes the lock-screen controls. */
	stop(): void;
	/** Applies at once, from the Word being said. */
	setRate(rate: number): void;
	setVoice(voiceId: string): void;
	/**
	 * Arms the sleep timer, replacing any, or turns it off with null. A synthetic voice can't fade
	 * mid-sentence, so when the time is up it finishes its sentence and stops before the next.
	 * `item` stops before the next Chapter: each `speak` or `enqueue` call is one Chapter.
	 */
	setSleep(timer: SleepTimer | null): void;
	/** The armed sleep timer, current whenever it's read; null when off. */
	readonly sleep: SleepState | null;
	readonly playing: boolean;
	readonly current: SpeechPosition | null;
	readonly error: string | null;
	on(event: SpeechEvent, callback: () => void): () => void;
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
	/** A picture sent with the text, such as a quote card (P1-RDR-16). */
	file?: File;
}

/**
 * The device's share sheet: Android's through the Share plugin; on the web the Web Share API,
 * which phones' browsers have (with files) and most desktop ones don't.
 */
export interface ShareAdapter {
	readonly supported: boolean;
	/** Whether `share` can send this here; a picture needs files in the Web Share API. */
	canShare(content: ShareContent): boolean;
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
	speech: SpeechAdapter;
	files: FilesAdapter;
	share: ShareAdapter;
	haptics: HapticsAdapter;
	deepLinks: DeepLinksAdapter;
	systemBars: SystemBarsAdapter;
	lifecycle: LifecycleAdapter;
}
