# ADR-001: Reader engine: foliate-js or Readium ts-toolkit

- **Status:** Proposed. Waiting for the owner's feel score (desktop and phone) and the Android measurements (see "Still to do").
- **Date:** 12 October 2026
- **Task:** P0-04 Spike: reader engine. Resolves OPEN-01 (and D-015) once accepted.
- **Spike code:** `packages/reader-core/src/spike/` (both adapters, prepared documents, Word marking), `apps/web/src/routes/spike/reader/`, `apps/web/e2e/spike-reader*.ts`, `apps/web/scripts/spike-phone.ts`. Deleted once ADR-001 and ADR-002 are accepted (DESIGN.md §13.1).

## Context

DESIGN.md §9.1 puts the engine behind our `ReaderEngine` interface, so the choice is replaceable, but it shapes P1-RDR-01 to P1-RDR-08, the Layers work and the performance budgets (§12.3). P0-04 scores the candidates on ten criteria, plus how they *feel* to the owner.

## What was compared

- **foliate-js**, GitHub `johnfactotum/foliate-js` at commit `78914ae` (1 May 2026). Its npm package (1.0.1, April 2025) is a year behind the repository, so it is installed as a pinned git dependency.
- **Readium ts-toolkit**: `@readium/navigator` 2.10.2 and `@readium/shared` 2.5.1 (18 and 15 September 2026; the newest releases were under two weeks old).

**Same input for both.** The spike prepares each Book once, the way `text-pipeline` output will reach the reader through an `OpenBook` loader: resources rewritten to `blob:` URLs, and Words marked (option A spans or option B Block offsets, see ADR-002) with identical book-wide WordIds. foliate-js gets a hand-built "book" object over those files; Readium gets a Readium Web Publication Manifest and a custom `Fetcher` over the same files. Both adapters implement one small spike interface, so every measurement is the same code for both.

**How it was measured.** `/spike/reader` shows both engines side by side, or one at full width, with live metrics. `e2e/spike-reader.spec.ts` drives them through every criterion in Chromium and WebKit, and `scripts/spike-phone.ts` runs the same steps inside the Android app's WebView over adb. Fixtures: *Alice* (Gutenberg), *Alice* chapters 1–5 merged into one 10,854-Word chapter, the status-window fixture, the Rackham-illustrated *Alice* and the demo serial. Page turn is measured from input to the first animation frame showing different Words. Re-layout is measured from a text-size change to relocation. Numbers below are medians from sequential runs (one test at a time) on the owner's desktop PC; WebKit is Playwright's Windows build, our stand-in for iOS (D-024).

## Results

| # | Criterion | foliate-js | Readium |
|---|---|---|---|
| 1 | Single, spread and scroll | ✅ All three. Spread shows two columns when two fit at 720 px each. | ✅ All three (`columnCount: 2`, `scroll: true`). |
| 2 | Text-size change keeps the first visible Word | ⚠️ Natively it keeps the Word you last *turned* to, not the current first Word (3 of 9 changes kept it), but it never drifts: going A+ then A− lands on the same page. With our adapter jumping back to the anchor Word: **9/9**, median 30–110 ms extra. | ⚠️ Keeps a fraction of the chapter, which drifts by a page or more (2–6 of 9). With the jump back: **9/9**, median 50–140 ms extra. |
| 3 | Decorations for highlights and narration | ✅ Full iframe access, so we paint with the CSS Custom Highlight API ourselves (§9.1). Its built-in annotations are SVG overlays keyed by CFI, which we wouldn't use. | ✅ Its decorator paints with the CSS Custom Highlight API, but in 2.10 it only resolves **text-quote** locators across the frame boundary (DOM-range and CSS-selector locators fail with "Can't locate DOM range"). We can also paint ourselves, as with foliate-js. |
| 4 | Selections mappable to Word ranges | ✅ A selection from mid-Word to mid-Word snaps to whole Words, both marking options, Chromium and WebKit. | ✅ Same. |
| 5 | Injecting a `<figure>` re-paginates | ✅ Re-paginates by itself (it watches the section's size): 7 → 8–9 pages. | ✅ Re-paginates by itself: 6–7 → 8–9 pages. |
| 6 | Android WebView (Capacitor), Playwright WebKit | WebKit ✅ every test. Android: **pending** (phone locked during the session). | WebKit ✅ every test. Android: **pending**. |
| 7 | 10,000-Word Chapter within §12.3 | See the performance table. | See the performance table. |
| 8 | A later page-curl skin | Neither engine offers one. Both lay a Chapter out as CSS columns in one iframe, so a curl means rendering the next page into a second layer and animating both. That costs about the same either way. foliate-js's paginator is a small custom element (with a slide animation already) and easier to extend. | Same constraint. The frame pool keeps neighbouring *Chapters* loaded, not neighbouring pages. |
| 9 | Licence, maintenance, documentation | **MIT.** 1,132 stars, 281 forks, used in production by the Foliate desktop app. One maintainer; 15 commits in the last 12 months, last push 1 May 2026, no npm release since April 2025. README documents the book interface well; no TypeScript types. | **BSD-3-Clause**, Readium Foundation, used by Thorium Web. 156 stars. 77 commits in 12 months (68 from one developer), 83 npm releases of the navigator, all 2.x but a fast-moving API. TypeScript types; thin prose docs. |
| 10 | Manifest and content URLs (local `blob:` and §10.3 token prefixes) | Our own book object: `section.load()` returns any URL. Local: `blob:` URLs. HTTP: the token-prefixed URL itself, and relative references resolve under it with no rewriting. | RWPM manifest plus a `Fetcher`. Every chapter becomes a `blob:` document with `<base href>` set from the publication's base URL. That suits §10.3's path-prefix tokens exactly; local content needs resources rewritten to `blob:` URLs (as the spike does) or a service worker. Readium also injects its own CSP and scripts into each frame. |

### Performance (§12.3)

Option A (a span per Word), desktop, sequential runs:

| | foliate-js Chromium | Readium Chromium | foliate-js WebKit | Readium WebKit |
|---|---|---|---|---|
| Page turn, *Alice* chapter (budget < 100 ms) | **8 ms** | 39 ms | 145 ms | 192 ms |
| Page turn, 10,854-Word chapter | **14 ms** | 84 ms | 158 ms | 206 ms |
| Re-layout after text size, *Alice* (budget < 300 ms) | **93 ms** | 267 ms | 387 ms | 536 ms |
| Re-layout, 10,854-Word chapter | 549 ms | 627 ms | 676 ms | 827 ms |

With option B (Blocks + offsets, ADR-002), the long chapter's re-layout drops to **127 ms** (foliate-js) and 197 ms (Readium) in Chromium, and 401 ms and 501 ms in WebKit.

| JavaScript (gzipped) | foliate-js | Readium |
|---|---|---|
| Engine chunks | **≈ 15 KB** | ≈ 116 KB (including the scripts it injects into each frame) |

§12.3's 250 KB reader-route budget excludes the engine, but the engine still lands on the first open over 4G (budget < 2 s).

foliate-js was faster on every timing in both browsers: page turns roughly 2–5× quicker and re-layout 1.3–3× quicker.

### What only one of them brings

- **Readium:** ReadiumCSS and a preferences editor (fonts, spacing, columns, themes), fixed-layout support, an audio navigator and content-protection hooks.
- **foliate-js:** CFI, search, TTS and footnote modules, and a renderer small enough to read and patch.

Neither is needed to meet DESIGN.md: our preferences are token-driven (§9.4, §11), we don't store CFIs (Invariant 2), and narration uses our own Sync Maps (§7.2).

## Still to do before this can be Accepted

1. **Android numbers (criteria 6 and 7).** With the phone unlocked, the screen on and USB debugging connected, from `apps/web`: `npm run cap:android`, then `node scripts/spike-phone.ts`. Results land in `apps/web/spike-results/`. If the phone is much faster than the reference class (§12.3), repeat with CPU throttling.
2. **The owner's feel score.** On desktop (`npm run dev`, then `/spike/reader`) and on the phone (the app's `/spike/reader`, or `npm run dev:host` in the phone's browser): turn pages, change the text size, try spread and scroll, select text, then score each engine 1–5 on the page and use "Copy results for ADR-001".

## Recommendation (provisional)

**foliate-js**, through our `ReaderEngine` adapter, pinned by git commit. It met or tied every criterion. It was clearly faster on every timing in both browsers, which matters most on mid-range Android (§12.3, §18). It is about a seventh of the size. And because it renders whatever book object we hand it, our own `text-pipeline` output and both URL schemes fit without a service worker.

**What it costs us, and how we'd handle it:**

- *Keeping the first Word on screen is our job.* The adapter records the first visible Word before any re-layout and jumps back to it if needed (measured above). P1-RDR-01 and P1-RDR-03 own this.
- *Highlights are ours.* We paint with the CSS Custom Highlight API in its frames (§9.1).
- *Maintenance is thin and single-person.* We pin a commit and treat foliate-js as code we can patch. If we need to patch it, we vendor it into `packages/reader-core/vendor/` with its MIT licence.
- *No types.* We write a small `.d.ts` for the parts the adapter uses.

**What would change it to Readium:** a clearly better feel score; foliate-js failing in Android WebView; or a later need for ReadiumCSS-grade typography or fixed layout without writing it ourselves.

## Consequences

- P1-RDR-01's adapter maps Anchors to foliate-js ranges using the Word marking chosen in ADR-002, re-anchors after every re-layout, and emits `relocated` from its `relocate` events. The section index arrives as `detail.section.current`.
- P1-ING-01 emits sanitised XHTML plus the word index (ADR-002) and a small manifest (spine, TOC, resources) from which the adapter builds foliate-js's book object. Locally the loader serves `blob:` URLs; in Phase 2 it returns content-token URLs.
- P1-RDR-08 must keep styled blocks whole across pages (`break-inside: avoid`): the spike showed foliate-js splitting a status window across a page boundary.
- `@readium/*` is removed when the spike code is deleted.
