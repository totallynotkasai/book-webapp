# ADR-001: Reader engine: foliate-js or Readium ts-toolkit

- **Status:** **Accepted** (12 October 2026, owner decision before Phase 1). The owner accepted the recommendation before scoring feel; the Android checks move to the Android Studio emulator during Phase 1 (see "Still to do"). Resolves OPEN-01 and D-015.
- **Date:** 12 October 2026
- **Task:** P0-04 Spike: reader engine. Resolves OPEN-01 (and D-015) once accepted.
- **Spike code:** was `packages/reader-core/src/spike/`, `apps/web/src/routes/spike/reader/`, `apps/web/e2e/spike-reader*.ts` and `apps/web/scripts/spike-phone.ts`; deleted in Phase 1.1 together with `@readium/*` (it is in the git history before the Phase 1.1 PR). P1-RDR-01 rebuilds the foliate-js adapter and the Word mapping from it.

## Context

DESIGN.md §9.1 puts the engine behind our `ReaderEngine` interface, so the choice is replaceable, but it shapes P1-RDR-01 to P1-RDR-08, the Layers work and the performance budgets (§12.3). P0-04 scores the candidates on ten criteria, plus how they *feel* to the owner.

## What was compared

- **foliate-js**, GitHub `johnfactotum/foliate-js` at commit `78914ae` (1 May 2026). Its npm package (1.0.1, April 2025) is a year behind the repository, so it is installed as a pinned git dependency.
- **Readium ts-toolkit**: `@readium/navigator` 2.10.2 and `@readium/shared` 2.5.1 (18 and 15 September 2026; the newest releases were under two weeks old).

**Same input for both.** The spike prepares each Book once, the way `text-pipeline` output will reach the reader through an `OpenBook` loader: resources rewritten to `blob:` URLs, and Words marked (option A spans or option B Block offsets, see ADR-002) with identical book-wide WordIds. foliate-js gets a hand-built "book" object over those files; Readium gets a Readium Web Publication Manifest and a custom `Fetcher` over the same files. Both adapters implement one small spike interface, so every measurement is the same code for both.

**How it was measured.** `/spike/reader` shows both engines side by side, or one at full width, with live metrics. `e2e/spike-reader.spec.ts` drives them through every criterion in Chromium and WebKit, and `scripts/spike-phone.ts` runs the same steps inside the Android app's WebView over adb. Fixtures: *Alice* (Gutenberg), *Alice* chapters 1–5 merged into one 10,854-Word chapter, the status-window fixture, the Rackham-illustrated *Alice* and the demo serial. Page turn is measured from input to the first animation frame showing different Words. Re-layout is measured from a text-size change to relocation. Numbers below are medians from sequential runs (one test at a time, nothing else running) on the owner's desktop PC (Intel i5-13600KF); WebKit is Playwright's Windows build, our stand-in for iOS (D-024).

## Results

| # | Criterion | foliate-js | Readium |
|---|---|---|---|
| 1 | Single, spread and scroll | ✅ All three. Spread shows two columns when two fit at 720 px each. | ✅ All three (`columnCount: 2`, `scroll: true`). |
| 2 | Text-size change keeps the first visible Word | ⚠️ Natively it keeps the Word you last *turned* to, not the current first Word (3 of 9 changes kept it), but it never drifts: going A+ then A− lands on the same page. With our adapter jumping back to the anchor Word: **9/9**, median 32–62 ms extra. | ⚠️ Keeps a fraction of the chapter, which drifts by a page or more (6 of 9 kept). With the jump back: **9/9**, median 28–92 ms extra. |
| 3 | Decorations for highlights and narration | ✅ Full iframe access, so we paint with the CSS Custom Highlight API ourselves (§9.1). Its built-in annotations are SVG overlays keyed by CFI, which we wouldn't use. | ✅ Its decorator paints with the CSS Custom Highlight API, but in 2.10 it only resolves **text-quote** locators across the frame boundary (DOM-range and CSS-selector locators fail with "Can't locate DOM range"). We can also paint ourselves, as with foliate-js. |
| 4 | Selections mappable to Word ranges | ✅ A selection from mid-Word to mid-Word snaps to whole Words, both marking options, Chromium and WebKit. | ✅ Same. |
| 5 | Injecting a `<figure>` re-paginates | ✅ Re-paginates by itself (it watches the section's size): 7 → 8–9 pages. | ✅ Re-paginates by itself: 6–7 → 8–9 pages. |
| 6 | Android WebView (Capacitor), Playwright WebKit | WebKit ✅ every test. Android: **pending** (phone locked during the session). | WebKit ✅ every test. Android: **pending**. |
| 7 | 10,000-Word Chapter within §12.3 | See the performance table. | See the performance table. |
| 8 | A later page-curl skin | Neither engine offers one. Both lay a Chapter out as CSS columns in one iframe, so a curl means rendering the next page into a second layer and animating both. That costs about the same either way. foliate-js's paginator is a small custom element (with a slide animation already) and easier to extend. | Same constraint. The frame pool keeps neighbouring *Chapters* loaded, not neighbouring pages. |
| 9 | Licence, maintenance, documentation | **MIT.** 1,132 stars, 281 forks, used in production by the Foliate desktop app. One maintainer; 15 commits in the last 12 months, last push 1 May 2026, no npm release since April 2025. README documents the book interface well; no TypeScript types. | **BSD-3-Clause**, Readium Foundation, used by Thorium Web. 156 stars. 77 commits in 12 months (68 from one developer), 83 npm releases of the navigator, all 2.x but a fast-moving API. TypeScript types; thin prose docs. |
| 10 | Manifest and content URLs (local `blob:` and §10.3 token prefixes) | Our own book object: `section.load()` returns any URL. Local: `blob:` URLs. HTTP: the token-prefixed URL itself, and relative references resolve under it with no rewriting. | RWPM manifest plus a `Fetcher`. Every chapter becomes a `blob:` document with `<base href>` set from the publication's base URL. That suits §10.3's path-prefix tokens exactly; local content needs resources rewritten to `blob:` URLs (as the spike does) or a service worker. Readium also injects its own CSP and scripts into each frame. |

### Performance (§12.3)

Each engine alone at full width, option A (a span per Word), desktop, one test at a time with nothing else running:

| | foliate-js Chromium | Readium Chromium | foliate-js WebKit | Readium WebKit |
|---|---|---|---|---|
| Page turn, *Alice* chapter (budget < 100 ms) | **11 ms** | 34 ms | **28 ms** | 58 ms |
| Page turn, 10,854-Word chapter | **5 ms** | 32 ms | **41 ms** | 86 ms |
| Re-layout after text size, *Alice* (budget < 300 ms) | **54 ms** | 185 ms | **104 ms** | 194 ms |
| Re-layout, 10,854-Word chapter | **180 ms** | 259 ms | **248 ms** | 251 ms |

With option B (Blocks + offsets, ADR-002), the long chapter's re-layout drops to **56 ms** (foliate-js) and 118 ms (Readium) in Chromium, and 186 ms and 223 ms in WebKit (both engines on screen together).

An earlier set of runs overlapped whisper transcriptions from the narration spike and came out two to three times slower across the board. The ranking was the same.

| JavaScript (gzipped) | foliate-js | Readium |
|---|---|---|
| Engine chunks | **≈ 15 KB** | ≈ 116 KB (including the scripts it injects into each frame) |

§12.3's 250 KB reader-route budget excludes the engine, but the engine still lands on the first open over 4G (budget < 2 s).

foliate-js was faster on every timing in both browsers: page turns roughly 2–6× quicker and re-layout up to 3.4× quicker. On the 10,000-Word chapter in WebKit the two re-lay out at about the same speed.

### What only one of them brings

- **Readium:** ReadiumCSS and a preferences editor (fonts, spacing, columns, themes), fixed-layout support, an audio navigator and content-protection hooks.
- **foliate-js:** CFI, search, TTS and footnote modules, and a renderer small enough to read and patch.

Neither is needed to meet DESIGN.md: our preferences are token-driven (§9.4, §11), we don't store CFIs (Invariant 2), and narration uses our own Sync Maps (§7.2).

## Still to do (after acceptance)

1. **Android numbers (criteria 6 and 7).** With the phone unlocked, the screen on and USB debugging connected, from `apps/web`: `npm run cap:android`, then `node scripts/spike-phone.ts`. Results land in `apps/web/spike-results/`. If the phone is much faster than the reference class (§12.3), repeat with CPU throttling.
2. **The owner's feel score.** On desktop (`npm run dev`, then `/spike/reader`) and on the phone (the app's `/spike/reader`, or `npm run dev:host` in the phone's browser): turn pages, change the text size, try spread and scroll, select text, then score each engine 1–5 on the page and use "Copy results for ADR-001".

## Decision

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
