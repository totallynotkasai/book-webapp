# Demo narration audio

The `.m4a` files in `alice/` are **generated, not committed** (they are about 6 MB per chapter).
Make them with:

```bash
npm run fixtures:narration
```

This fetches the LibriVox MP3s if needed (`npm run fixtures:audio`, see `fixtures/audio/README.md`)
and transcodes each chapter with ffmpeg to AAC in `.m4a`, mono, 64 kbps, loudness-normalised to
−18 LUFS (docs/DESIGN.md §7.2 step 1). It needs **ffmpeg** on your `PATH` (or set `FFMPEG`).

The Sync Maps in `../sync/alice/` are committed, so the whisper.cpp step is skipped while they
exist. To redo the alignment as well, install whisper.cpp and its models and run
`npm run fixtures:narration -- --force` (`--realign` re-aligns from the committed transcripts in
`fixtures/sync/transcripts/` without whisper). The script's header in
`tools/align-spike/align.mjs` lists its options and environment variables; ADR-003 has the
measurements.

Without these files the reader still opens the book, but narration has nothing to play.
