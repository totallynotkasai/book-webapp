# ADR-006: The device voice: text-to-speech on the web and on Android

- **Status:** **Accepted** (16 October 2026). The owner chose on-device voices only and the device voice wherever the reader doesn't own a Book's narration (D-036) before the work started; the rest follows DESIGN.md's P1-LAY-08 and the spike below.
- **Date:** 16 October 2026
- **Task:** P1-LAY-08 Device voice (Phase 1.11). The iPhone checks are backlog item IOS-15.
- **Spike code:** not kept. The probes were throwaway scripts run through Playwright (desktop browsers) and Playwright's Android support (the app's WebView on the emulator); what they checked is now covered by `apps/web/e2e/device-voice.spec.ts`, `tests/reader-mapping.test.ts` and the device checklist.

## Context

Narration (P1-LAY-04, ADR-004) only exists where someone recorded and aligned it: *Alice*'s chapters 1–3 in the PoC. P1-LAY-08 reads any Book aloud with the device's own text-to-speech, with narration's highlighting, auto-turn, tap-to-seek and speed, so testers can try the core bet (DESIGN.md §1.3) on a Book they bring. It needs to know, on each platform:

1. whether there is a speech API at all, and which voices it offers;
2. whether it reports where it is (Word boundaries), which is what highlighting needs;
3. whether it keeps speaking with the screen locked on Android (DESIGN.md §13.2 asks the ADR to record this; the sleep timer, P1-LAY-09, needs it);
4. whether a voice sends the text somewhere to be spoken.

## Spike results

Run on 16 October 2026 on the owner's PC (Windows 11) and the Android Studio emulator (`book_compact`, API 36, WebView 133, Google's speech engine `com.google.android.tts`). Each probe spoke two sentences of *Alice* and logged the voices and every event.

| Platform | Speech API | Voices | Word boundaries | Notes |
|---|---|---|---|---|
| Chromium 153 (Playwright, headless) | `speechSynthesis` | On a blank page, none within 3 s; in the app, Windows' voices once they've loaded. None on Linux (CI) | Yes, every Word (`charIndex`, `charLength`) | Speaks with Windows' default voice even before any is listed. Because what headless Chromium offers depends on the machine, E2E starts every spec with no Web Speech API and installs a stand-in where it reads aloud |
| Edge 155 (Windows 11) | `speechSynthesis` | 3, all on-device: Microsoft George, Hazel, Susan (en-GB) | Yes, every Word | The Windows voices (SAPI) are local. Edge also offers "Online (Natural)" voices on most profiles: `localService: false`, so never offered (D-036) |
| Chrome (Windows, Android) | `speechSynthesis` | Chrome's own "Google …" voices are online (`localService: false`); Windows or Android voices are local | Local voices: yes. Google's online voices are known to report none, and to stop partway through long utterances | Not installed on this PC, so from Chrome's documented behaviour: a reason for D-036 besides privacy |
| WebKit 26.6 (Playwright on Windows) | **None** (`speechSynthesis` undefined) | — | — | The device voice is simply not offered. Safari on macOS and iOS has the API (AVSpeechSynthesizer); checking it needs an iPhone (backlog IOS-15) |
| Android WebView 133 | **None** (`speechSynthesis` undefined) | — | — | Confirms DESIGN.md's plan: a native plugin |
| Android `TextToSpeech` (our plugin) | Native | 9 on-device voices on the emulator, all US English, plus the engine's network voices (filtered out) | Yes: `UtteranceProgressListener.onRangeStart` (Android 8+) gives every Word's range | **Keeps speaking with the screen off:** screen off for 20 s mid-Chapter, the voice went on from Word 249 to Word 338 and the media session said PLAYING throughout; on waking, the reader had turned to the page being spoken. The lock screen itself wasn't seen: the emulator has no screen lock (device checklist) |

## Decision

1. **A `speech` adapter in `lib/platform`** (`SpeechAdapter`, `types.ts`), beside `audio`. It speaks a queue of *utterances*, one per sentence (`sentenceSpans`, DESIGN.md §8.3), each with an id, and reports `current`: the utterance and the character offset of the Word being said. `BookSpeech` (`lib/reader/speech.svelte.ts`) turns that back into the Word on the page through each sentence's Word offsets (`lib/reader/speech-text.ts`).
   - **Web:** the Web Speech API, one utterance at a time (`web-speech.ts`). Pausing cancels and remembers the Word; resuming speaks the rest of the sentence from it. `speechSynthesis.pause()` isn't used: it's unreliable across browsers (on Android Chrome it ends the utterance rather than pausing it).
   - **Android:** our own Capacitor plugin, `Speech` (`android/app/src/main/java/.../speech/`, Kotlin), as D-027 did for narration: Android's `TextToSpeech` in `SpeechService`, a `mediaPlayback` foreground service with a Media3 media session around a small `SimpleBasePlayer`. The session shows the Chapter, "Device voice" and the Book on the lock screen and in the notification, with play/pause and previous/next sentence. The engine is handed a few sentences at a time and each sentence starting queues the next, so speech carries on through the Chapter, and into the next one (the app queues it as soon as a Chapter starts), with the WebView asleep. It requests audio focus and pauses when headphones are unplugged.
2. **On-device voices only (D-036).** The web adapter offers only voices with `localService`; the plugin only voices that don't need the network and are installed. The text being read never leaves the device, and every voice offered reports Word boundaries in our tests.
3. **Highlighting by sentence when a voice gives no Words.** A voice (or Android before 8) that reports only the start of each sentence gets the sentence highlight even when the reader chose Word, and the player says why.
4. **A voice per language.** The reader's chosen voice is stored per language (`deviceVoice.voices.en`, Reader Preferences); a Book in a language no voice speaks doesn't offer the device voice, rather than reading French in an English voice. Its speed is its own (`deviceVoice.rate`), since a synthetic voice at 1× isn't a narrator's pace; highlighting and auto-turn are narration's.
5. **Words carry their punctuation.** `chapterText` now gives each Word with the punctuation around it (`“Well!”`), as its type always said, through `DocWordMap.punctuatedTexts()`. Voices need it for intonation, and `sentenceSpans` needs it to find sentence ends. Narration's sentence highlight had been whole paragraphs because of it (fixed here).

## Consequences

- A second foreground service and media session in the app (`.speech.SpeechService`, session id `device-voice`), and a `<queries>` entry for the `TTS_SERVICE` intent so Android 11+ lets the app see the speech engine. No new dependency: Media3 is already there (ADR-004), and `TextToSpeech` is part of Android.
- The Play Console's foreground-service declaration (BACKLOG AND-01) covers speech as well as narration.
- E2E can't hear a voice: CI's headless Chromium has no voices, Playwright's WebKit has no API, and on Windows headless Chromium has the system's, so every spec starts with no Web Speech API and the device-voice specs install a scripted stand-in for `speechSynthesis` (`e2e/speech.ts`) that speaks a Word at a time on a timer with the real API's events. The Android plugin is checked on the emulator and the phone (device checklist).
- **On the phone** (device checklist): the lock-screen view, that the voice carries on for several minutes with the screen locked (OEM battery managers, the owner's Xiaomi), the highlight's lag behind the voice by ear (DESIGN.md §12.3's 100 ms is measured for recorded narration), and the phone's own voices.
- **iOS** (backlog IOS-15): WKWebView has the Web Speech API, so the web adapter applies, but whether it speaks with the screen locked needs an iPhone.
