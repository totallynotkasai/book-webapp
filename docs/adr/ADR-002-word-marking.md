# ADR-002: Word marking: spans, or Block indexes with offsets

- **Status:** Proposed. Waiting for the TalkBack check on the owner's phone (see "Still to do").
- **Date:** 12 October 2026
- **Task:** P0-05 Spike: Word marking. Resolves OPEN-13 (and D-016) once accepted.
- **Spike code:** `packages/reader-core/src/spike/publication.ts` (`markWords`, `indexWords`) and `engine.ts` (`WordMap`), with the specs in `apps/web/e2e/spike-reader.spec.ts`.

## Context

Everything attaches to Words (Invariant 2), so the reader must map between Words and the DOM in both directions: Anchor → Range (highlights, narration, Illustrations, jumps) and selection or visible area → WordIds. DESIGN.md §13.1 offers two ways:

- **A. Word spans.** `text-pipeline` wraps every Word in `<span data-w="{wordId}">`. The mapping is trivial, at the cost of one element per Word.
- **B. Block index plus offsets.** Only Blocks carry `data-b`. A word index stores each Word's Block and character offsets, and `reader-core` builds DOM Ranges at runtime. The DOM is untouched, but the mapping depends on the text being identical at ingest and at render.

## How the spike compared them

Both options are produced from the same segmentation (`Intl.Segmenter`, word-like segments, never across element boundaries, §7.1), so **WordIds are identical**; the spike checks that the same visible Words come out either way. A `WordMap` gives the engines one interface (Range for a Word, the Block holding it, its text), so every measurement runs the same code with either option, in both engines (ADR-001), in Chromium and WebKit.

## Results

10,854-Word chapter (*Alice* chapters 1–5 merged); desktop (Intel i5-13600KF); both engines on screen; one test at a time with nothing else running:

| | A: span per Word | B: Blocks + offsets |
|---|---|---|
| Prepared XHTML | 348.7 KB | **65.4 KB** (5.3× smaller) |
| Elements in the body | 11,237 | **383** (29× fewer) |
| Re-layout after a text-size change, foliate-js: Chromium / WebKit | 186 / 303 ms | **56 / 186 ms** |
| Re-layout, Readium: Chromium / WebKit | 242 / 348 ms | **118 / 223 ms** |
| Page turn, foliate-js: Chromium / WebKit | 33 / 66 ms | **15 / 34 ms** |

On a normal *Alice* chapter (about 2,200 Words) the gap is small in Chromium: foliate-js re-lays out in 60 ms with A and 58 ms with B. In WebKit it is 186 ms against 119 ms.

| Cost per operation (median, Chromium / WebKit) | A | B |
|---|---|---|
| Find the first and last visible Words, normal chapter | 0.4 / ≤ 1 ms | 0.8 / 1 ms |
| The same, 10,854-Word chapter | 1.3 / 2 ms | 5 / 8 ms |
| Paint a 13-Word highlight (CSS Custom Highlight API) | 0.5 / 1 ms | 0.8 / 2 ms |

WebKit reports times only to the millisecond. B's lookups are slower but stay far inside every budget, and neither option changes the DOM to highlight, so highlighting never re-paginates (§9.1). An earlier set of runs overlapped the narration spike's whisper jobs and was two to three times slower overall; the comparison came out the same.

| Behaviour | A | B |
|---|---|---|
| Selection snaps to whole Words (Invariant 5) | ✅ | ✅ |
| Figure injection after the Block holding a Word | ✅ | ✅ |
| Jump to a Word (adapter re-anchoring) | ✅ | ✅ (a Range for foliate-js; a text quote under the Block for Readium) |
| Accessibility tree of a paragraph (Playwright ARIA snapshot, Readium frame) | One paragraph, one text run | Identical to A |

**Screen readers.** On desktop, the accessibility trees are identical: the spans add no roles, and text inside a paragraph stays one run. TalkBack, the case DESIGN.md §11.7 names, still has to be checked on the phone (below). VoiceOver is backlog item IOS-03.

## Still to do before this can be Accepted

**TalkBack on the owner's phone**, with the phone unlocked: open the app's `/spike/reader`, choose "A: a span per Word", turn TalkBack on and swipe through a paragraph; then repeat with "B: Blocks + offsets". The question: does A make TalkBack read word by word, or stop at each span, where B reads naturally? If both read naturally, the decision below stands on performance alone.

## Recommendation

**Option B: Block indexes plus an offset word index.** With every Word in a span, the 10,000-Word Chapter that §13.1 criterion 7 names re-lays out 1.6–3.3× slower. On a fast desktop it already takes 186–348 ms against §12.3's 300 ms budget, and a mid-range phone is several times slower than that. B gives the headroom: 56–223 ms on the same machine, with 5× less markup and 29× fewer elements, for a few milliseconds per Word lookup. The Android numbers (ADR-001, "Still to do") will show how much headroom is left on a phone.

**B's risk, and how we contain it.** B depends on the text the reader sees being byte-identical to the text that was indexed. Mitigations:

1. `text-pipeline` writes the sanitised XHTML and the word index from the **same** parsed document in one pass, so they can't disagree at ingest.
2. The reader never rewrites Book text. Our adapter only adds attributes, figures and highlights, and the engines leave text nodes alone.
3. The word index stores a check per Block: its own text length and a short hash (the first 8 hex digits of SHA-256). On load, `reader-core` compares them and falls back for a mismatched Block: it locates its Words with the Anchor's text quote and logs a warning.
4. Golden-file tests (§12.1) pin the XHTML and the index together for every fixture.

## Word index format (proposed)

One JSON file per Chapter, next to its XHTML (`index/{chapterId}.words.json`, §6.7):

```json
{
  "version": 1,
  "revisionId": "…",
  "chapterId": "…",
  "firstOrdinal": 0,
  "blocks": [
    { "b": 0, "len": 412, "sha": "3f9a0c1e" }
  ],
  "words": [
    [1201, 0, 0, 5],
    [1202, 0, 6, 9]
  ]
}
```

- `words` holds `[wordId, block, start, end]` in reading order. Offsets are UTF-16 code units into the Block's **own** text (text nested in a child Block belongs to that child), matching the DOM `Text` offsets the Ranges use. Ordinal = `firstOrdinal` + array index, so Ordinals aren't stored twice.
- `blocks` holds the integrity check for each `data-b`. `data-b` is unique within the Chapter, in reading order.
- Size, modelled for a 10,854-Word chapter: about 195 KB as plain JSON and 68 KB gzipped. That is still smaller than option A's markup *overhead* (348.7 KB of spans vs 65.4 KB of plain XHTML). If size matters later, delta-encoding `wordId` and `start` is a versioned change.
- The narration Sync Map (§7.2) and every Anchor keep using WordIds, so nothing else in DESIGN.md changes.

## A finding that affects both options: WordIds depend on the browser

The spike assigns WordIds in the browser with `Intl.Segmenter`, as DESIGN.md §7.1 says. **WebKit and Chromium segment the same EPUB differently** (the narration spike found every WordId from chapter 1 of *Alice* is 4 lower in WebKit, and this spike's runs show the same first page as Words 1–126 in Chromium but 1–122 in WebKit). The marking option doesn't matter; the tokeniser does. Because `text-pipeline` will run in the browser for imports and for `backend-local`'s catalogue, and in Node from Phase 2, this is raised as **OPEN-14** (deterministic tokenisation), to settle in P1-ING-01 before any WordId is stored.

## Consequences

- P1-ING-01 marks Blocks with `data-b` and emits this index; it does not wrap Words. It also settles OPEN-14 first.
- P1-RDR-01's Anchor ↔ Range mapping is the spike's `WordMap` (offset variant), plus the Block check and quote fallback above.
- Selection-to-Word, visible-Word search and highlights stay engine-neutral, in `reader-core`.
- The narration highlight (P1-LAY-04) paints Ranges built from the index. The narration spike (P0-06) uses option A only because it was built first; its alignment is independent of the marking.
