/**
 * Transcript words from whisper.cpp (docs/DESIGN.md §7.2 step 2). whisper.cpp's
 * `--output-json-full` lists sub-word tokens per segment, each with two kinds of timing:
 *   - `offsets`: whisper's own token timestamps (from the timestamp tokens it decodes), in ms;
 *   - `t_dtw`: the token's onset from DTW over the cross-attention weights (`--dtw <model>`),
 *     in centiseconds, or -1 where DTW didn't run.
 * Tokens join into words at a leading space ("␣Al" + "is" → "Alis"); special tokens such as
 * `[_BEG_]` and `[_TT_123]` are dropped.
 */

export interface TranscriptWord {
	text: string;
	startMs: number;
	endMs: number;
	/** Mean token probability, 0–1. */
	confidence: number;
}

export type TimingSource = 'dtw' | 'token';

/** The parts of whisper.cpp's `-ojf` output this reads. */
export interface WhisperJson {
	transcription: {
		offsets: { from: number; to: number };
		tokens?: {
			text: string;
			offsets: { from: number; to: number };
			p?: number;
			t_dtw?: number;
		}[];
	}[];
}

interface Building {
	text: string;
	tokenStart: number;
	tokenEnd: number;
	dtwStart: number;
	p: number[];
}

const SPECIAL = /^\[_[A-Z]+(_\d+)?_?\]$|^\[_TT_\d+\]$|^<\|.*\|>$/;

/** Joins whisper.cpp tokens into words, timed by DTW onsets (`dtw`) or token timestamps. */
export function wordsFromWhisper(json: WhisperJson, timing: TimingSource): TranscriptWord[] {
	const built: Building[] = [];
	let current: Building | undefined;
	for (const segment of json.transcription) {
		for (const token of segment.tokens ?? []) {
			const text = token.text;
			if (SPECIAL.test(text.trim())) continue;
			const dtw = typeof token.t_dtw === 'number' && token.t_dtw >= 0 ? token.t_dtw * 10 : -1;
			if (!current || /^\s/.test(text)) {
				current = {
					text: text.trimStart(),
					tokenStart: token.offsets.from,
					tokenEnd: token.offsets.to,
					dtwStart: dtw,
					p: []
				};
				built.push(current);
			} else {
				current.text += text;
				current.tokenEnd = Math.max(current.tokenEnd, token.offsets.to);
			}
			if (typeof token.p === 'number') current.p.push(token.p);
		}
	}

	const words = built.filter((w) => /[\p{L}\p{N}]/u.test(w.text));
	const starts = words.map((w) =>
		timing === 'dtw' && w.dtwStart >= 0 ? w.dtwStart : w.tokenStart
	);
	// Keep starts in order: whisper occasionally steps back a few ms across segments.
	for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i]!, starts[i - 1]!);
	return words.map((w, i) => {
		const start = starts[i]!;
		const next = starts[i + 1] ?? Infinity;
		const duration = Math.max(0, w.tokenEnd - w.tokenStart);
		const end = Math.max(start, Math.min(next, start + duration));
		const confidence = w.p.length ? w.p.reduce((s, p) => s + p, 0) / w.p.length : 0;
		return {
			text: w.text.trim(),
			startMs: Math.round(start),
			endMs: Math.round(end),
			confidence
		};
	});
}
