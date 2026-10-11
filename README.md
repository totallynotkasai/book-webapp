# Book Reader

An interactive ebook reader where the text, illustrations and audio stay in sync.
See [docs/DESIGN.md](docs/DESIGN.md) for the full design, and [AGENTS.md](AGENTS.md) for the rules
coding agents follow.

**Current stage:** proof of concept. No backend: everything runs in the browser and
reading data (settings, bookmarks, notes, progress) is stored locally in IndexedDB.

## Getting started

Requires Node 22+.

```bash
npm install
npm run dev
```

| Command          | What it does                           |
| ---------------- | -------------------------------------- |
| `npm run dev`    | Start the web app at localhost:5173    |
| `npm test`       | Run unit tests (Vitest)                |
| `npm run check`  | Type-check every package               |
| `npm run lint`   | Check formatting (Prettier) and ESLint |
| `npm run format` | Auto-format everything                 |
| `npm run build`  | Build the static web app               |

## Structure

```
apps/
  web/                SvelteKit app: UI and routes only
packages/
  core/               Domain types, anchoring model, storage interfaces. No dependencies.
  storage-local/      Browser (IndexedDB) implementation of the storage interfaces
  tokens/             Design tokens (CSS custom properties) and preset themes
docs/                 Design doc
```

Dependencies only point one way: `apps → packages → core`. `core` never imports anything
framework- or platform-specific, so it can be reused by a mobile shell, a backend or a worker.

## Architecture rules

- **Never store page numbers.** Everything attached to the text uses a `Locator` or
  `TextRange` from `@book/core`, which are being replaced by word-based Anchors (design doc §6.1,
  task P0-02). Pages are recalculated whenever
  the layout changes.
- **The app talks to storage only through the interfaces in `@book/core`.** The implementation
  is chosen in one place, `apps/web/src/lib/services.ts`. Adding a backend means writing a new
  implementation of `Stores` and changing that one line.
- **Pure logic goes in packages, not in Svelte components**, so it can be unit-tested and reused.
- **Mobile-ready by default:** touch targets use `--touch-target`, layouts respect the
  `--safe-*` inset tokens, and nothing depends on hover.

## Platform decisions

- **Static output** (`@sveltejs/adapter-static`): deployable to any static host and ready to be
  wrapped by **Capacitor** for iOS/Android. Switch to a server adapter only when public book pages
  need server rendering.
- **Mobile:** Capacitor, reusing the web app (the reader relies on browser layout, so a React Native
  rewrite is not planned).
- **Backend:** deferred until after the proof of concept. Supabase is the likely candidate.
