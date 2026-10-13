# ADR-004: Mobile platform: audio, selection, files, safe areas and storage on Android

- **Status:** **Accepted** (12 October 2026, owner decision before Phase 1). Records D-018, amended by D-027: background narration uses **our own small Capacitor plugin on AndroidX Media3**, because the Capawesome Audio Player named below turned out to be available only to paying Capawesome Insiders. The device checks below run on the Android Studio emulator during Phase 1 (the owner's phone is busy with another project), and their results are added here as the features land.
- **Date:** 12 October 2026
- **Task:** P0-07 Spike: mobile platform capabilities. Records D-018 once accepted. The iOS equivalents are backlog items IOS-04 to IOS-08 (D-024).
- **Spike code:** was `apps/web/src/routes/spike/mobile/`, `apps/web/scripts/probe-phone.ts` and `apps/web/e2e/spike-mobile.spec.ts`; deleted in Phase 1.1. Each check is now covered by the real feature: import (P1-ING-02), selection (P1-RDR-06), narration (P1-LAY-04), storage (P1-APP-04).

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

## Device checks

Written for the owner's phone in Phase 0.2. In Phase 1 they run on the Android Studio emulator (API 36), against the real features rather than the deleted `/spike/mobile` page, and the results are recorded under "Results" below as each feature lands:

1. **Platform and safe areas:** the two inset rows, and whether the green frame sits inside the notch and the gesture bar, in portrait and landscape.
2. **Storage:** tap "Write a marker", then "Request persistent storage" (does `persisted` become true?). Close the app, use *Settings → Apps → Book Reader (PoC) → Storage → Clear cache*, and reopen: is the marker still there?
3. **Import:** "Choose an EPUB…" and pick one from Files or Downloads. Does the picker open, and does the line show the file?
4. **Background narration:** play, lock the phone for about a minute, and look at the lock screen (controls? title?). Unlock and read the log: "audio advanced N s" against "away N s". Then try the same with the app in the background but the screen on.
5. **Long-press selection:** long-press a word in the reader box and drag the handles, with the checkbox off and then on. Does Android's own Copy/Share menu appear? Does our toolbar stay clear of the handles? Does the selection line show whole Words?


## Decisions

| Capability | Decision | Check |
|---|---|---|
| Background narration | `lib/platform` audio: on Android, native playback with a native media session in a `mediaPlayback` foreground service, from **our own Capacitor plugin** (`apps/web/android`, Kotlin, AndroidX Media3 ExoPlayer + `MediaSessionService`, Apache-2.0) rather than Capawesome Audio Player, which needs a paid Insiders licence (D-027). The plugin reports its position on every change and every 250 ms while playing, and the WebView extrapolates between reports, so highlighting reads it every frame without a bridge call (planned as polling every 50 ms; see Results). On the web, keep `HTMLAudioElement` + Media Session. | 4 |
| Selection | Keep native selection (handles, magnifier, accessibility) and add our toolbar beside it. Suppress the native menu only if it covers our toolbar and `contextmenu` suppression works; otherwise place our toolbar on the opposite side of the selection. | 5 |
| File import | `<input type="file" accept=".epub,application/epub+zip">` through the `files` adapter; no plugin. | 3 |
| File export | `files.saveFile`: a download on the web; in the app, written to the cache with `@capacitor/filesystem` and offered through the Android share sheet with `@capacitor/share` (official plugins, MIT), since a download link does nothing in the WebView. Added in Phase 1.3 for notes and data exports. | (1.3) |
| Safe areas | Capacitor SystemBars with `insetsHandling: "native"` and `EdgeToEdge.enable` in `MainActivity` (Capacitor 9 makes that the default); tokens as above. | 1 |
| Storage | Request persistent storage after the first highlight or import (P1-APP-04). Processed Books stay in IndexedDB unless check 2 shows WebView data can be evicted, in which case they move to Capacitor Filesystem in the app's data directory. | 2 |

## Consequences

- New native code in P1-LAY-04: a small in-repo Capacitor plugin on AndroidX Media3 (`media3-exoplayer`, `media3-session` 1.11.1), with its `MediaSessionService`, the `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and `WAKE_LOCK` permissions, and the Play Console foreground-service declaration noted for P1-QA-03. The app module now builds Kotlin (Kotlin Gradle plugin 2.2.20, JVM target 21, as Capacitor). No third-party Capacitor plugin and no licence fee.
- P1-LAY-04's narration player reads time from the platform adapter, never from an `<audio>` element directly, so the native and web implementations are interchangeable.
- iOS (IOS-04 to IOS-08) needs the same checks on an iPhone; this ADR covers Android only.

## Results

Filled in during Phase 1 from runs on the Android Studio emulator (`book_phone`: Pixel 7 profile, API 36, Google APIs, x86_64). An emulator is not a phone: anything that depends on the hardware (real battery and thermal behaviour, OEM power management, the owner's two-display device) is re-checked on the phone when it is free again.

| Check | Result | Phase |
|---|---|---|
| 1. Safe areas | Emulator WebView 133 (below Chromium 140): Capacitor 8 SystemBars (`insetsHandling: "css"`, the default) pads the WebView rather than drawing edge to edge, so `--safe-area-inset-*` are 0 and content sits clear of the status bar and gesture bar. The strips behind the bars show the window background, which follows the system theme rather than the app's; P1-MOB-01 sets it from the app theme. Re-check on WebView 140+ (the phone), where the WebView goes edge to edge and the tokens carry the insets | 1.1 |
| 2. Storage | `navigator.storage.persist()` resolves false in the WebView, every time. It doesn't matter there: the WebView keeps IndexedDB in the app's own data (`app_webview`), not its cache. After a highlight, the app's cache was emptied (420 KB to 8 KB, as Settings → Apps → Storage → Clear cache does), the app force-stopped and reopened, and the highlight was still there. Only "Clear storage" or uninstalling removes it, so You → Data says "Kept with the app" on Android and offers the exports | 1.3 (P1-APP-04) |
| 3. Import | Works, with the plain file input and no plugin. On `book_compact` (API 36, WebView 133; `book_phone` was busy with another app), Import EPUB opens the system picker (DocumentsUI) at once; the first open after a cold boot takes about 5 s to draw. Picking `status-window.epub` from Downloads imports it in the worker (2 chapters, 430 words, the report) and Read now opens it; swipes turn pages. The picker remembers Downloads next time | 1.2 (P1-ING-02) |
| 4. Background narration | Passes on `book_compact` (API 36). Narration plays natively: our `Narration` plugin (`apps/web/android/app/src/main/java/.../narration/`, Kotlin) drives Media3 1.11.1's ExoPlayer in `NarrationService`, a `mediaPlayback` foreground service with a media session, through a `MediaController` on the main thread. **Screen off for 60 s** from 1:30: `dumpsys media_session` said PLAYING at 2:36, and on waking the reader had caught up and turned to the narrated page. **App in the background, screen on:** the system media controls show the Chapter's title, the narrator, play/pause, back and forward 15 s (Media3 `ICON_SKIP_BACK_15`/`FORWARD_15` buttons) and a seek bar; pausing there paused the app's player (both at 3:34). **Chapter to Chapter:** at the end of Chapter I the playlist went on to Chapter II by itself, and the reader turned to it. The notification is `VISIBILITY_PUBLIC`, which is what a lock screen shows, but this AVD has no screen lock (setting one changes the device's security settings), so the lock-screen view itself, and OEM battery management, are re-checked on the phone. Highlight timing: the WebView extrapolates between the plugin's 250 ms reports, and its position matched the session's whenever compared; the 100 ms target is measured on the web (P1-LAY-04 notes) and by ear on the phone, since the emulator's audio was muted | 1.5 (P1-LAY-04) |
| 5. Long-press selection | Long-press selects one whole Word with Android's handles, and Android's own menu (Copy, Share, Select all, Read aloud) appears *above* the selection. Our toolbar goes below it, 36 px clear of the handles, or docks at the bottom edge when there's no room below; so the two never overlap and the native menu isn't suppressed. Dragging a handle extends the selection; its Anchor snaps to whole Words. Setting the selection from script (to snap what's shown) removed Android's handles and menu, so a touch selection is left as Android draws it. On a 360 px screen the toolbar is one row of 40 px buttons | 1.3 (P1-RDR-06) |
