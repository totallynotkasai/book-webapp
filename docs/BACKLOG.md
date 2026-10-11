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

Mobile purchasing rules for iOS are tracked separately as OPEN-05 (before Phase 4).
