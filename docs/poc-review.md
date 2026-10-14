# PoC review kit

> **What it's for:** running the PoC review (DESIGN.md §13.3): 5–10 readers from the launch audience, including some who call themselves reluctant readers, and the owner's own beta readers, then the go/no-go on Phase 2. Built in P1-QA-03.
> **What testers get:** the tester build, reading only unless a session adds simulated areas (D-031). On the web in any browser (iPhone testers use Safari, D-024), and on Android as an app (D-030).

## Before the first session (the owner)

1. **Turn on GitHub Pages:** the repository's Settings → Pages → Source: **GitHub Actions**. GitHub Pages needs a public repository, or a paid plan for a private one (D-029). Making the repository public publishes its code and history. With a paid plan the code stays private, but the site itself is still public to anyone who has its address.
2. **Build and deploy:** Actions → **Tester build** → Run workflow, from `main` (the `github-pages` environment only takes deploys from the default branch), leaving "Include the narration audio" ticked. It takes about 10 minutes: it encodes the narration, builds the tester web app and the signed APK, and publishes both. The deploy job shows the site's address, `https://totallynotkasai.github.io/book-webapp/`.
3. **Try it yourself:** open the site on a computer and on your phone; the welcome appears once. On an Android phone, install `…/book-webapp/book-reader-poc.apk` and run the device checklist's install and Phase 1 exit sections.
4. **Bookmark the sessions page:** `…/book-webapp/sessions.html` has a link for each kind of session. It isn't linked from the app.
5. **Note the build:** You → Help shows the build's date and commit ("Tester build · 2026-10-14 · a1b2c3d"). Write it on each observation sheet.

To update testers later, run the workflow again: the web app updates when it is next opened (GitHub Pages may serve the old files for a few minutes), and a newer APK installs over the old one.

## Preparing each session

- **Pick the session type** and open its link on the tester's device from `sessions.html`: reading only (the default), reading and the store, reading with store and community illustrations, or everything simulated. The device remembers it until another link changes it. Android: "In the Android app" opens the installed app with those areas.
- **Start clean,** so every tester sees the welcome:
  - Web on your computer: a private (incognito) window, then the session link.
  - The tester's own phone or browser: nothing to do the first time.
  - A phone that has been used before: Android Settings → Apps → Book Reader (PoC) → Storage → Clear storage (this deletes everything in the app), or in a browser, clear the site's data.
- **Charge the device** and turn the volume up: narration is part of the test.
- **Have the observation sheet** ready, one per tester.

## Session script (30–40 minutes)

Read the words in quotes; the rest is for you. Don't help unless the tester is stuck for more than a minute, and note where you did.

**1. Welcome (2 min).** "Thanks for helping. We're testing the app, not you: if something's confusing, that's the app's fault, and it's exactly what we need to know. Please think out loud as you go: what you're looking for, what you expect, what surprises you. Nothing you do costs money or leaves this device."

**2. First minute (unprompted).** Hand over the link or the phone with the app's icon. "This is a reading app. Start reading." Time from the first tap to the first page of *Alice* (the acceptance in P1-QA-03 is under a minute, unaided). Note any hesitation.

**3. Free reading (5–8 min).** "Read for a few minutes, as you would at home." Watch, don't prompt:

- Do they find the pictures? (The picture button on the page; the dot says a new one is there.)
- Do they find the narration? (The headphones button at the bottom.)
- How do they turn pages: tapping, swiping, the arrows?

**4. Pictures (3 min, if not found).** "This book has illustrations. Have a look." Then: "There are other ways to show them. Try one." Note which mode they prefer and why.

**5. Narration (5 min, if not found).** "The first three chapters can be read aloud to you." Let them listen for a couple of minutes. Do they follow the highlight? Leave the screen on its own? Turn the speed up or down? Do they keep it on when you stop prompting?

**6. Making it comfortable (3 min).** "If you were reading in bed tonight, how would you set it up?" (Text size, font, theme, dark mode.)

**7. Notes and bookmarks (3 min).** "Find a line you like and keep it somewhere you could find it again." Then: "Mark this page so you can come back to it."

**8. Store (sessions with the store, 5 min).** "Imagine you'd enjoyed this book. Have a look at what else there is for it." Then: "The author has a serial. How could you support them?" Remind them it's pretend if they hesitate.

**9. Wrap-up interview (5–10 min).** The questions below.

## Observation sheet

One per tester.

| Field | Notes |
|---|---|
| Tester (initials or number); reader type (keen, occasional, reluctant, beta reader) | |
| Device, browser or app; build (You → Help) | |
| Session type | |
| Time from first tap to *Alice*'s first page; any help given | |
| Pictures: found unprompted? when? which mode did they keep? | |
| Narration: found unprompted? kept on after prompting stopped? speed changes? | |
| Did the highlighting help them keep going? (their words) | |
| Moments that felt slow (what they were doing) | |
| Moments of confusion (what they expected instead) | |
| Errors, crashes or anything broken (iPhone testers: what broke in Safari) | |
| Store sessions: what they'd buy, tip or subscribe to, and at what price | |
| Quotes worth keeping | |

## Questions (DESIGN.md §13.3)

**Observe** (from the sheet): do testers turn on illustrations and narration unprompted? Do they keep them on? Does narration with highlighting help them keep going? Does anything feel slow or confusing?

**Ask:**

1. "Would you read the launch title this way? Why, or why not?"
2. "Which of the pictures or the narration would you miss if it were gone?"
3. "What would you pay for: the book, the pictures, the narration, all of it? Would you tip or subscribe to an author?" (Store sessions: "Was anything in the store unclear?")
4. "What nearly made you stop?"
5. "Anything else?"

## After the sessions: decide and record

Summarise the sheets (counts for the yes/no rows, the strongest quotes), then record in DESIGN.md §16:

- **Go or no-go on Phase 2.**
- **The backend stack:** confirm or change D-004 (§5.2).
- **Hosting** for the API and worker: OPEN-06.
- **Ambient audio:** whether it stays Parked (D-011).

Note anything that changes a phase's plan in IMPLEMENTATION-PLAN.md, and anything deferred in BACKLOG.md.

## Known limits testers may meet

- **Everything stays on the device.** There are no accounts: a tester's notes don't follow them to another device or browser, and clearing the site's data or the app's storage deletes them.
- **The store, Studio, community and moderation are simulated,** and say so: no money, no real accounts, nothing published leaves the device.
- **iPhone (Safari)** hasn't been tried on a real iPhone (D-024): narration with the screen locked or Safari in the background (BACKLOG.md IOS-04) and importing an EPUB from the Files app (IOS-06) are the likeliest gaps. Ask iPhone testers to note what breaks.
- **Narration covers chapters 1–3** of *Alice*; other Books have none.
- **The Android app is a test build** installed from a file: Android warns about installing it, and it doesn't update by itself.
