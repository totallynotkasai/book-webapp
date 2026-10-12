# ADR-003: Narration alignment: whisper.cpp model, flags and hosting

- **Status:** **Accepted** (12 October 2026, owner decision before Phase 1). Records D-017.
- **Date:** 12 October 2026
- **Task:** P0-06 Spike: narration alignment.
- **Code:** `packages/alignment` (kept: it becomes the §7.2 `alignment` package), the Sync Map type and schema in `packages/core/src/sync-map.ts` (kept), `tools/align-spike/` (grows into `tools/align` in P1-LAY-03), and the spike page `/spike/narration` (deleted in Phase 1.1; P1-LAY-04 builds the real narration player).

## Context

DESIGN.md §7.2 aligns one audio file per Chapter to the Chapter's Words: transcode with ffmpeg, transcribe with whisper.cpp with word timestamps, normalise both sides, align with Needleman–Wunsch, interpolate the gaps, score coverage, and write a Sync Map. §8.3 plays it back (time → Word by binary search, Word → time by a `Map<WordId, index>`), and §12.3 sets the budget: **highlight lag behind audio < 100 ms**. P0-06 has to show coverage ≥ 0.95 on clean narration of the matching text, report CPU time per hour of audio, recommend a model size, and say what this means for hosting in Phase 3 (OPEN-06).

## What was run

- **Audio:** LibriVox _Alice's Adventures in Wonderland_, solo reading by Kara Shallenberg, chapters 1 (13:16) and 2 (12:55), MP3 64 kbps 22 kHz mono (`fixtures/audio/README.md`).
- **Text:** Project Gutenberg #11 (`apps/web/static/books/alice.epub`). Its Words and WordIds are the ones the reader spike assigns (`openPublication(…, { marking: 'spans' })`), dumped from Chromium by `tools/align-spike/word-index.mjs` into `fixtures/sync/alice-word-index.json`: chapter 1 is 2,168 Words (WordIds 230–2397), chapter 2 is 2,125 (2398–4522).
- **whisper.cpp 1.9.4**, the CPU build with OpenBLAS (`whisper-blas-bin-x64`, release b5130), models `ggml-base.en` and `ggml-small.en`. No GPU build was available, and none was tried.
- **Machine:** Intel Core i5-13600KF (6 performance + 8 efficiency cores, 20 threads), Windows 11, no GPU.
- **Pipeline:** `npm run fixtures:narration` (`tools/align-spike/align.mjs`). Per chapter: ffmpeg makes a 16 kHz mono WAV for whisper and a playback `.m4a` (AAC, mono, 64 kbps, 44.1 kHz, two-pass `loudnorm` to −18 LUFS integrated, −1.5 dBTP, metadata stripped, `+faststart`); whisper runs once per model; `@book/alignment` aligns and writes the Sync Map. Wall and CPU time come from the whisper process handle (.NET `TotalProcessorTime`, all threads). Everything measured is in `fixtures/sync/alice-report.json`; the compact transcripts are in `fixtures/sync/transcripts/`, so alignment can be redone without whisper (`-- --realign`).

### whisper flags

```
whisper-cli -m ggml-<model>.bin -f chNN.16k.wav -of <out> -l en -t 8 -ojf -np -nfa --dtw <model>
```

- `-ojf` (`--output-json-full`) lists every token with its text, probability, whisper's own token timestamps (`offsets`) and the DTW onset (`t_dtw`). Tokens are joined into words at leading spaces (`" Al" + "is"` → `Alis`), so `--max-len 1` and `--split-on-word` are not needed: they only re-segment the same token timestamps for display, and we read tokens directly.
- `--dtw <model>` computes token onsets by dynamic time warping over the model's alignment heads (the method openai-whisper uses for word timestamps). **In 1.9.4 it is silently disabled while flash attention is on** (the default), so `-nfa` is required; with flash attention on, every `t_dtw` is −1. Turning flash attention off costs about 15% (small.en, 8 threads: 17.5 s → 20.8 s wall for 120 s of audio).
- Defaults otherwise: beam search 5, temperature fallback, no prompt, no VAD. Greedy decoding (`-bs 1 -bo 1`) was 15–20% cheaper on a 2-minute sample and is worth testing on coverage before Phase 3.
- `-t 8`: wall time stops improving beyond 8 threads on this CPU (below), and CPU time keeps rising.

## Measurements

### Coverage (matched Words / all Words)

| Chapter | Words | base.en | small.en |
|---|---|---|---|
| 1. Down the Rabbit-Hole | 2,168 | **0.9958** (9 unmatched) | **0.9977** (5) |
| 2. The Pool of Tears | 2,125 | **0.9925** (16) | **0.9967** (7) |

Both models clear the 0.95 acceptance bar comfortably on both chapters, with the same text edition differences in play. `packages/alignment/src/fixtures.test.ts` re-checks this on every `npm test` from the committed transcripts.

**Where the misses come from** (all listed by re-running the aligner): interjections the reader runs together or whisper drops ("Oh dear, oh dear", "Ah", "Well"); the French line "Où est ma chatte?" (base.en only; small.en gets it); "Esq." read as "Esquire"; contractions read out in full or the other way ("I'm" / "I am", "Dinah'll"); the odd short word skipped ("for", "of"); and, for base.en only, the chapter-1 heading "Down the Rabbit-Hole", which it didn't transcribe. The LibriVox preamble ("Chapter one of Alice's Adventures in Wonderland. This is a LibriVox recording…") and closing turned out not to be transcribed at all by either model: whisper skipped them. Where they do appear, the aligner treats transcript words before the first and after the last match as free.

**Which normalisation rules mattered** (coverage with the rule switched off, chapter 1 / chapter 2, base.en): fuzzy matching by edit distance 0.9783 / 0.9901 (mostly names: base.en hears "Alice" as "Alis" 38 times in chapter 1); the merge move for compounds split differently on the two sides ("to-day" as two Words vs "today", "rabbit hole" vs "rabbit-hole") 0.9926 / 0.9892; both off 0.9737 / 0.9854. Apostrophe folding is essential in practice, as the Gutenberg text uses curly apostrophes (’) and whisper straight ones. Number expansion and Roman numerals after "chapter" each fix one or two Words per chapter here (the headings), but are cheap and matter more for modern fiction.

### Speed and CPU time (8 threads)

| Model | Chapter | Audio | Wall | CPU | Wall / audio | CPU-hours per audio hour |
|---|---|---|---|---|---|---|
| base.en | 1 | 796 s | 49.8 s | 472 s | 0.063 | 0.59 |
| base.en | 2 | 775 s | 47.9 s | 465 s | 0.062 | 0.60 |
| small.en | 1 | 796 s | 132.9 s | 1,313 s | 0.167 | 1.65 |
| small.en | 2 | 775 s | 128.8 s | 1,291 s | 0.166 | 1.67 |

Per hour of narration, on 8 threads: **base.en about 3.8 minutes wall and 0.6 CPU-hours; small.en about 10 minutes wall and 1.65 CPU-hours.** The alignment itself takes about 0.4 s per chapter.

**Threads** (a 120 s sample from chapter 1, same flags; CPU-hours per audio hour in brackets):

| Threads | base.en wall | base.en CPU | small.en wall | small.en CPU |
|---|---|---|---|---|
| 2 | 16.8 s | 36 s (0.30) | 49.4 s | 111 s (0.93) |
| 4 | 9.8 s | 48 s (0.40) | 31.7 s | 153 s (1.27) |
| 8 | 7.8 s | 74 s (0.61) | 20.5 s | 204 s (1.70) |
| 12 | | | 20.0 s | 269 s (2.24) |
| 14 | 7.7 s | 109 s (0.91) | 20.7 s | 305 s (2.54) |
| 20 | | | 21.5 s | 356 s (2.96) |

Wall time stops improving at about 8 threads (the 6 performance cores), while CPU time keeps rising. A batch worker should therefore run several jobs with 2–4 threads each rather than one job on every core: **base.en costs about 0.3–0.4 CPU-hours per hour of narration that way, small.en about 0.9–1.3.** Single-threading OpenBLAS (`OPENBLAS_NUM_THREADS=1`) made no difference.

### Timing accuracy

There is no ground truth for this recording, so the aligner's Word times are checked against the audio itself: `findPauses` (in `@book/alignment`) finds every silence of 300 ms or more from the signal energy (191 in chapter 1, 152 in chapter 2), and `timingAccuracy` measures how far the nearest matched Word's start is from each speech onset after a pause.

| Timing source | Start error, median (ch. 1 / ch. 2) | Median signed (bias) | Within 100 ms |
|---|---|---|---|
| base.en, token timestamps | 130 / 120 ms | +80 / +60 ms | 41% / 42% |
| base.en, DTW | 110 / 110 ms | **+110 / +90 ms** | 45% / 45% |
| base.en, DTW minus its bias | **40 / 40 ms** | 0 / +20 ms | **82% / 66%** |
| small.en, token timestamps | 100 / 110 ms | +30 / +20 ms | 51% / 49% |
| small.en, DTW | 160 / 150 ms | +150 / +140 ms | 16% / 26% |
| small.en, DTW minus its bias | 40 / 60 ms | +20 / +10 ms | 71% / 61% |

DTW onsets are precise but consistently **late, by about 100 ms (base.en) or 145 ms (small.en)**: a highlight drawn from them would trail the voice by more than the whole §12.3 budget. Token timestamps are less biased but noisier. So the pipeline measures the bias per Chapter against that Chapter's pauses (`startBias`) and moves every Word earlier by it (`shiftStarts`, capped at 300 ms). After that, base.en's starts land a median 40 ms from the audible onsets. A fixed per-model offset (100 ms / 145 ms) gives almost the same result, so the per-Chapter measurement is a safeguard rather than a necessity. Word _ends_ stay rough (median 230–250 ms off): DTW gives onsets only, so an end is the token-timestamp duration capped at the next onset. Ends don't affect highlighting, which moves on each start.

### Playback and highlight lag (`/spike/narration`)

`spike-narration.spec.ts` taps a Word (the audio seeks to its `startMs`), presses Play, and lets the narration run 8 s at 1× and 3 s at 2×, across a page turn. Lag is measured per Word: when the highlight moves to a new Word, the audio's `currentTime` at that animation frame minus the Word's `startMs`. That covers the time → Word lookup, the engine's highlight call and the frame wait. It does not cover audio output latency, which `currentTime` doesn't report.

| Engine and browser (headless, Windows) | 1×: p50 / p95 / max | 2×: p50 / p95 / max |
|---|---|---|
| foliate-js, Chromium | 9 / 19 / 19 ms | 11 / 31 / 41 ms |
| foliate-js, WebKit | 6 / 21 / 73 ms | 12 / 104 / — ms |
| Readium, Chromium | 7 / 19 / 19 ms | 12 / 32 / 87 ms |
| Readium, WebKit | 8 / 12 / 13 ms | 9 / 30 / 43 ms |

Lag is inside the 100 ms budget everywhere except WebKit with foliate-js at 2×, where one sample coincided with a page turn. The highlight call itself takes under 0.5 ms. With the DTW bias removed, the end-to-end offset is roughly 40 ms of alignment error plus about 10 ms of playback lag. Playwright's WebKit on Windows **did** decode the AAC `.m4a`, so the WebKit run wasn't skipped. The spec still skips with a reason when `canPlayType` says no. Background playback and lock-screen controls are for the lead engineer to test on the Android phone (P0-07).

## Failure modes seen

1. **DTW silently off with flash attention.** Without `-nfa`, `t_dtw` is −1 everywhere and the timings quietly fall back to token timestamps. The pipeline should check that `t_dtw` is present and fail if it isn't.
2. **Late DTW onsets** (above). Corrected by the bias step.
3. **Skipped speech.** Both models skipped the LibriVox preamble, base.en skipped one heading, and either model drops short interjections. These become interpolated Words. A long skip would make a run of interpolated Words that are evenly spread and visibly wrong. Coverage catches large skips; the §7.2 review screen (needs_review below 0.90) is the right backstop. Not seen here: whisper's repetition loops. The aligner's affine gaps would absorb them as one long unmatched run.
4. **Runtime WordIds differ by browser.** The spike assigns WordIds in the browser with `Intl.Segmenter`. WebKit splits the Gutenberg front matter differently from Chromium, so from chapter 1 onwards **every WordId is 4 lower in WebKit**: the same Words, different IDs. A Sync Map built against Chromium's IDs highlights the wrong Words in WebKit. This confirms the design: WordIds must be assigned once at ingest by `text-pipeline` and shipped with the content (§7.1), never recomputed on the device. The spec records this as an expected failure in WebKit.
5. **Seeking needs HTTP byte ranges.** Chromium can't seek in audio served without `Accept-Ranges` (the position snaps back to 0). The repo's static test server (`apps/web/scripts/serve.mjs`) now serves ranges. Phase 3 storage and CDN do this already, but the Capacitor/WebView path should be checked in P0-07.
6. **foliate-js visible range** (a P0-04 spike bug found here): the adapter counted the next page, which sits beside the centred column hidden by a clipping container, as visible. The last visible Word came out about 340 Words too late, and auto page-turn fired a page late. Fixed in `packages/reader-core/src/spike/foliate.ts` by clipping to the frame's overflow-clipping ancestors.

## Decision

- **Model: `base.en`, with DTW timestamps and per-Chapter bias removal.** Its coverage is within 0.2–0.4 points of small.en, well above both the 0.95 acceptance bar and the 0.90 review threshold. Its timing after bias removal is as good or better (median 40 ms). It costs about a third as much (0.3–0.6 vs 0.9–1.7 CPU-hours per audio hour). Keep `small.en` as a retry for Chapters that come out under the review threshold, and for accents, noisy recordings or vocabulary-heavy fiction (LitRPG stat names), where the bigger model should earn its cost. The launch title's sample chapter (Phase 2) is the next test. Multilingual models (`base`/`small` without `.en`) wait for non-English Books.
- **Alignment:** keep the §7.2 design as built: banded affine Needleman–Wunsch on normalised tokens, fuzzy matches by edit distance (similarity ≥ 0.6, words of 4+ letters), merge moves for compounds, free transcript ends, interpolation with the `interpolated` flag. The band (±200 tokens, doubling if the path touches its edge) keeps a Chapter at about 0.8 M cells and 0.4 s. Rules to add when real books show the need: abbreviations read in full ("Esq."/"Esquire", "Mr"/"mister"), contractions expanded on one side only ("I'm"/"I am"), and years read as pairs ("1865"/"eighteen sixty-five").
- **Sync Map format:** as in §7.2, unchanged; the type and Zod schema are in `@book/core` (`syncMapSchema`, `parseSyncMap`, `SYNC_MAP_INTERPOLATED`). A Word aligned against a different transcript word (a substitution) is flagged interpolated too: `flags & 1` means "not confirmed by the transcript".

## Hosting implications for Phase 3 (OPEN-06)

- **CPU is enough; a GPU isn't needed.** base.en runs about 16× faster than real time on 8 threads of a desktop CPU. A typical 10-hour audiobook needs about **3–6 CPU-hours** with base.en (or 9–17 with small.en). On one 8-core worker that is roughly 40 minutes of wall time for the whole book, or minutes per Chapter. That is fine for an author uploading narration, who gets a "processing" state anyway. A GPU would cut wall time and make `small`/`medium` cheap, but a GPU box is idle most of the time at our volume. Revisit only if authors need near-instant results for whole books, or a larger model proves necessary. No GPU numbers were measured, since no GPU build was available.
- **Cost shape: once per Revision, never per reader (§7.2).** Alignment cost scales with hours of narration uploaded and Chapters changed, not with readership. Only changed Chapters are redone when a Revision is published. Readers only download a ~50 KB Sync Map and the `.m4a` per Chapter. At commodity cloud prices for a vCPU-hour, base.en's 0.3–0.6 CPU-hours per narration hour is cents per hour of audio, small next to storage and bandwidth for the audio itself.
- **Worker shape:** the `align-narration` job (pg-boss, Phase 3) needs ffmpeg, whisper.cpp built for the host CPU (AVX2), and the model files (base.en 148 MB, small.en 488 MB) on local disk. Size it for memory and concurrent jobs at 2–4 threads each, not for one fast job. Store the compact transcript next to the Sync Map (`tracks/{trackId}/sync/{revisionId}/`), so a new Revision of the text can be re-aligned against the same audio in under a second without re-running whisper. That is how "only changed Chapters are redone" stays cheap even when only the text changes.
- **Measure the DTW bias per Chapter** in the job (as the spike does). If a later whisper.cpp changes its DTW behaviour, the pipeline adapts instead of shipping late highlights.

## Prior art

**Storyteller** (an open-source, self-hosted platform for syncing ebooks with audiobooks; DESIGN.md §7.2) does the same job end to end. It transcribes the audiobook with whisper, matches the transcript to the book text, and writes EPUB 3 Media Overlays, playing them in its own Readium-based reader. Its matching works at the sentence level, which suits Media Overlays. We need Word-level times keyed by WordIds and Anchors, and a Sync Map per Chapter rather than a rewritten EPUB. The spike was designed and written from DESIGN.md alone; **no Storyteller code was read into or copied into this repo**, and its licence would need checking before any reuse.

## Dependencies

None added. `tools/align-spike/align.mjs` runs on Node's built-in TypeScript type stripping (`--experimental-transform-types`, because `@book/core` uses parameter properties) with a 20-line resolve hook (`tools/align-spike/ts-resolve.mjs`) for the packages' extensionless imports. `tools/align-spike/word-index.mjs` uses the Playwright already in the repo. ffmpeg and whisper.cpp are external tools, found through `FFMPEG`, `WHISPER_CLI` and `WHISPER_MODELS` (see the script header and `apps/web/static/demo/audio/README.md`).

## Consequences

- P1-LAY-03 turns `tools/align-spike/` into `tools/align` for chapters 1–3, on the word index from `text-pipeline` (P1-ING-01) instead of the spike's runtime WordIds. It should also check that `t_dtw` is present (failure mode 1).
- P1-LAY-04 builds the player on `timeToWordIndex`, `wordIndexMap` and `parseSyncMap`, through the `lib/platform` audio adapter as the spike does. The adapter's `positionMs` (`currentTime`) is precise enough at animation-frame rate.
- The demo `.m4a` files are generated (`npm run fixtures:narration`), never committed; the Sync Maps (about 50 KB per Chapter) are committed under `apps/web/static/demo/sync/alice/`.
- `SIMULATION:` placeholders listed for the PR: `trackId` `track-alice-librivox-shallenberg`, `revisionId` `spike-gutenberg-11`, `chapterId` `alice-chNN`, and `audioKey` `demo/audio/alice/chNN.m4a` (Phase 3: `tracks/{trackId}/audio/{chapterId}.m4a`, §6.7). None of them decides an OPEN item.
