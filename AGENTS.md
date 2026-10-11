# AGENTS.md

Read docs/DESIGN.md §0–§3 before any task. Glossary terms and Invariants are binding.
Find your task ID in docs/DESIGN.md §13; check its dependencies and any OPEN items it touches.
Current stage: local-first proof of concept. No backend; all persistence goes through `Stores` in `@book/core`.

## Commands

```bash
npm install
npm run dev     # web app at localhost:5173
npm run check   # svelte-check + tsc
npm run lint    # Prettier + ESLint
npm test        # Vitest
npm run build   # static web app
```

Added in Phase 0: `npm run test:e2e` (Playwright) and, from `apps/web`, `npm run cap:sync | cap:ios | cap:android`.

## Rules

- One task ID per branch/PR (branch: `p1-rdr-04-preferences`).
- Svelte 5 runes only. TypeScript strict. Types and schemas live in `@book/core`.
- Never import the reader engine outside `packages/reader-core`.
- Never store page numbers, CFIs or offsets; attach everything with Anchors.
- Never bundle or self-host Arial Rounded MT (commercial font); use it only via the font stack, with Nunito as the fallback.
- Never resolve an OPEN-xx item silently; propose it in the PR.
- Meet the Definition of Done in docs/DESIGN.md §12.5.
