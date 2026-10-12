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

10,854-Word chapter (*Alice* chapters 1–5 merged); desktop; sequential runs:

| | A: span per Word | B: Blocks + offsets |
|---|---|---|
| Prepared XHTML | 348.7 KB | **65.4 KB** (5.3× smaller) |
| Elements in the body | 11,237 | **383** (29× fewer) |
| Re-layout after a text-size change, foliate-js: Chromium / WebKit | 549 / 676 ms | **127 / 401 ms** |
| Re-layout, Readium: Chromium / WebKit | 627 / 827 ms | **197 / 501 ms** |
| Page turn, foliate-js Chromium (the measurement includes finding the visible Words) | 14 ms | 45 ms |

A normal *Alice* chapter (about 2,200 Words): foliate-js re-layout in Chromium was 93 ms with A and 54 ms with B.

| Cost per operation (median, Chromium / WebKit) | A | B |
|---|---|---|
| Find the first and last visible Words (binary search over Words) | 0.7 / 1 ms | 1.8 / 4 ms |
| Paint a 13-Word highlight (CSS Custom Highlight API) | 0.6 / 1 ms | 2.2 / 5 ms |

Both are far inside every budget, and neither changes the DOM to highlight, so highlighting never re-paginates (§9.1).

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

**Option B: Block indexes plus an offset word index.** With every Word in a span, a long Chapter's re-layout is 1.6–4× slower, and the gap is largest exactly where budgets are tightest. At 549–827 ms on a desktop PC for the 10,000-Word Chapter that §13.1 criterion 7 names, option A cannot meet §12.3's 300 ms re-layout budget on a mid-range phone. B costs a few milliseconds per lookup, which is invisible.

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

## Consequences

- P1-ING-01 marks Blocks with `data-b` and emits this index; it does not wrap Words.
- P1-RDR-01's Anchor ↔ Range mapping is the spike's `WordMap` (offset variant), plus the Block check and quote fallback above.
- Selection-to-Word, visible-Word search and highlights stay engine-neutral, in `reader-core`.
- The narration highlight (P1-LAY-04) paints Ranges built from the index. The narration spike (P0-06) uses option A only because it was built first; its alignment is independent of the marking.
