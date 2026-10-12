# ADR-004: Mobile platform: audio, selection, files, safe areas and storage on Android

- **Status:** Proposed, **incomplete**. The device checks below still have to be run on the owner's phone. The phone stayed locked for the whole session, and Android freezes a locked app, so its WebView could not be driven over adb.
- **Date:** 12 October 2026
- **Task:** P0-07 Spike: mobile platform capabilities. Records D-018 once accepted. The iOS equivalents are backlog items IOS-04 to IOS-08 (D-024).
- **Spike code:** `apps/web/src/routes/spike/mobile/` (linked from the dev panel), `apps/web/scripts/probe-phone.ts`, `apps/web/e2e/spike-mobile.spec.ts`.

## Context

DESIGN.md §9.7 keeps audio, files, share, haptics and deep links behind `lib/platform` adapters. P0-03 shipped web implementations with Capacitor stubs. P0-07 must decide, on Android, what those adapters need natively:

1. background narration with lock-screen controls (§8.3, P1-LAY-04);
2. long-press selection inside the reader's frame, with our own toolbar (§9.3, P1-RDR-06);
3. importing a file from the device (P1-ING-02);
4. safe-area handling;
5. whether the OS can clear WebView storage, and how processed Books are kept if so (P1-APP-04).

## What is already known

- **Device:** the owner's Android phone (model 2509FPN0BC, 1200 × 2608, two displays), Capacitor 8.5.2, app ID `io.github.totallynotkasai.bookpoc`. The debug build installs and runs (P0-03), the Library loads from `backend-local` in the WebView, and the dev panel works there.
- **Background audio.** Android may suspend the WebView once the app leaves the foreground, and everything JavaScript-driven stops with it, including Media Session handlers relayed into the WebView. Lock-screen controls that keep working need native playback in a `mediaPlayback` foreground service with a native MediaSession. Two Capacitor 8 options do that: Capawesome's **Audio Player** (8.4.0, August 2026, which has a built-in media session) or Capgo's native audio plus media-session pair. Sources: [Capawesome: background audio in Capacitor](https://capawesome.io/blog/how-to-play-audio-in-the-background-in-capacitor/), [Audio Player 8.4.0](https://capawesome.io/blog/capacitor-audio-player-8-4-0-release/), [Capgo guide](https://capgo.app/blog/how-to-play-audio-in-the-background-in-capacitor/).
- **Safe areas.** Android WebView before version 140 reports wrong `env(safe-area-inset-*)` values. Capacitor 8's **SystemBars** plugin injects correct `--safe-area-inset-*` CSS variables, and with `insetsHandling: "native"` plus `viewport-fit=cover` (already in `app.html`) the WebView goes edge to edge ([SystemBars](https://capacitorjs.com/docs/apis/system-bars), [edge-to-edge guide](https://capawesome.io/blog/capacitor-edge-to-edge-and-safe-areas-guide/)). **Done in this spike:** our `--safe-*` tokens now use `var(--safe-area-inset-*, env(safe-area-inset-*, 0px))`.
- **Storage.** WebView data (IndexedDB included) lives in the app's private data directory, not its cache, so "Clear cache" shouldn't remove it, while "Clear storage" and uninstalling do. Whether Chromium's quota eviction applies inside WebView under storage pressure has to be checked on the device (`navigator.storage.persisted()` and `estimate()` on `/spike/mobile`).
- **File import.** `<input type="file">` is handled by Capacitor's WebChromeClient, which opens the system picker. Our `files` adapter already uses it.

## Device checks to run (owner, about 15 minutes)

Unlock the phone and keep it on USB. From `apps/web`: `npm run fixtures:narration` (once the narration spike has merged; it produces the chapter audio), then `npm run cap:android`. Open the dev panel → Spikes → **Mobile capabilities**, and note for each:

1. **Platform and safe areas:** the two inset rows, and whether the green frame sits inside the notch and the gesture bar, in portrait and landscape.
2. **Storage:** tap "Write a marker", then "Request persistent storage" (does `persisted` become true?). Close the app, use *Settings → Apps → Book Reader (PoC) → Storage → Clear cache*, and reopen: is the marker still there?
3. **Import:** "Choose an EPUB…" and pick one from Files or Downloads. Does the picker open, and does the line show the file?
4. **Background narration:** play, lock the phone for about a minute, and look at the lock screen (controls? title?). Unlock and read the log: "audio advanced N s" against "away N s". Then try the same with the app in the background but the screen on.
5. **Long-press selection:** long-press a word in the reader box and drag the handles, with the checkbox off and then on. Does Android's own Copy/Share menu appear? Does our toolbar stay clear of the handles? Does the selection line show whole Words?

Then `node scripts/probe-phone.ts` with the app open prints the same facts as JSON for this ADR.

## Provisional decisions (to confirm with the results)

| Capability | Proposal | Confirm by check |
|---|---|---|
| Background narration | `lib/platform` audio: on Android, native playback with a native media session (Capawesome Audio Player ≥ 8.4) in a `mediaPlayback` foreground service. The WebView polls the native position about every 50 ms to drive highlighting while visible. On the web, keep `HTMLAudioElement` + Media Session. | 4. If the WebView keeps playing while locked *and* the lock screen shows working controls, the web implementation could suffice for the PoC; the native route stays the plan for release. |
| Selection | Keep native selection (handles, magnifier, accessibility) and add our toolbar beside it. Suppress the native menu only if it covers our toolbar and `contextmenu` suppression works; otherwise place our toolbar on the opposite side of the selection. | 5 |
| File import | `<input type="file" accept=".epub,application/epub+zip">` through the `files` adapter; no plugin. | 3 |
| Safe areas | Capacitor SystemBars with `insetsHandling: "native"` and `EdgeToEdge.enable` in `MainActivity` (Capacitor 9 makes that the default); tokens as above. | 1 |
| Storage | Request persistent storage after the first highlight or import (P1-APP-04). Processed Books stay in IndexedDB unless check 2 shows WebView data can be evicted, in which case they move to Capacitor Filesystem in the app's data directory. | 2 |

## Consequences

- New native dependency, if check 4 confirms it: `@capawesome/capacitor-audio-player` (Capawesome plugins can be sponsorware; check its licence terms before adding it), declared in the PR with its Android service and foreground-service permissions, and the Play Console foreground-service declaration noted for P1-QA-03.
- P1-LAY-04's narration player reads time from the platform adapter, never from an `<audio>` element directly, so the native and web implementations are interchangeable.
- iOS (IOS-04 to IOS-08) needs the same checks on an iPhone; this ADR covers Android only.
