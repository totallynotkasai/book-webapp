# Book Reader

An interactive ebook reader where the text, illustrations and audio stay in sync.
See [docs/DESIGN.md](docs/DESIGN.md) for the full design,
[docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) for the build order,
[docs/BACKLOG.md](docs/BACKLOG.md) for deferred work, and [AGENTS.md](AGENTS.md) for the rules
coding agents follow.

**Current stage:** proof of concept. No backend: everything runs in the browser and
reading data (preferences, bookmarks, notes, progress) is stored locally in IndexedDB. Server-side
areas (store, Creator Studio, community, moderation) run against a simulated backend in the
browser (DESIGN.md §5.6).

## Getting started

Requires Node 22+.

```bash
npm install
npm run dev
```

| Command            | What it does                                   |
| ------------------ | ---------------------------------------------- |
| `npm run dev`      | Start the web app at localhost:5173            |
| `npm test`         | Run unit and contract tests (Vitest)           |
| `npm run test:e2e` | Build, then run Playwright (Chromium + WebKit) |
| `npm run check`    | Type-check every package                       |
| `npm run lint`     | Check formatting (Prettier) and ESLint         |
| `npm run format`   | Auto-format everything                         |
| `npm run build`    | Build the static web app                       |

## Trying it on your Android phone

No emulator: builds go straight to your own phone (DESIGN.md D-024; iOS is in
[docs/BACKLOG.md](docs/BACKLOG.md)).

**In the phone's browser, over Wi-Fi.** Run `npm run dev:host` and open the `Network:` address it
prints on your phone (same Wi-Fi). Windows may ask once to allow Node.js through the firewall.

**In the phone's browser, over USB.** With USB debugging on, run `npm run dev`, then
`adb reverse tcp:5173 tcp:5173` and open `http://127.0.0.1:5173` on the phone (use `127.0.0.1`,
not `localhost`, which some phone browsers resolve to IPv6).

**As the app.** Turn on Developer options and USB debugging (or Wireless debugging, then
`adb pair`), connect the phone, and run `npm run cap:android` from `apps/web`. It builds the web
app, syncs it into the Android project, builds a debug APK and installs and launches it. It finds a
JDK 21 (Capacitor 8 needs one; Android Studio keeps one in `~/.jdks`) and the Android SDK itself. If
several devices are connected, set `ANDROID_SERIAL`. Debug the app's WebView from
`chrome://inspect` on the PC. `npm run cap:open` opens the project in Android Studio.

## Dev panel, Personas and build profiles

Owner builds have a developer panel at `/dev` (linked from the Library). It switches between the
seeded Personas (Reader, Author, Illustrator, Moderator), each with their own notes, progress and
preferences on the device, and controls the simulated backend: latency, failure rate, offline,
payment outcome, AI-detector verdict and a clock you can move forward. It can also reset the demo
data or wipe everything the app stores on the device.

`npm run build:tester -w @book/web` builds the `tester` profile into `apps/web/build-tester/`:
reading only, no dev panel. `VITE_FLAGS` adds simulated areas for a review session; see
`apps/web/.env.example`.

## Structure

```
apps/
  web/                SvelteKit app: UI and routes only; android/ is the Capacitor project
packages/
  core/               Domain types, Anchors, Zod schemas, Stores and Backend interfaces
  domain/             Pure business rules (Entitlements, money, roles), shared with the Phase 2 API
  contract-tests/     Shared suites every Stores and Backend implementation must pass
  backend-local/      Simulated Backend in the browser: own database, seed, Personas, controls
  storage-local/      Browser (IndexedDB) implementation of the storage interfaces
  tokens/             Design tokens (CSS custom properties) and preset themes
fixtures/seed/        Demo data for backend-local (validated on load)
docs/                 DESIGN.md, IMPLEMENTATION-PLAN.md, BACKLOG.md
tests/                Repo-level tests (import boundaries)
```

Dependencies only point one way: `apps → packages → core`. `core` never imports anything
framework- or platform-specific, so it can be reused by a mobile shell, a backend or a worker.

## Architecture rules

- **Never store page numbers.** Everything attached to the text uses a word-based `Anchor` from
  `@book/core` (DESIGN.md §6.1, Invariants 1–2). Pages are recalculated whenever the layout
  changes.
- **The app talks to storage only through the interfaces in `@book/core`.** The implementation
  is chosen in one place, `apps/web/src/lib/services.ts`. Adding a backend means writing a new
  implementation of `Stores` and changing that one line.
- **Pure logic goes in packages, not in Svelte components**, so it can be unit-tested and reused.
- **Mobile-ready by default:** touch targets use `--touch-target`, layouts respect the
  `--safe-*` inset tokens, and nothing depends on hover.
- **Import boundaries are lint errors** (DESIGN.md §5.3): see `eslint.config.js`.

## Platform decisions

- **Static output** (`@sveltejs/adapter-static`): deployable to any static host and ready to be
  wrapped by **Capacitor** for Android and, later, iOS. Switch to a server adapter only when public
  book pages need server rendering.
- **Mobile:** Capacitor, reusing the web app (the reader relies on browser layout, so a React Native
  rewrite is not planned). Android first; iOS is deferred until a Mac and an iPhone are available
  ([docs/BACKLOG.md](docs/BACKLOG.md)).
- **Backend:** deferred until after the proof of concept. Until then the app talks to a simulated
  backend through the same `Backend` interface the real API will implement (DESIGN.md §5.6). The
  proposed server stack is in DESIGN.md §5.2.
