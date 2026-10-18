# Backlog

> Work we intend to do but have deliberately deferred, with the reason and what would bring it back.
> When an item is picked up, give it a task ID in [DESIGN.md](DESIGN.md) §13, add it to [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md), and remove it here.
> This is different from DESIGN.md §13.8 *Parked*, which lists ideas not to build without explicit approval.

---

## iOS (D-024)

**Why it's deferred:** building a Capacitor iOS app needs Xcode, which only runs on macOS, and the iOS-specific checks (background audio, text selection, VoiceOver, performance) need a real iPhone. As of 11 October 2026 the owner has neither. iOS remains a product target (DESIGN.md §1.6); only the work and testing wait.

**What brings it back:** access to a Mac (or a cloud macOS build service) **and** an iPhone. The Mac alone allows building and the simulator; the iPhone is needed for most of the checks below.

### Keep iOS cheap to add (do these now)

- Playwright runs WebKit as well as Chromium on every PR (P0-01). It is the closest stand-in for iOS Safari and WKWebView available on Windows, though not identical.
- Feature code reaches audio, files, share, haptics and deep links only through the `lib/platform` adapters (DESIGN.md §9.7), never through Android-only APIs.
- Layouts use the `--safe-*` tokens everywhere and nothing depends on hover.
- During the PoC review, testers with iPhones use the web build in Safari and note anything that breaks (P1-QA-03). That covers most of the reader, but not background audio or native file import.

### Items

Suggested order when picked up: IOS-01, IOS-02, IOS-04, IOS-05, then the rest.

| ID | Item | Deferred from | Notes |
|---|---|---|---|
| IOS-01 | Add the Capacitor iOS project (`npx cap add ios`) and the `cap:ios` script | P0-03 | Needs Xcode on macOS |
| IOS-02 | Check the chosen reader engine inside WKWebView (ADR-001 criterion 6) and update ADR-001 | P0-04 | Playwright WebKit is only a stand-in |
| IOS-03 | Check that Word marking reads naturally in VoiceOver and update ADR-002 | P0-05 | |
| IOS-04 | Background narration with lock-screen controls and Media Session on iOS; update ADR-004 | P0-07, P1-LAY-04 | Needs a real iPhone; check the rules for background audio in WebView apps |
| IOS-05 | Long-press selection with our own toolbar, and suppressing or extending the native iOS selection menu | P0-07, P1-RDR-06 | Needs a real iPhone |
| IOS-06 | Importing an EPUB from the Files app | P0-07, P1-ING-02 | |
| IOS-07 | Safe areas on notch and Dynamic Island devices; status bar styling | P0-07 | |
| IOS-08 | Whether iOS can clear WebView storage, and a Capacitor Filesystem fallback for processed Books if so | P0-07, P1-APP-04 | |
| IOS-09 | iOS app icon and splash screen | P1-MOB-01 | |
| IOS-10 | Run `docs/device-checklist.md` on a real iPhone | P1-MOB-01 | |
| IOS-11 | VoiceOver walkthrough of the reader | P1-QA-02 | |
| IOS-12 | DESIGN.md §12.3 performance budgets on an iPhone | P1-QA-01 | |
| IOS-13 | TestFlight distribution for testers | P1-QA-03 | Needs a paid Apple Developer Program membership |
| IOS-14 | Sign in with Apple, and the App Store's rules on sign-in options | P2-AUTH-01 | Phase 2; DESIGN.md §5.2 already flags the App Store sign-in rules |
| IOS-15 | The device voice on an iPhone: WKWebView's Web Speech API, its voices and Word boundaries, and whether it speaks with the screen locked; update ADR-006 | P1-LAY-08 | Needs a real iPhone. Playwright's WebKit on Windows has no Web Speech API, so CI uses a stand-in |
| IOS-16 | The sleep timer on an iPhone: iOS ignores an audio element's `volume`, so narration stops on time but doesn't fade out; and with the screen locked the WebView's timer may not run until the native player of IOS-04 counts it, as Android's does | P1-LAY-09 | Comes with IOS-04 (native narration on iOS) |
| IOS-17 | Share quote on an iPhone: WKWebView's Web Share API with the card as a file (iOS 15+), copying the picture, and the card's reading fonts on the canvas | P1-RDR-16 | Needs a real iPhone; Safari on an iPhone uses the same web code |
| IOS-18 | Define's "Look up on Wiktionary" in the iPhone app: a `target="_blank"` link from WKWebView should open Safari, as it opens Chrome from Android's WebView | P1-RDR-18 | Needs a real iPhone; Capacitor's iOS WebView may need the Browser plugin for links out |
| IOS-19 | The page curl on an iPhone: WKWebView's WebGL, its frame rate and memory with the page pictures, and a drag back from the left edge against iOS's own swipe-back gesture | P1-RDR-19 | Needs a real iPhone; Playwright's WebKit runs the curl's specs |

Mobile purchasing rules for iOS are tracked separately as OPEN-05 (before Phase 4).

---

## Reader

| ID | Item | Deferred from | Why deferred, and what brings it back |
|---|---|---|---|
| RDR-03 | **A lighter reader route:** validate the reader's few content schemas without Zod, about 32 KB of the reader route's 216 KB (gzipped) | P1-QA-01 | The route is within its 250 KB budget (docs/perf/p1-qa-01.md); Zod is how `@book/core` validates everything. Brought back when `npm run budget` gets close to the line |
| RDR-04 | **Define a phrase:** "rabbit hole", "a cappella", "well-known": Open English WordNet's phrases and hyphenated entries (about 90,000 of its 160,000) | P1-RDR-18 | Define looks up one Word (the plan's UX notes), and the tokeniser splits at spaces and hyphens, so the app's copy keeps only single Words (D-043). Brought back if readers select phrases and miss it |
| RDR-05 | **Dictionaries in other languages:** Define for a Book in French, Spanish and so on | P1-RDR-18 | Open English WordNet is English, so Define shows only in English Books (and those that don't say). Brought back with the first non-English Book a tester reads, with a dictionary chosen as D-043 chose this one |
| RDR-06 | **The whole dictionary for offline web reading:** on the web a piece of the dictionary downloads the first time a Word in it is looked up, so offline it has only the pieces read that session | P1-RDR-18 | The Android app carries all of it; the web build has no offline support at all yet (Phase 6's offline downloads). Brought back with them |
| RDR-07 | **Everything on the page curl's picture of a page:** a styled first letter (drop cap) in its own font, inline SVG drawings (not pictures) and video frames, and bullets in a list style other than the common ones (disc, circle, square, numbers, letters, Roman numerals). Without them, on a page that has one the curl's first frame differs there for a moment | P1-RDR-19 | The picture is drawn from what the page computed (Invariant 10); these come from generated content or need the element itself. Gutenberg's *Alice* has a drop-cap rule but no paragraph uses it, and no other Book read so far has any of them. Brought back with the first Book that does |

---

## Creator Studio

| ID | Item | Deferred from | Why deferred, and what brings it back |
|---|---|---|---|
| STU-02 | **Turn off the device voice for a Book:** a Book setting for authors who don't want it read aloud by a synthetic voice, as Kindle publishers can turn off text-to-speech | P1-LAY-08 | The owner chose to offer the device voice wherever a reader can't play a Book's narration, even one they don't own (D-036), treating reading aloud as an accessibility feature. Brought back if authors ask for it, or by Phase 4's paid narration |
| STU-03 | **Recaps and glossary for Chapters still to come:** write the recap of a Chapter that's only in an uploaded, unpublished version, ready for when it's out | P1-STU-05 | The Story so far tab works on the version readers have, so first appearances and recaps are always on a Revision readers can open. Phase 1.15 meets most of the need: a Chapter published with a release time is in the version readers have (locked until its day), so its recap and glossary can be written before it comes out. Brought back if serial authors want to prepare before publishing the version at all |
| STU-04 | **Punctuation in the Studio's first-appearance lines:** "…Happy Naming Day, Tamsin Reed. Your status…" rather than "…Happy Naming Day Tamsin Reed Your status…" | P1-STU-05 | The backend reads a Revision's Words without the text between them; showing it means the import worker returning each Word's text with its punctuation (as the reader's `chapterText` does). Author-facing only, so deferred |

---

## Store

| ID | Item | Deferred from | Why deferred, and what brings it back |
|---|---|---|---|
| STO-01 | **Sale alerts on the Complete edition:** a wishlisted Book's Bundle getting cheaper alerts its readers too, not only the Book alone | P1-STO-06 | Authors set only the Book's own price in the Studio; Bundle prices are seeded. Brought back when the Studio prices Bundles (Phase 4) |
| STO-02 | **Ratings on store cards:** a Book's average stars on its card in the store and search, not only on its page | P1-STO-07 | Kept off the cards so the PoC review can ask whether readers want them at all. Brought back if testers look for them |

---

## Android

| ID | Item | Deferred from | Why deferred, and what brings it back |
|---|---|---|---|
| AND-01 | **Play Console internal testing** instead of the APK: testers install from Google Play and get updates there | P1-QA-03 | The owner chose a direct APK for the PoC (D-030): Play needs a developer account, the foreground-service declaration for narration (ADR-004) and the named product's own app ID (OPEN-07). Brought back by Phase 2's first public build |
