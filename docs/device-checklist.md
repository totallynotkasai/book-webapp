# Device checklist

> **What it's for:** every mobile build gets these checks before it goes to testers (DESIGN.md §12.1, P1-MOB-01), with the screen-reader walkthroughs from P1-QA-02.
> **Where:** the owner's Android phone (D-024). While the phone is busy with another project, the Android Studio emulator stands in (D-028): `book_compact`, API 36, Google APIs, 360 × 640 dp, WebView 133. iPhone checks are BACKLOG.md IOS-10 and IOS-11.

The **Emulator** column has the results from 13 October 2026 (tester APK and owner build from the Phase 1.9 branch). The **Phone** column is for the owner: tick each item when the phone is free.

## Before you start

- **Install.** Testers' app: `book-reader-poc.apk` from the tester site. The APK the CI run keeps as an artifact has no narration audio; the Tester build workflow's has. Android asks once to allow installs from the browser or Files app, and Play Protect may ask to scan an app it doesn't know. **If the phone still has the app from Phase 0** (a debug build under the same app ID), uninstall it first: Android won't install an app over one signed with a different key, and uninstalling deletes that app's data. The owner's own build: `npm run cap:android -w @book/web` with the phone on USB or wireless debugging. Both can be installed at once: the owner build is **Book Reader (dev)** (`…bookpoc.dev`) and the tester app is **Book Reader (PoC)**.
- **Mute media** if others are around: narration plays out loud.
- **Automated part.** With the phone connected (`adb devices` lists it), `node apps/web/scripts/android-smoke.mjs` runs the reading flow inside the tester app and reports each step; `--dev` runs it in the owner build and adds a store purchase, the Studio and the review queue. It adds a note and three bookmarks to *Alice*. `--fresh` starts from a clean app but **deletes the app's data on the phone**: leave it out on a phone you read on. Keep the phone unlocked while a script runs (Developer options → Stay awake, while charging).
- **Performance.** `node apps/web/scripts/perf-android.mjs` measures the reader budgets inside the app (P1-QA-01; results so far in `docs/perf/p1-qa-01.md`). The same `--fresh` warning applies.
- **Debugging.** The app's WebView shows in `chrome://inspect` on the PC.

## Install and launch

| Check | How | Emulator | Phone |
|---|---|---|---|
| App icon: a white open book on teal; with themed icons on (Android 13+) it takes the wallpaper colours | Home screen and app drawer | ✓ | ☐ |
| Splash screen: the white book on teal, then the app | Cold start | ✓ | ☐ |
| Name: "Book Reader (PoC)" for the tester app, "Book Reader (dev)" for the owner build | Home screen | ✓ | ☐ |
| First run: the welcome; Start reading opens *Alice* at Chapter I | Fresh install | ✓ (smoke) | ☐ |
| The strips behind the status and navigation bars match the page: light, dark, sepia, in the reader and on app screens (the bottom strip matches the navigation bar) | Settings → Appearance; open a book | ✓ light, dark, reader | ☐ (WebView 140+ draws edge to edge, so check nothing sits under the bars) |

## DESIGN.md's Phase 1 exit flow

| Check | How | Emulator | Phone |
|---|---|---|---|
| Change the text size and the layout; the same Word stays on screen | Ctrl+= in the smoke; Reading preferences by hand | ✓ (smoke) | ☐ |
| Illustrations: the pop-up picture, then per page; spread and in-text by hand | Illustrations button | ✓ pop-up, per page (smoke) | ☐ all four |
| Turn on narration; the highlight follows; pages turn by themselves | Listen to the narration | ✓ (smoke, native player) | ☐ |
| **Narration with the screen locked while pages turn**; the lock-screen controls play, pause and skip 15 s | Lock the phone while narration plays; unlock after a minute: the page has moved on | Notification-shade controls only (Phase 1.5; the emulator has no screen lock) | ☐ |
| Highlight a sentence and add a note | Long-press, drag the handles, Add note | ✓ (smoke, keyboard selection); long-press by hand in Phase 1.3 | ☐ |
| Place three bookmarks; they're listed | Bookmark this page | ✓ (smoke) | ☐ |
| Close the app (Home, then swipe it away) and open it again: the same Word | | ✓ (smoke; fixed in 1.9, see below) | ☐ |
| Re-import an edited copy of an EPUB: notes survive | Library → Import EPUB from Files | Web E2E; file picker by hand in Phase 1.3 | ☐ |

## The device voice (Phase 1.11, ADR-006)

The **Emulator** column has the results from 16 October 2026 (owner build, `book_compact`).

| Check | How | Emulator | Phone |
|---|---|---|---|
| Any Book read aloud: the player says "Device voice" and the voice's name; each Word lights up as it's said; pages turn by themselves | Open *Treasure Island* (add it from the store), Read aloud | ✓ (*Alice* as the Reader, who doesn't own its narration) | ☐ |
| **The voice keeps speaking with the screen locked;** on unlocking, the page has moved on | Lock the phone for a few minutes while it reads | ✓ screen off for 20 s (no screen lock on the emulator) | ☐ (several minutes: Xiaomi's battery manager may stop it) |
| The lock screen shows the Chapter, "Device voice" and the Book, with play/pause and previous/next sentence | Lock screen and notification shade | Media session seen (`dumpsys media_session`: PLAYING, the Chapter, Device voice, the Book) | ☐ |
| The highlight keeps up with the voice: no Word lit noticeably before or after it's said | Listen with the screen on | — (muted) | ☐ |
| Change the speed and the voice; the next sentence uses them | Speed menu; More controls → Voice | ✓ 9 on-device US English voices; the engine's network voices aren't offered (D-036) | ☐ (which voices does the phone have?) |
| In *Alice* as the Author, chapters 1–3 play the recorded narration; Chapter IV offers the device voice | Listen in each | Web E2E | ☐ |
| A phone call or another app's audio pauses it; unplugging headphones pauses it | | ☐ | ☐ |

## Comfortable on a phone (Phase 1.13)

The **Emulator** column has the results from 16 October 2026 (owner build, `book_compact`, the screen turned off with `adb shell input keyevent 223`: the emulator has no screen lock).

| Check | How | Emulator | Phone |
|---|---|---|---|
| **The sleep timer stops narration on time with the screen locked,** fading out over its last few seconds; on unlocking the player says "Sleep timer: Off" | *Alice* as the Author, Chapter I: Listen, More controls → Sleep timer → 5 minutes; lock the phone | ✓ (paused 5:02 into the Chapter, set 2 s after play; muted, so the fade wasn't heard) | ☐ (listen for the fade) |
| **"End of chapter" with the screen locked:** narration stops at the Chapter's end; unlocked, it's paused at the start of the next Chapter, and play goes on from there | Set it, drag the position near the Chapter's end, lock the phone | ✓ (media session paused at 0:00 of Chapter II; on waking, the page at Chapter II) | ☐ |
| The sleep timer stops the device voice at the end of a sentence (minutes) or before the next Chapter (End of chapter), with the screen locked | *Alice* as the Reader, Chapter IV | ✓ End of chapter (stopped before Chapter V) | ☐ |
| Pausing freezes the timer's countdown; the menu marks the last choice ("…, as last time") | Pause from the lock screen, then look at the player | Web E2E | ☐ |
| **The table viewer:** the status window's stat table at 200% has "Open table"; it opens full screen at the same text size; pinch zooms, a finger pans, Back closes it | Dev panel → Import the status-window fixture; Text size 200% | ☐ | ☐ |
| A swipe across the squeezed table on the page still turns the page | Swipe on the table | Web E2E (Chromium touch) | ☐ |
| The reader's top bar on the phone: the titles are readable; search, Illustrations and reading preferences are under ⋮ | Open any Book | Web E2E (360 px) | ☐ |

## Your reading (Phase 1.16)

| Check | How | Emulator | Phone |
|---|---|---|---|
| "9 min left" sits under the page number on the phone, and settles to your pace over ten minutes of reading | Read *Alice* Chapter I | Web E2E (360 px) | ☐ |
| **Listening with the screen locked counts:** after 20 minutes of narration with the phone locked, You → Your reading has about 20 minutes more, "of it listening" | *Alice* as the Author, Chapter I: Listen, lock the phone, unlock after 20 minutes, open You → Your reading | ☐ | ☐ |
| Turning "Keep reading stats" off hides them, and reading on adds nothing | You → Your reading | Web E2E | ☐ |

## Share and colour (Phase 1.17)

| Check | How | Emulator | Phone |
|---|---|---|---|
| **Share a sentence of *Alice* as a picture to yourself:** the share sheet shows the card and the quote; the picture arrives whole, in the reader's colours and font | Long-press a sentence, Share quote, Share, pick Messages or Gmail | ✓ the share sheet ("Sharing image", the card and the quote's text); not sent on | ☐ |
| The same as text: the quote, then "— Lewis Carroll, Alice's Adventures in Wonderland" | Share quote → Text → Share | ☐ | ☐ |
| **Custom colours:** a dark green page with cream text; the bars behind the status and navigation bars follow the page; a pair below AA shows the warning and leaves the page as it was | Reading preferences → Theme → Custom; type `#1f3d2b` and `#f3ead3`, then a darker green text | Web E2E | ☐ |
| The round swatch at the end of each colour field opens Android's colour picker | Tap it | ☐ | ☐ (if nothing opens, the hex field and the suggestions still work) |

## Wishlists and reviews (Phase 1.18, owner build)

| Check | How | Emulator | Phone |
|---|---|---|---|
| The heart on a store card is easy to hit with a thumb, and doesn't open the Book | Store: tap the heart on *The Lamplighter's Ledger* | Web E2E (360 px) | ☐ |
| A sale alert arrives: wishlist the Ledger as the Reader, lower its price as the Author (Studio → Details), back as the Reader: You → Inbox | Dev panel → Personas | Web E2E | ☐ |
| Write a review with the on-screen keyboard: the dialog's buttons stay in reach | *Alice*'s Book page → Write a review | ☐ | ☐ |

## Android behaviour

| Check | How | Emulator | Phone |
|---|---|---|---|
| Back closes an open sheet, dialog, menu, selection or picture first; then goes back a screen; on the Library it puts the app in the background | Back gesture or button | ✓ (smoke and by hand; fixed in 1.9) | ☐ |
| Leaving the app saves the reading place at once | Turn a page, go Home straight away, swipe the app away, open it | ✓ (fixed in 1.9) | ☐ |
| Turning the phone: the page lays out again | Rotate in the reader | ✓ | ☐ |
| Large system text (Settings → Display → Font size) | 130% | ✓ (the reader's controls cover the first line until they fade) | ☐ |
| Dark mode follows the system | Quick settings | ✓ | ☐ |
| Selection handles and our toolbar; no Android menu over it | Long-press a word | ✓ (Phase 1.3) | ☐ |
| Export notes through the share sheet | You → Your data | ✓ (Phase 1.3) | ☐ |
| Facilitator link opens the app with the store | `…/sessions.html` → In the Android app | ✓ (the link's intent, through adb) | ☐ (tap it in Chrome) |
| Airplane mode: the Library and books already opened still work | | ☐ | ☐ |

## Simulated areas (owner build)

| Check | How | Emulator | Phone |
|---|---|---|---|
| Buy the Complete edition (simulated); pictures and narration are there | `android-smoke.mjs --dev` | ✓ | ☐ |
| Creator Studio opens as the Author; the review queue as the Moderator | `--dev` | ✓ | ☐ |
| Upload an EPUB from the phone's files; attach a picture from the gallery | Studio → Upload; Creator mode → Attach picture | ☐ | ☐ |

## Screen readers (P1-QA-02)

**What's been checked automatically:** axe at WCAG 2.2 AA on every route and on each of the reader's panels, light and dark, in Chromium and WebKit; keyboard use in the reader and app specs; on the emulator, the Android accessibility tree TalkBack reads (below). adb can't perform TalkBack's gestures or record its speech, so the spoken walkthroughs are for the owner.

**Emulator, 13 October 2026:** in the Library, the cards read as title, author, progress and "Illustrated", "Narrated". In the reader, each paragraph is one whole piece of text (the Word marking splits nothing, ADR-002) and the whole Chapter can be read on from there; the hidden controls are out of reach until shown, and the page number is a live region.

### TalkBack (Android)

Settings → Accessibility → TalkBack on. Swipe right and left to move, double-tap to activate.

| Step | Expect | Phone |
|---|---|---|
| Open the app | "Library"; the welcome reads its title, points and both buttons | ☐ |
| Start reading | The book title and "CHAPTER I. Down the Rabbit-Hole"; swiping reads paragraph by paragraph, every Word intact | ☐ |
| Double-tap the text | The reading controls appear; each is named ("Back to library", "Bookmark this page", "Illustrations", "Contents and notes", "Reading preferences", "Next page") | ☐ |
| Next page | The new page number is announced | ☐ |
| Bookmark this page | Announced as on (pressed) | ☐ |
| Listen to the narration | Plays; where it can't, the button says why | ☐ |
| Reading preferences | Each slider and choice reads its name and value; Back closes the sheet | ☐ |
| Contents and notes | Chapters, Notes and Bookmarks tabs; a chapter opens it | ☐ |
| Select text and add a note (TalkBack's reading controls → text selection) | Note it if this is hard: it decides how notes work for screen-reader users | ☐ |

### Desktop screen reader

NVDA (free) or Narrator (Windows, Ctrl+Win+Enter), in Chrome, on the web build. Keyboard only. In a book, NVDA reads in browse mode, where it keeps the arrow keys for itself: press NVDA+Space (Insert+Space) for focus mode before turning pages with the arrows, and again to go back.

| Step | Expect | Desktop |
|---|---|---|
| First Tab | "Skip to content" | ☐ |
| Library | Headings, the Import button, each book card | ☐ |
| Open *Alice*, then H for the next heading and arrow keys to read | The chapter heading and paragraphs read in order | ☐ |
| Turn pages with → and Page Down | The page number is announced | ☐ |
| ? | The keyboard shortcuts dialog; Esc closes it | ☐ |
| Shift+→ three times, Tab into the toolbar, ← → across the colours, Enter | The selection toolbar's buttons are named; the highlight is announced | ☐ |
| You → Help | The keyboard map as a table with row headers | ☐ |

## Found and fixed while checking (Phase 1.9)

- **Leaving the app didn't save the reading place at once on Android:** Capacitor keeps the WebView running in the background, so the page gets no `visibilitychange` or `pagehide`. The last 2 seconds of reading could be lost if Android then closed the app. It now also saves on the App plugin's `pause`.
- **Back left the reader with a sheet still open,** and on the Library went "back" to the start page, which opens the Library again.
- **Dialogs taller than a small phone** hid their buttons below the fold; the body now scrolls between the title and the buttons.
- **With reduced motion on, an indeterminate progress bar showed nothing** (it was parked at its last keyframe, out of view).
