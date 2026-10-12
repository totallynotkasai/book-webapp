# Demo narration audio

The `.m4a` files in `alice/` are **generated, not committed** (about 6 MB per chapter). Make them
with:

```bash
npm run narration
```

That's `tools/align` (`tools/src/align.ts`, P1-LAY-03). It fetches the LibriVox MP3s if needed
(`npm run fixtures:audio`, see `fixtures/audio/README.md`), transcodes chapters 1–3 with ffmpeg to
AAC in `.m4a` (mono, 64 kbps, loudness-normalised to −18 LUFS, DESIGN.md §7.2 step 1), and aligns
them to the catalogue _Alice_. It needs **ffmpeg** on your `PATH` (or set `FFMPEG`).

The Sync Maps and `track.json` in `../sync/alice/` are committed, and so are the whisper
transcripts in `fixtures/sync/transcripts/`, so whisper.cpp only runs for a chapter without one,
or with `--force`. The tool's header lists its options and environment variables; ADR-003 has the
measurements.

Without these files the reader still opens the book and shows the play button, but narration
can't play.
