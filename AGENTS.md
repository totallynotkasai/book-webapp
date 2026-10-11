# AGENTS.md

Read docs/DESIGN.md §0–§3 before any task. Glossary terms and Invariants are binding.
Find your task ID in docs/DESIGN.md §13; check its dependencies and any OPEN items it touches.
Its phase, UX notes and Try-it checklist are in docs/IMPLEMENTATION-PLAN.md.
Current stage: local-first proof of concept. No backend: user data goes through `Stores` and server-side operations through `Backend` (simulated in the browser by `backend-local`), both in `@book/core`.
Targets web and Android (tested on the owner's phone). iOS is deferred: see docs/BACKLOG.md.

## Commands

```bash
npm install
npm run dev     # web app at localhost:5173
npm run check   # svelte-check + tsc
npm run lint    # Prettier + ESLint
npm test        # Vitest (unit, contract and import-boundary tests)
npm run test:e2e   # builds, then Playwright in Chromium + WebKit
npm run build   # static web app
npm run dev:host                    # dev server reachable from the phone over Wi-Fi
npm run build:tester -w @book/web   # tester profile into apps/web/build-tester
npm run cap:sync | cap:android      # from apps/web: sync, or build + install on the phone over adb
```

Import boundaries (DESIGN.md §5.3) are ESLint rules in `eslint.config.js`, tested in `tests/`.

## Rules

- One branch/PR per plan phase (branch: `p0-1-foundations`), with the task ID in every commit message (D-025).
- Svelte 5 runes only. TypeScript strict. Types and schemas live in `@book/core`.
- Never import the reader engine outside `packages/reader-core`.
- In `apps/web`, only `src/lib/services.ts` may import `storage-local` or `backend-local`. Business rules go in `packages/domain`.
- Simulated features never decide an OPEN item: use placeholder values marked `// SIMULATION:` and list them in the PR.
- Never store page numbers, CFIs or offsets; attach everything with Anchors.
- Never bundle or self-host Arial Rounded MT (commercial font); use it only via the font stack, with Nunito as the fallback.
- Never resolve an OPEN-xx item silently; propose it in the PR.
- Meet the Definition of Done in docs/DESIGN.md §12.5.
