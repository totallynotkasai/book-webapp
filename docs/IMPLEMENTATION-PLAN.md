# Implementation plan: from groundwork to a product you can try

> **Status:** Accepted v1 · 11 October 2026 · Companion to [DESIGN.md](DESIGN.md) v0.3, which stays the source of truth.
> **Purpose:** the order of work that takes the repo from today's groundwork to a build the owner can use on desktop and on their Android phone to try every area of the product (reading, Illustrations, narration, notes, store, Creator Studio, community and moderation) with **no backend**, built so a real backend later replaces the simulated one without rewriting the app.
> **How it fits with DESIGN.md:** DESIGN.md §13 defines every task (its dependencies and acceptance criteria). This plan splits DESIGN.md's Phase 0 and Phase 1 into smaller phases that each end in something to try, and adds the architecture detail, UX notes and Try-it checklists. Decisions D-021 to D-024 (DESIGN.md §16) record what this plan changed. iOS work is in [BACKLOG.md](BACKLOG.md).

---

## 1. Summary

**Approach.** Build the core reading experience as DESIGN.md Phase 0 and Phase 1 describe. Alongside it, build a *simulated backend* that runs in the browser: a typed `Backend` interface in `@book/core`, implemented now by `@book/backend-local` (its own IndexedDB database, seeded demo data, simulated payments, a Persona switcher instead of sign-in) and in Phase 2 by an HTTP client for the real API. Shared contract tests prove both implementations behave the same. The business rules (Entitlements, Bundles, subscriptions, Flags, community policy) live in a pure `@book/domain` package that the Phase 2 API imports unchanged. The Store, Creator Studio, community and moderation areas can then be built and tried now, against the same interface the real backend will serve.

**Phases.** Each phase ends with a build the owner can open and try. Phases 0.x belong to DESIGN.md's Phase 0 and phases 1.x to its Phase 1, matching the task IDs (`P0-…`, `P1-…`). ★ marks the features that test the core bet (DESIGN.md §1.3).

| Phase | What the owner can try at the end | Tasks | Status |
|---|---|---|---|
| **0.1** Foundations | The app on desktop and on your Android phone; a dev panel with Personas and simulation controls | P0-01, P0-02, P0-03, P0-08, P0-09 | Done (11 Oct 2026; notes in §6) |
| **0.2** De-risk the reader | *Alice* in both candidate reader engines side by side; a first narration demo with Word highlighting | P0-04 to P0-07, P0-10, P0-11 | Done: ADRs accepted by the owner on 12 Oct 2026; spike code deleted in 1.1 (notes in §6) |
| **1.1** App shell and design system | Every area clickable with demo data; the whole app themed from one seed colour | P1-UI-01 to 03, P1-APP-01, P1-APP-02 | Done (12 Oct 2026; notes in §6) |
| **1.2** Read a book | *Alice*, the status-window fixture and your own EPUBs, fully customisable, resuming at the same Word | P1-ING-01, P1-ING-02, P1-RDR-01 to 05, P1-RDR-08, P1-APP-03 | Done (12 Oct 2026; notes in §6) |
| **1.3** Make it yours | Highlights, notes, Placed Bookmarks, export; an edited re-import keeps your notes | P1-RDR-06, P1-RDR-07, P1-ING-03, P1-APP-04 | Done (12 Oct 2026; notes in §6) |
| **1.4** Illustrations ★ | All four Illustration modes with the Tenniel pack, plus a second pack | P1-LAY-01, P1-LAY-02, P1-LAY-06, P1-LAY-07 | Done (12 Oct 2026; notes in §6) |
| **1.5** Narration ★ | Synced narration for chapters 1–3: highlighting, auto-turn, tap-to-seek, lock-screen playback | P1-LAY-03, P1-LAY-04 | Done (12 Oct 2026; notes in §6) |
| **1.6** Store and ownership (simulated) | Browse, buy (simulated) and claim Books; Complete edition; Bookmark Designs; Tips; Creator Subscriptions with early-access Chapters | P1-STO-01 to 05 | Not started |
| **1.7** Creator Studio (simulated) | Upload and publish a Book, publish a new Revision, build an Illustration Pack, add narration, set up plans | P1-STU-01 to 04, P1-LAY-05 | Not started |
| **1.8** Community and moderation (simulated) | Submit, approve, endorse and rate community Layers; Flags and the admin review queue | P1-COM-01, P1-COM-02, P1-ADM-01, P1-ADM-02 | Not started |
| **1.9** Android build and PoC readiness | The Android app, a tester build, the PoC review kit | P1-MOB-01, P1-QA-01 to 03 | Not started |

After phase 1.3 the work splits into two tracks that can run in parallel or in either order: the **Layers track** (1.4, 1.5) and the **Platform track** (1.6, 1.7, 1.8). See §7.

**Fastest routes to something you can feel:** the phase 0.2 spike pages (first real reading and narration on your phone), phase 1.1 (the whole product's shape, clickable) and phase 1.2 (the first reader you'd use every day).

**Sizes** in the task tables: **S** ≈ a day or less, **M** ≈ 2–4 days, **L** ≈ 1–2 weeks of focused work for one developer working with coding agents. They are for ordering work, not a schedule.

---

## 2. Where the repo is today

| Area | State |
|---|---|
| Hosting | Private GitHub repo `totallynotkasai/book-webapp`; no CI yet |
| Workspace | npm workspaces, strict TypeScript, ESLint, Prettier, Vitest, static SvelteKit build (`adapter-static`, SPA fallback) |
| `@book/core` | The v0.1 model: `Locator` (CFI + paragraph + character offset), `TextRange`, `Bookmark`, `Annotation` with a `kind` field, `ReaderSettings` with `high-contrast`, `curl` and `overview`. Helpers are unit-tested. `Stores` covers bookmarks, annotations, progress and settings |
| `@book/storage-local` | IndexedDB v1 via `idb`, IDs from `crypto.randomUUID()`, tested with `fake-indexeddb` |
| `@book/tokens` | Four hand-written `--color-*` themes, `--touch-target: 44px`, `readerTokens()` |
| `apps/web` | A Library placeholder linking to `/read/sample`; a reader placeholder with a theme, font and size popover; the *Alice* EPUB in `static/books/`, not yet rendered |
| Not started | Import-boundary lint, Playwright, CI, Capacitor, ADRs, reader engine, text pipeline, design system, Layers, any backend seam beyond `Stores` |

---

## 3. Decisions

**Made on 11 October 2026** (recorded in DESIGN.md §16):

| ID | Decision |
|---|---|
| D-021 | The PoC includes simulated Store, Creator Studio, community and moderation areas, behind feature flags so the PoC review can still show testers only the reading experience |
| D-022 | A typed `Backend` interface with a browser implementation (`backend-local`), shared contract tests and business rules in `domain` (§4). Rejected: mocking HTTP with a service worker (MSW), which is unreliable inside iOS WKWebView and awkward for binary book and audio content; running the Hono API itself in the browser, which would commit to the Proposed stack (D-004) before the PoC review |
| D-023 | Demo content: 4–6 Standard Ebooks titles (CC0) as store filler with no Layers; Arthur Rackham's 1907 *Alice* illustrations (public domain) as the demo community pack; the status-window fixture grown into a short original demo serial of about 6 chapters by a seeded author, for trying early-access Chapters and Creator Subscriptions. If an agent writes the serial, it is labelled AI-generated in the seed, which also demonstrates the AI labels |
| D-024 | iOS builds and iOS device testing go to [BACKLOG.md](BACKLOG.md): the owner has no Mac to build with and no iPhone to test on. The PoC targets web and Android, tested on the owner's Android phone instead of an emulator. Code stays iOS-ready |

**Still to decide:**

| Decision | Recommendation | Decided by |
|---|---|---|
| Reader engine (OPEN-01) | *Decided 12 Oct 2026: foliate-js (ADR-001, D-015)* | P0-04 |
| Word marking (OPEN-13) | *Decided 12 Oct 2026: Block offsets (ADR-002, D-016)* | P0-05 |
| Component approach (OPEN-02) | *Decided 12 Oct 2026: our own on Bits UI (ADR-005)* | P0-10 |
| Deterministic tokenisation (OPEN-14) | *Decided 12 Oct 2026: our own versioned tokeniser (D-026)* | P1-ING-01 |
| Placeholder brand seed colour (does not resolve OPEN-07) | *Decided 12 Oct 2026 (owner): deep teal `#00696B`*, in `PLACEHOLDER_SEED` in `packages/tokens` | P1-UI-01 |
| How testers get the build | Web: a free static host (it serves files only; no backend). Android: Play Console internal testing or a direct APK. Testers with iPhones use the web build in Safari | P1-QA-03 |

---

## 4. Architecture: built so the backend plugs in

### 4.1 Three seams

The app reaches everything outside its own UI through three interfaces, all chosen in `apps/web/src/lib/services.ts`:

| Seam | For | PoC implementation | Phase 2 implementation |
|---|---|---|---|
| **`Stores`** (DESIGN.md §6.3) | User-owned, local-first records: imported Books, Annotations, Placed Bookmarks, Reading Progress, Reader Preferences, Layer selection | `storage-local` (IndexedDB) | `storage-remote`: wraps `storage-local` with an outbox and incremental pull |
| **`Backend`** (DESIGN.md §5.6) | Server-authoritative operations: catalogue, Entitlements, checkout, Tips and subscriptions, Layers, publishing, community, moderation, sessions | `backend-local`: a simulated backend in the browser | `backend-http`: `fetch` against `/v1`, same schemas |
| **Device adapters** (`lib/platform/`, DESIGN.md §9.7) | Audio, files, share, haptics, deep links | Web and Capacitor (Android) implementations | Unchanged; iOS added from the backlog |

```mermaid
flowchart TB
  subgraph App["apps/web"]
    UI["Routes and components"] --> State["lib/state/*.svelte.ts"]
    State --> Svc["services.ts<br/>(the one place implementations are chosen)"]
  end
  Svc --> StoresI["Stores interface<br/>(@book/core)"]
  Svc --> BackendI["Backend interface<br/>(@book/core)"]
  Svc --> DeviceI["Device adapters<br/>(lib/platform)"]
  StoresI --> SL["storage-local<br/>user data in IndexedDB"]
  BackendI --> BL["backend-local<br/>simulated backend in the browser"]
  BL --> Domain["domain<br/>pure business rules"]
  BL --> TP["text-pipeline"]
  StoresI -. "Phase 2" .-> SR["storage-remote<br/>outbox + pull"]
  BackendI -. "Phase 2" .-> BH["backend-http<br/>fetch + same Zod schemas"]
  BH -.-> API["apps/api"]
  API -.-> Domain
```

### 4.2 The `Backend` interface

Defined in `packages/core/src/backend/` with a Zod schema for every input and output (DESIGN.md §10.1 already requires these schemas to live in `core`). Its modules mirror the planned API modules, so each Phase 2 route has a known caller:

| Module | What it does | Phase 2 equivalent (DESIGN.md §10.1) |
|---|---|---|
| `session` | Current user and role. In the PoC, `signInAs(personaId)` | Auth provider, `GET /v1/me` |
| `catalogue` | Shelves, search, Book pages, Creator profiles | `GET /v1/catalogue`, Book and Creator reads |
| `library` | The user's Entitlements grouped by Book; `claim(productId)` | `GET /v1/library`, `POST /v1/products/:id/claim` |
| `content` | `open(bookId)`: Entitlement check, then the Revision, Chapter access, available Layers and a loader for the Book's files | `POST /v1/books/:id/open`, `GET /v1/content/:token/*` |
| `checkout` | Quote and purchase Products, with idempotency keys | Stripe Checkout (Phase 4) |
| `support` | Tips, Creator Subscription plans, subscribe, cancel | Phase 4 |
| `layers` | Illustration Packs, Audio Tracks and Sync Maps for a Book; ratings | Phase 3 |
| `studio` | A Creator's Books, uploads, Revisions, ingest reports, publishing, packs, tracks, plans, earnings | `POST /v1/uploads`, `/v1/books/…` |
| `community` | Submissions, approvals, endorsements | Phase 5 |
| `moderation` | Reports, Flags, review queue, actions, action log | P2-MOD-01 |
| `events` | Change notifications (`entitlements`, `catalogue`, `studio`, …) so screens refresh | Sync pull, later push |

```ts
// packages/core/src/backend/backend.ts (sketch; finalised in P0-08)
export interface Backend {
  session: SessionApi;
  catalogue: CatalogueApi;
  library: LibraryApi;
  content: ContentApi;
  checkout: CheckoutApi;
  support: SupportApi;
  layers: LayersApi;
  studio: StudioApi;
  community: CommunityApi;
  moderation: ModerationApi;
  events: BackendEvents;
}

export interface LibraryApi {
  list(page?: PageRequest): Promise<Page<LibraryEntryDto>>; // { items, nextCursor }
  claim(productId: string, opts: { idempotencyKey: string }): Promise<EntitlementDto>;
}

export interface ContentApi {
  /** Checks Entitlements first; rejects with BackendError('ENTITLEMENT_REQUIRED'). */
  open(bookId: string): Promise<OpenBook>;
}

/** Codes are the §10.1 enum, so the UI handles local and remote failures the same way. */
export class BackendError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
  }
}
```

`OpenBook` carries the Book's details plus a **loader** for its files. Locally the loader reads blobs from `backend-local`'s database; over HTTP it fetches under the content-token path prefix (DESIGN.md §10.3) and refreshes the token. `reader-core` only ever sees the loader, so the engine never knows where content came from (ADR-001 fixes the loader's exact shape; see P0-04 criterion 10).

### 4.3 `backend-local`: the simulated backend

- **Its own IndexedDB database** (`book-backend-local`), separate from the user's `Stores`. The app cannot read "server" tables by accident, "Reset demo data" just wipes it, and it can be deleted when the real backend arrives.
- **Seed data** in `fixtures/seed/` as versioned JSON, validated with Zod on load: Personas, Creators, Books, Products, Bundles, plans, packs, tracks, ratings, Flags. Files (EPUBs, images, audio) are served from `apps/web/static/demo/`. Catalogue EPUBs are processed with `text-pipeline` in a Web Worker on first open (the same code the Phase 2 worker will run) and cached.
- **Personas** replace sign-in: Reader (default), Author (owns the demo serial), Illustrator (a community Creator) and Moderator. User-owned `Stores` data is kept per Persona (`book-reader:<userId>`), which rehearses Phase 2's per-account data and the "keep my notes" upload on first sign-in.
- **Simulation controls**, set from the dev panel: latency (a random 150–400 ms by default in owner builds, so loading states are visible; 0 in tests), failure rate, offline, payment outcome (succeed, decline, fail), AI-detector verdict, and a **clock** that can be moved forward to try renewals, period ends and early-access windows.
- **Authorisation is enforced inside it**, not just hidden in the UI: a Studio call from a non-Creator Persona rejects with `FORBIDDEN`, as the Phase 2 API must (DESIGN.md §10.6).
- **Inputs and outputs are validated** against the Zod schemas in dev builds, so drift from the contract shows up immediately.
- **Lazy-loaded.** `services.ts` imports it dynamically and the seed is fetched as JSON, not bundled, to protect the reader route's JavaScript budget (DESIGN.md §12.3).
- **Simulations never resolve OPEN items quietly.** Where a rule isn't decided (revenue splits OPEN-08, early-access Chapters OPEN-10, subscription rules OPEN-11, age policy OPEN-12), `backend-local` uses an obviously placeholder value from one config file, marked `// SIMULATION:`, and the PR lists it.

### 4.4 Shared business rules (`packages/domain`)

Pure, unit-tested functions that decide outcomes, imported by `backend-local` now and by `apps/api` in Phase 2: Entitlement checks and Bundle expansion; subscription windows; price arithmetic in integer minor units plus currency (Invariant 17); revenue split calculation; community policy and `community_ai` checks (Invariant 19); default Layer selection (DESIGN.md §8.1); Flag rules and thresholds (§10.6). `domain` imports only `core`. Keeping these out of `backend-local` is what makes the backend a plug-in rather than a rewrite: Phase 2 adds HTTP routes and Postgres repositories around rules that already work.

### 4.5 Contract tests: the plug-in guarantee

`packages/contract-tests` (dev-only) exports `describeStoresContract(makeStores)` and `describeBackendContract(makeBackend)`. They cover every method's success path, error codes, paging, idempotency, authorisation, and Invariants 6, 15, 17 and 19. Today they run against `storage-local` and `backend-local`. In Phase 2 the same suites run against `storage-remote` and `backend-http` pointed at the Docker API. When they pass, swapping the line in `services.ts` is safe.

### 4.6 Rules that keep the plug-in cheap

1. UI code never imports `backend-local` or `storage-local`; only `services.ts` does (ESLint enforces it).
2. Everything is async and anything can fail: every screen designs loading, empty, error and offline states from the start (§8).
3. The UI sees DTOs, never `backend-local`'s internal records.
4. Errors are codes from the §10.1 enum, mapped to UI copy in one place.
5. Lists are paged as `{ items, nextCursor }`, and money mutations take an idempotency key, even though local doesn't need either yet.
6. Decisions live in `domain`, not in `backend-local` and never in components.
7. Content is reached through the `OpenBook` loader, never by assuming blob URLs.
8. Time comes from an injected clock.
9. IDs are UUIDv7 generated on the device; user records carry `createdAt`, `updatedAt` and `deletedAt` (DESIGN.md §6.3).
10. Code review asks: "Would this still work if this call crossed a network?"

### 4.7 What is real and what is simulated

| Area | Real in the PoC | Simulated until Phase 2+ |
|---|---|---|
| Reading, typography, layout, Reading Progress | All of it | — |
| EPUB import and processing | `text-pipeline`, the same code as the future worker | Runs in a Web Worker, not a job queue |
| Annotations, Placed Bookmarks, Revisions, re-anchoring | All of it | Anchor migration runs on the device when a Book opens |
| Illustrations and narration | Rendering, all modes, sync, playback | Sync Maps are made on the owner's PC with `tools/align` |
| Accounts | Roles and permission checks | A Persona switcher instead of sign-in |
| Ownership | Entitlement, Bundle and subscription rules | Stored in the simulated backend's database in the browser |
| Payments | Prices, currencies, idempotency, failure handling | No card entry and no money moves; outcomes are set in the dev panel |
| Tips and Creator Subscriptions | Flows and benefit rules | Renewals follow the dev clock |
| Publishing | Ingest report, Revisions, publish, `stale` Sync Maps | Files stay in the browser, not object storage |
| Moderation | Flag rules, queue, actions, action log | AI detection and image moderation are stubs driven from the dev panel |
| Other people | — | Ratings, followers and other readers' purchases come from seed data |
| Notifications | An in-app inbox | No email or push |

### 4.8 Phase 2: how the backend plugs in

1. `apps/api` (stack per D-004, confirmed at the PoC review) implements each `Backend` module's routes on top of `packages/domain` and `packages/db`.
2. `packages/backend-http` implements `Backend` with `fetch` and the same Zod schemas, and passes the contract suite against the Docker API.
3. `packages/storage-remote` wraps `storage-local` with the outbox and pull (DESIGN.md §6.3) and passes the Stores contract suite.
4. `session` switches from Personas to the auth provider; Personas remain for development and tests only.
5. `services.ts` swaps the implementations.
6. First sign-in offers to upload the device's library and reader data.
7. `apps/worker` reuses `text-pipeline`, `alignment` and `migrateAnchors` as they are.
8. `backend-local` stays for E2E tests and offline demos, or is deleted.

### 4.9 Package map after this plan

```
packages/
  core/            types, Anchors, Zod schemas, Stores + Backend interfaces, error codes
  domain/          NEW  pure business rules (backend-local now, apps/api in Phase 2)
  contract-tests/  NEW  shared suites for any Stores or Backend implementation (dev only)
  storage-local/   Stores in IndexedDB
  backend-local/   NEW  Backend in the browser: own database, seed, simulation controls
  tokens/  ui/  text-pipeline/  reader-core/  alignment/      (per DESIGN.md §5.3)
tools/             align, resolve-anchors, images (dev-only CLIs)
fixtures/          test EPUBs, images, audio download script, seed/ (demo catalogue), LICENSES.md
```

Dependency direction (ESLint-enforced, DESIGN.md §5.3): `apps/*` → `packages/*` → `core`. `domain`, `text-pipeline`, `alignment` and `reader-core` import only `core`. `backend-local` imports `core`, `domain` and `text-pipeline`. `contract-tests` imports `core` and Vitest. Nothing imports from `apps/*`, and inside `apps/web` only `services.ts` may import `storage-local` or `backend-local`.

---

## 5. Product map

### 5.1 Navigation

| Window size (DESIGN.md §11.5) | App navigation |
|---|---|
| Compact (< 600 px) | Bottom navigation bar |
| Medium and expanded (≥ 600 px) | Navigation rail |

Destinations: **Library · Store · Studio** (Creator Personas only) **· You** (profile, purchases, subscriptions, Bookmark Designs, Settings, data; Admin for moderators; the dev panel in owner builds). The reader is full screen with no app navigation. `/` opens the Library. Feature flags hide Store, Studio, community and Admin in tester builds.

### 5.2 Screen inventory

| Screen | Route | Who | Skeleton in | Fully working in |
|---|---|---|---|---|
| Library (Continue reading, owned and imported Books, Import) | `/library` | Everyone | 1.1 | 1.2 |
| Reader | `/read/[bookId]` | Everyone | exists | 1.2–1.5 |
| Store home and search | `/store` | Everyone | 1.1 | 1.6 |
| Book page | `/book/[slug]` | Everyone | 1.1 | 1.6 |
| Community hub for a Book | `/book/[slug]/community` | Everyone | — | 1.8 |
| Creator profile | `/creator/[handle]` | Everyone | 1.1 | 1.6 (Tip, Subscribe), 1.8 (follow) |
| Checkout | sheet over the current page | Reader | — | 1.6 |
| You: profile, purchases, subscriptions, Bookmark Designs, data | `/you/…` | Everyone | 1.1 | 1.3 (data), 1.6 |
| Settings: appearance, reading defaults, accessibility | `/you/settings` | Everyone | 1.1 | 1.1–1.2 |
| Studio dashboard | `/studio` | Creators | 1.1 | 1.7 |
| Studio Book: details, Revisions, ingest report, publish, policy | `/studio/books/[bookId]` | Author | — | 1.7 |
| Pack builder (reader in Creator mode) | `/read/[bookId]?mode=creator&pack=[packId]` | Creators | — | 1.7 |
| Narration manager and review | `/studio/tracks/[trackId]` | Creators | — | 1.7 |
| Curation for an Author's Books | `/studio/books/[bookId]/community` | Author | — | 1.8 |
| Admin review queue and Flag detail | `/admin`, `/admin/flags/[flagId]` | Moderator | 1.1 | 1.8 |
| Dev panel | `/dev` | Owner builds | 0.1 | 0.1 |

---

## 6. Phases

Every task follows AGENTS.md: one task ID per branch, DESIGN.md §12.5 Definition of Done, no OPEN item resolved quietly. **Dependencies and acceptance criteria for each task are in DESIGN.md §13.** A phase is done when its tasks are done, its **Try it** list passes as Playwright specs in Chromium and WebKit, and the owner has tried it on desktop and on their Android phone. Then tick its status in §1.

### Phase 0.1 — Foundations

**Goal:** the plumbing every later phase relies on. There's little to look at, but it makes everything after cheaper and keeps the backend seam honest from day one.

| ID | Task | Size |
|---|---|---|
| P0-01 | Tooling and CI: import-boundary lint, Playwright (Chromium + WebKit), `test:e2e`, GitHub Actions | M |
| P0-02 | Align groundwork with DESIGN.md Appendix B: Anchors, renamed models, `ReaderPreferences`, UUIDv7, `deletedAt`, IndexedDB v2 | M |
| P0-03 | Capacitor shell for Android; device adapters with stubs; builds install on the owner's phone | M |
| P0-08 | Backend seam: `Backend` interface, `domain`, `contract-tests`, `backend-local` skeleton with Personas, seed loader, simulation controls and clock | L |
| P0-09 | Dev panel, feature flags and the `owner` / `tester` build profiles | M |

**Testing on your Android phone.** Two routes, both set up in P0-03:
- **Browser:** the dev server runs with `--host`, so the phone's browser opens it over your Wi-Fi. Windows may ask once to allow it through the firewall.
- **App:** with Developer options and USB debugging (or Wireless debugging) on the phone, and Android Studio on the PC (it brings the Android SDK and a JDK), `npx cap run android` installs the build. While the phone is connected, Claude can install builds and read logs over `adb`, and Chrome's `chrome://inspect` debugs the app's WebView.

**Try it**
- Open the dev server in your phone's browser.
- Open `/dev` and switch between the Reader, Author, Illustrator and Moderator Personas.
- Set latency high and failure rate to 50%; watch the (still bare) Library cope.
- Install the Capacitor build on your phone.

**Done (11 October 2026): what was built and how it differs from the plan.** All four Try-it items pass as Playwright specs (`apps/web/e2e/foundations.spec.ts`, `tester.spec.ts`) in Chromium and WebKit, and were checked on the owner's Android phone over adb (Capacitor app: Library from `backend-local`, dev panel, Persona switch; dev server in the phone's browser). Deviations:

- **One PR per phase, not per task** (owner decision, D-025). Each task still has its own commits, with the task ID in the message.
- **Backend modules arrive with their tasks.** §4.2 sketches all eleven modules "finalised in P0-08". P0-08 built `session`, `catalogue`, `library`, `studio.listBooks` (so role checks are real and contract-tested) and `events`. Each later task adds its module's methods, schemas (`backendContract` in `core/src/backend/contract.ts` makes TypeScript insist on both) and contract-suite cases: `content` (P1-APP-03), `checkout` (P1-STO-02), `support` (P1-STO-04), `layers` (P1-LAY-01), `community` (P1-COM-01), `moderation` (P1-APP-01). Designing them now would guess at screens that don't exist yet.
- **Two error codes added** to the §10.1 enum, which ends in "…": `NETWORK_ERROR` (offline or unreachable, raised client-side) and `SERVER_ERROR` (5xx). The dev panel's offline and failure-rate controls produce them.
- **The seed is one file**, `fixtures/seed/seed.json` with a `version`, not a set of files. It's fetched as a hashed asset (`?url`, never inlined) and validated for shape and for references between records. Split it when it grows.
- **The dev panel bypasses the simulation.** It uses `LocalBackendControls` (Persona list and switch, settings, clock, reset), so it still works at a 100% failure rate or offline. `controls.currentUserId()` is synchronous and never simulated, so `Stores` (`book-reader:<userId>`) opens even when the backend is "down", as a cached auth session would in Phase 2.
- **Tester builds** come from `npm run build:tester` (`vite build --mode tester`, which loads the committed `apps/web/.env.tester`) into `apps/web/build-tester/`. `VITE_FLAGS` can add simulated areas to a tester session for the PoC review; it can never enable the dev panel. Flagged-off routes answer 404 from the root layout.
- **E2E serves the built output** with a small static server (`apps/web/scripts/serve.mjs`, SPA fallback) rather than `vite preview`, so owner and tester builds run side by side (ports 4173 and 4174). Zero latency comes from a Playwright init script (`__BOOK_E2E_SIMULATION__`); the clock is fixed with `page.clock.setFixedTime`.
- **Tokens:** Appendix B's tokens row was split. P0-02 did the parts other code depends on (`--touch-target: 48px`, the `--font-ui` stack, font IDs, Reader Preferences mapping); generated M3 role tokens and self-hosted Nunito stay in P1-UI-01, as §13 already says. Until then, `medium` contrast looks like `standard`, and `high` uses the one hand-written high-contrast theme.
- **`ReadingProgress` and `LayerSelection` are keyed by `bookId`** (one per Book) and carry timestamps and `deletedAt` but no separate `id`.
- **Android tooling:** Capacitor 8 needs JDK 21. `scripts/android.mjs` (behind `npm run cap:android`) finds one (Android Studio keeps one in `~/.jdks`) plus the SDK and the phone, so nothing has to be added to PATH. The dev server binds `127.0.0.1` by default so `adb reverse` works over USB; `npm run dev:host` is the Wi-Fi route. The phone's browser must use `127.0.0.1`, not `localhost` (it resolves to IPv6).
- **Lint:** packages' `*.test.ts` files may import `@book/contract-tests`; nothing else may. A `web` Vitest project runs pure TypeScript tests in `apps/web` (Svelte component tests come with P1-UI-02).

### Phase 0.2 — De-risk the reader

**Goal:** answer the hard technical questions before building on them, and give the owner an early feel for the reading engine and synced narration. The spikes run in parallel (P0-05 follows P0-04).

| ID | Task | Size |
|---|---|---|
| P0-04 | Reader engine spike, foliate-js vs Readium ts-toolkit (OPEN-01), with a side-by-side page the owner scores for feel | L |
| P0-05 | Word-marking spike, spans vs offsets (OPEN-13) | M |
| P0-06 | Narration alignment spike, with a page that plays an aligned chapter with Word highlighting | M |
| P0-07 | Mobile capabilities spike on Android, including whether the OS can clear WebView storage | M |
| P0-10 | Component spike, `m3-svelte` vs Bits UI (OPEN-02) | S |
| P0-11 | Fixtures and demo content (D-023), with `fixtures/LICENSES.md` | M |

**Try it**
- On desktop and on your phone, open `/spike/reader`: switch engines, turn pages, change font size (does the same Word stay on screen?), select text, try spread and scroll. Say which one *feels* better; that goes into ADR-001.
- Open `/spike/narration` and listen to an aligned chapter while the Words highlight.

**Status (12 October 2026): built; waiting for the owner's checks.** Every spike is built and its ADR is drafted as *Proposed*: ADR-001 (foliate-js), ADR-002 (Block offsets), ADR-003 (whisper.cpp `base.en` with DTW, CPU hosting; coverage 0.99+), ADR-004 (draft) and ADR-005 (Bits UI). What only the owner can do is listed in the ADRs' "Still to do" sections and in the Phase 0.2 PR: score the engines' feel on desktop and phone, listen to `/spike/narration`, run `node scripts/spike-phone.ts` and the `/spike/mobile` checks with the phone unlocked, and do a TalkBack pass. New open question: **OPEN-14** (deterministic tokenisation), because Chromium and WebKit gave the same EPUB different WordIds. Deviations:

- **Spike code stays until the ADRs are accepted.** DESIGN.md §13.1 deletes it at the end of the phase, but the owner needs `/spike/*` (linked from the dev panel) to score and check. It is deleted, along with the losing libraries (`@readium/*`, `m3-svelte`, `vite-plugin-functions-mixins`), in the PR that accepts the ADRs.
- **ADRs are Proposed, not Accepted.** Accepting them is the owner's call (Phase 0 exit). DESIGN.md §16 and §17 note each proposal without resolving anything.
- **`packages/reader-core` exists from Phase 0.** Invariant 8 allows engine imports only there, so the spike adapters live in `reader-core/src/spike/`.
- **P0-05 was measured inside both engines**, using the spike's prepared documents rather than separate pages, so ADR-001 and ADR-002 share one set of runs.
- **P0-10 reverses the plan's starting recommendation.** ADR-005 recommends our own components on Bits UI over wrapping m3-svelte (accessibility, reduced motion, the build plugin, maintenance).
- **Fixtures (P0-11):** four Standard Ebooks filler titles, not five: *Through the Looking-Glass* was dropped (25 MB in the repo and the Android app); D-023 asks for 4–6. The 18 MB Standard Ebooks *Alice* reference is fetched by `npm run fixtures:download` with a SHA-256 check rather than committed. Tenniel's illustrations come from the Standard Ebooks edition, because Gutenberg #114's are small GIFs. Committed fixtures and demo files total about 18 MB (3.6 MB of it under `apps/web/static`, which ships in the app).
- **Android measurements are pending.** The phone was locked throughout, and Android freezes a locked app, so the WebView couldn't be driven. `scripts/spike-phone.ts` runs the full ADR-001 measurement in the app's WebView over adb once it's unlocked.
- **Safe areas:** the `--safe-*` tokens now prefer Capacitor 8's `--safe-area-inset-*`, because `env()` is wrong in Android WebView before 140 (ADR-004).
- **E2E:** measurement runs need `SPIKE_MEASURE=1`, and `E2E_PORT` moves the test servers so parallel checkouts don't reuse each other's.
- **Narration (P0-06):** the Sync Maps for chapters 1–2 use the spike's runtime WordIds (dumped from Chromium) until `text-pipeline` exists; P1-LAY-03 regenerates them from its word index. `packages/alignment` and the Sync Map schema in `core` are kept; `tools/align-spike/` grows into `tools/align`. The whisper transcripts are committed, so alignment can be redone without whisper. The playback `.m4a` files are generated by `npm run fixtures:narration` and gitignored. `scripts/serve.mjs` now serves byte ranges, which seeking audio needs.

**Sign-off (12 October 2026).** Before Phase 1 the owner accepted ADR-001 to ADR-005 as proposed, without the feel score and the phone checks, and chose an own deterministic tokeniser for OPEN-14 (D-026), an own Media3 audio plugin over the paid Capawesome one (D-027) and the Android Studio emulator for Phase 1 testing while the phone is busy (D-028). The spike code and the losing libraries were deleted at the start of Phase 1.1. The phone checks left in ADR-004 run on the emulator as each feature lands.

**Exit** (DESIGN.md's Phase 0 exit): ADR-001 to ADR-005 accepted; *Alice* readable on web and on your Android phone, with a font-size change keeping position; contract suites passing against `storage-local` and `backend-local`; CI green. Also: D-015 to D-018 and OPEN-01, OPEN-02 and OPEN-13 updated in DESIGN.md, and spike code deleted (DESIGN.md §13.1).

### Phase 1.1 — App shell and design system

**Goal:** a "walking skeleton": every area exists and can be clicked through with demo data, in the real design system, at every screen size. It tests the information architecture and the backend seam early, while the reader is being built.

| ID | Task | Size |
|---|---|---|
| P1-UI-01 | Theme generation and tokens from a seed colour, mode and contrast; self-hosted Nunito; placeholder seed | M |
| P1-UI-02 | Component set, built in the order screens need them | L |
| P1-UI-03 | App navigation (§5.1), responsive layout, Settings with theme customisation | M |
| P1-APP-01 | Skeleton screens backed by `backend-local`, with loading, empty, error and offline states | M |
| P1-APP-02 | State layer: `resource()` helper, refresh on `Backend.events`, error-code copy, snackbars | S |

**UX notes**
- The store skeleton uses real seed data (covers, prices, Creators), so density and proportions can be judged before buying works.
- Settings → Appearance: about 8 seed presets plus a custom colour, mode (system, light, dark), contrast (standard, medium, high), with a live preview of the app and a reading sample.
- No query library for now (TanStack Query can be reconsidered when `backend-http` arrives).

**Try it**
- Click through every area as each Persona, at desktop and phone sizes.
- Change the seed colour, mode and contrast; the whole app follows.
- Force slow, failing and offline states from the dev panel and judge how each screen copes.

**Done (12 October 2026): what was built and how it differs from the plan.** The Try-it list passes as Playwright specs in Chromium and WebKit (`e2e/app-shell.spec.ts`; components in `e2e/components.spec.ts`; axe in `e2e/accessibility.spec.ts`), and the Android build runs on the emulator (`book_phone`, API 36). Deviations:

- **Phase 0 exit came first.** The PR starts by accepting the ADRs and deleting the spike pages, `@readium/*`, `m3-svelte` and `vite-plugin-functions-mixins` (owner decision, see Phase 0.2).
- **Theme generation** (`packages/tokens/src/theme.ts`) also produces five highlight colours per scheme and the reader surface (`--reader-*`), where sepia lives. Tests check WCAG AA for every text role in every preset × mode × contrast and for several extreme custom seeds. A generated `default-theme.css` (snapshot-checked) paints before any script runs, and the user's theme is cached in localStorage so the next launch paints it straight away; Reader Preferences in `Stores` stay the source of truth. Placeholder seed `#00696B` with 8 presets.
- **Fonts:** Nunito *and* the five reading fonts are self-hosted already (Fontsource, SIL OFL), Latin and Latin Extended subsets only, to keep the app small.
- **Icons:** a generated subset of Material Symbols Rounded (Apache-2.0) as path data (`packages/ui/scripts/write-icons.mjs`), so only used icons ship.
- **Components:** beyond §11.4's list, `packages/ui` has Icon, Badge (with the "Simulated" label of plan §8), Skeleton and AdaptiveSheet (bottom sheet below 600 px, side sheet above). The snackbar is a queue service in the app (`lib/state/snackbar.svelte.ts`) plus a presentational `SnackbarHost`.
- **Component tests:** jsdom can't lay pages out, so focus trapping, floating menus and tooltips are tested in Playwright on a new owner-only **component gallery** (`/dev/components`). Reduced motion is checked twice: a static audit that all component CSS motion uses the `--duration-*` tokens, and a Playwright run under emulated reduced motion.
- **Backend:** `moderation.listQueue` arrived with P1-APP-01 as planned, plus `catalogue.listCreatorBooks` (not in the plan) for Creator profiles, and a `moderation` event topic. Seed v3 adds two demo Flags; `backend-local`'s database is v2.
- **New simulation control:** "Empty lists" empties every paged list, so empty states can be forced from the dev panel like loading, failure and offline (P1-APP-01 acceptance).
- **Routes:** an `(app)` route group holds the navigation shell; `/` redirects to `/library`; Admin and the dev panel are reached from You. The session (Persona and role) is cached on the device, so navigation still knows the role while the simulated backend is offline, as a signed-in app would.
- **Settings:** Appearance is complete. Reading defaults wait for the reader's own preferences UI (P1-RDR-04, phase 1.2), which will serve both places.
- **Accessibility:** axe runs on every route in light and dark from this phase (plan §9), not only in P1-QA-02.
- **Android (emulator):** its WebView is 133, below Chromium 140, so Capacitor pads the WebView instead of drawing edge to edge (ADR-004 check 1). Layout and insets are right, but the strips behind the system bars show the window background rather than the app's theme. P1-MOB-01 fixes that.

### Phase 1.2 — Read a book

**Goal:** a reader the owner would use every day.

| ID | Task | Size |
|---|---|---|
| P1-ING-01 | `text-pipeline`: validate, sanitise, mark Blocks, tokenise, WordIds and Ordinals, word index, manifest | L |
| P1-RDR-01 | Engine adapter implementing `ReaderEngine`; Anchor ↔ Locator mapping | L |
| P1-RDR-02 | Reader shell and navigation, TOC, scrubber, "back" | L |
| P1-RDR-03 | Layout modes including `auto`; page turns | M |
| P1-RDR-04 | Reader Preferences UI, per-Book overrides, live apply, pinch-to-zoom | M |
| P1-RDR-05 | Reading Progress: save, resume, furthest position | S |
| P1-RDR-08 | Styled block theming | M |
| P1-ING-02 | Import EPUB on web and Android, in a Web Worker with progress and an import report | M |
| P1-APP-03 | Opening Books: catalogue Books through `Backend.content`, imported Books from `Stores.library`, one Library list | M |

**UX notes**
- **Chrome.** Top bar: back to Library, Chapter title, TOC, Aa (preferences), Placed Bookmark toggle. Bottom bar: scrubber with Chapter ticks, "Page X of Y in this chapter", previous and next. The chrome fades after the first page turn and returns on a centre tap or Esc. The Illustrations button (1.4) and narration play button (1.5) get their places now, so the layout doesn't shift later.
- **Preferences** open as a half-height bottom sheet on compact screens, so the text visibly re-flows behind it, and as a side sheet on expanded screens. Tabs: Text, Page, Theme. A "This book only" switch turns changes into per-Book overrides, with "Reset to my defaults".
- **"Back"** after a jump appears as a chip for about 10 seconds, or until the next jump.
- **Keyboard and screen readers:** `?` opens the shortcuts sheet; page and Chapter changes are announced through a live region.
- **Import** shows progress, then a plain-language report: "Imported *Title*: 23 chapters, 98,000 words. 2 images have no alt text."
- *Alice* is granted to every Persona at seed (Entitlement source `grant`), so it's always in the Library.

**Try it**
- Open *Alice* from the Library. Read in single, spread and scroll. Change font, size, spacing, margins and theme mid-chapter; the same Word stays on screen.
- Jump with the TOC and the scrubber, then use "back".
- Open the status-window fixture in light, dark and sepia at 200% text size.
- Import an EPUB from your own collection, on desktop and on your phone; import the same file again (nothing happens); import a broken file (a readable reason).
- Close the app and reopen it: you're at the same Word.

**Done (12 October 2026): what was built and how it differs from the plan.** Every Try-it item is a Playwright spec in Chromium and WebKit (`apps/web/e2e/reader.spec.ts`, `import.spec.ts`, `styled-blocks.spec.ts`), plus the D-026 check that the browser's WordIds and processed files are byte-identical to Node's golden files. On Android it was checked on the API 36 emulator (WebView 133): Library, the system file picker, import, the reader, swipe page turns (ADR-004 check 3). The owner's phone wasn't used, and the `book_phone` emulator was busy with another app, so the run used the `book_compact` AVD (360 × 640 dp), which also caught the small-screen problems below. Deviations:

- **The engine adapter drives foliate-js's `<foliate-paginator>` directly**, not its `View`, and feeds it our processed Chapters as blob URLs. Relocations become Anchors in `reader-core`; foliate's CFIs never leave the adapter. Two foliate behaviours are corrected there, because they broke "the same Word stays on screen" (§9.1): its re-layout anchor is the start of the old visible range, which can be a space at the end of the previous column (the adapter makes the first Word's own range the anchor before a change, waits for layout to go quiet, then checks); and in scroll mode it treats a line starting exactly at the top edge as hidden. Overlapping changes (a slider dragged quickly) keep one pinned Word.
- **`ReaderEngine` grew a little** (DESIGN.md §9.1 updated): `relocated` says what moved it (`cause`: turn, navigation, link or scroll; the chrome fades on turns and scrolls only), new `tap`, `keydown`, `externalLink` and `pinch` events, `setPageTurn`, and a `ContentLoader` in `PublicationHandle`, so imported and catalogue Books load the same way.
- **Catalogue Books are processed in the browser by `backend-local`** with the same `text-pipeline` in the same Web Worker as imports (P1-APP-03), on first open, and cached in its own database (version 3: `content` and `revisions` stores; seed version 4 adds each Book's `epubUrl`). `Backend.content.open` checks the Entitlement and returns a content token valid for an hour (§10.3); `content.read(token, path)` serves files. **`content.read` is exempt from simulated latency and failures**: one open is dozens of reads, so a 20% failure rate there would break every Book rather than test anything. `content.open` is simulated as usual. §10.3 has the reader refresh a token before it expires; instead, a read refused for an expired token re-opens the Book once and retries, which needs no timer and also covers a device that slept past the hour.
- **Book files are stored as bytes plus a media type, not Blobs**, in both `Stores` and `backend-local`. Playwright's WebKit can't put Blobs in IndexedDB; bytes work everywhere. The APIs still hand out Blobs.
- **Imports** follow DESIGN.md §6.3: the Revision ID is the file's SHA-256 (the same file again says "Already in your library. Nothing changed."), the Book ID its `dc:identifier`. A *different* file with the same identifier is stored as a new Revision whose new WordIds continue from the old one's counter, but nothing is carried forward or re-anchored yet: that is P1-ING-03 (phase 1.3).
- **Styled blocks:** author colours are wrapped at ingest as `var(--book-text | --book-surface | --book-outline, <author colour>)`, and the reader defines those variables per theme, so the re-mapping still happens at render time (§9.6). **Monospace survives the reading font:** ingest keeps `!important` only on monospace `font-family` declarations (and strips it from others), and the reader's font override has no specificity (`:where`), so status windows keep their typewriter face and everything else takes the chosen font. Golden files were regenerated for this; WordIds didn't change.
- **Squeezed tables wrap instead of running off the page.** On a 360 px phone the stat table cut off its last column even at 100%. Cells now hyphenate, then break anywhere, once a table is narrower than its content. At 200% a four-column table wraps to a letter or two per line; a tap-to-open table viewer is backlog item RDR-01.
- **Chapter documents carry a Content-Security-Policy** (`default-src 'none'`, blob: images, styles and fonts only) as a second line of defence behind sanitising (Invariant 10).
- **TOC jumps go by Ordinal** (each TOC entry records the Ordinal it points at), not by fragment IDs, so a jump lands on the same Word in any layout.
- **"Page X of Y" is chapter-scoped** as §9.2 asks; on screen it is shortened to "Page 2 of 6" to fit a phone's bottom bar, and screen readers hear "in this chapter". Scroll mode shows the Book percentage instead.
- **Reading Progress is also saved on leaving the reader inside the app** (`beforeNavigate`), and the Library waits for that write, so "Continue reading" is right at once.
- **Per-Book theme overrides apply in the reader only**; the app's chrome keeps the global theme.
- **Settings → Reading defaults** now uses the reader's own Text and Page controls (one `ReadingControls` component), as the Phase 1.1 note promised. Theme stays under Appearance.
- **Places for later buttons:** the top bar's titles and the bottom bar's scrubber give way for the Placed Bookmark toggle (1.3), Illustrations (1.4) and Play (1.5); no inert placeholder buttons are shown.
- **Offline copy corrected:** errors said "Books you've opened still work", which isn't true of store Books (opening one needs the backend; offline downloads are Phase 6). It now says "Books you imported still work".
- **A preferences race fixed:** a change made before stored preferences finished loading was undone by the load. Changes now wait for it.
- **Dev panel test books:** "Import the status-window fixture" and the Rackham *Alice* import a fixture in one click, for the Try-it list and E2E.

### Phase 1.3 — Make it yours

| ID | Task | Size |
|---|---|---|
| P1-RDR-06 | Selection toolbar, Annotations, notes panel, export | L |
| P1-RDR-07 | Placed Bookmarks with the default Bookmark Design | S |
| P1-ING-03 | Re-import as a new Revision; WordId carry-forward; `migrateAnchors` as a pure function the Studio and the Phase 2 worker reuse | L |
| P1-APP-04 | Data safety: persistent storage request, export everything, delete device data | S |

**UX notes**
- The selection toolbar floats above the selection (below it if there's no room) and never covers it; on touch it sits clear of the native handles (per ADR-004). The 5 colour swatches have names for screen readers.
- The notes panel is a side sheet on expanded screens and a full-screen sheet on compact ones, with tabs "Notes and highlights" and "Bookmarks", grouped by Chapter, filterable by colour, and an "Orphaned" section showing each item's quoted text.
- Placed Bookmarks show as a ribbon on the page edge; `B` toggles one on the current page; the label is optional.

**Try it**
- Highlight in each colour, add a note, copy, remove a highlight; use right-click on desktop and long-press on your phone.
- Filter the notes panel, jump to a note, edit it, delete it.
- Place three bookmarks, change the font size, and check they're still on the right text.
- Export notes as Markdown and open the file.
- Re-import an edited copy of *Alice* (one paragraph changed, one deleted): notes elsewhere are untouched, and the note on deleted text shows as orphaned.

**Done (12 October 2026): what was built and how it differs from the plan.** Every Try-it item is a Playwright spec in Chromium and WebKit (`apps/web/e2e/annotations.spec.ts`, `reimport.spec.ts`, `data.spec.ts`). On the API 36 emulator (`book_compact`, 360 × 640 dp; `book_phone` was still busy) long-press selection, the toolbar, highlighting, export through the share sheet and You → Data were checked by hand, and ADR-004 checks 2 and 5 are recorded. Deviations:

- **One "Contents and notes" sheet** with three tabs, Contents, Notes and Bookmarks, instead of a separate notes panel with two. A phone's top bar has room for Back, the titles, Bookmark, one sheet button, Aa and (in 1.4) Illustrations, not for a Notes button as well. N opens the Notes tab. The tab says "Notes"; its heading for screen readers is "Notes and highlights".
- **Keyboard selection:** Shift+→/← select Words on the page from the first visible one, Tab moves into the toolbar (a WAI-ARIA toolbar: arrows, Home, End, Esc), and H highlights in the last colour used. Selection stays within the page on screen.
- **Mouse drags select through our own code**, not the browser's: in Chromium, on any page but a Chapter's first, a native drag inside foliate-js's scrolled view loses its starting point and leaves a caret. Double- and triple-click stay native; Shift+click extends.
- **Touch selections aren't re-set to snap them.** That removed Android's handles and menu (ADR-004 check 5). Long-press already selects whole Words, and the Anchor is always snapped (Invariant 5).
- **Right-click** on a selection or a highlight opens the same toolbar at the pointer rather than a separate menu list. Elsewhere the browser's own menu stays.
- **Toolbar placement:** above the selection for mouse and keyboard; on touch below it, clear of the handles, or docked at the bottom edge, never up where Android's menu is. On phones it's one row of 40 px buttons (48 px touch areas).
- **A note also underlines its highlight**, so notes can be seen on the page. Deleting a highlight or bookmark offers Undo; undo writes a new record, since a deletion is a tombstone (§6.3).
- **Bookmarks:** the toggle and B mark the first visible Word, or remove every bookmark on the page; "Page bookmarked" offers "Add label". The default Bookmark Design is a ribbon in the primary colour on the top edge; Bookmark Designs (1.6) restyle it.
- **Exports go through a new `files.saveFile`** platform capability: a download on the web, the Android share sheet in the app (`@capacitor/filesystem` 8.1.3 and `@capacitor/share` 8.0.2, MIT; a new ADR-004 row). Notes export as Markdown or plain text.
- **Carry-forward details (P1-ING-03):** matched runs shorter than three Words inside changed text don't keep their WordIds (a stray "the" would let a note "survive" in the wrong place); a diff with more than 1,000 edits treats the middle as rewritten; an unpaired Chapter (renamed or moved file) is matched to the unpaired old Chapter sharing at least half its vocabulary. Text moved between two Chapters that kept their files gets new WordIds, and its notes are re-found by quote. The manifest gains optional `previousRevisionId` and `deletedWordIds`; a first Revision's output is unchanged.
- **Migration details:** a range moves by WordIds only if both ends survive and still enclose about the same text; a one- or two-Word quote must match four Words of context, so a bookmark on "the" isn't moved to another "the". Migrated records are marked `migrated`; orphaned ones keep their old Anchor. It runs in the import worker, next to carry-forward. Catalogue Books get new Revisions only from the Studio, so migrating their readers' Anchors on next open comes with P1-STU-01 (1.7), reusing `migrateAnchors`.
- **The edited-copy test book** is Rackham's *Alice* (an import), made on the fly by the dev panel: the catalogue *Alice* can't be re-imported by a reader.
- **You → Data (P1-APP-04):** `Stores` gains `exportAll()` and `deleteAll()` (DESIGN.md §6.3). The JSON export has every record, soft-deleted ones included with `deletedAt`; Book files are listed, not included, since the EPUB can be imported again. "Delete my data on this device" clears the signed-in Persona's Stores only; store Entitlements are the backend's. Persistent storage is requested after the first highlight, bookmark or import. In the Android app the WebView never grants it but the data is the app's own (ADR-004 check 2), so the screen says "Kept with the app" there.
- **Fixes found on the way:** a click into the book made foliate-js jump to the Chapter's first page (it scrolls to whatever gains focus, here `<body>`); menus opened under sheets; and an imported Book whose `dc:identifier` is a URL gave a 404, so reader links now encode Book IDs.
- **Highlight colour names** (Yellow, Green, Blue, Pink, Purple) are in `@book/tokens` for screen readers, filters and exports.

### Phase 1.4 — Illustrations ★

| ID | Task | Size |
|---|---|---|
| P1-LAY-01 | Layer records and loader served by `Backend.layers`; `layerSelection` in Stores | M |
| P1-LAY-06 | Demo packs (Tenniel official, Rackham community) written as text quotes and resolved to Anchors by `tools/resolve-anchors`; WebP variants by `tools/images` | M |
| P1-LAY-02 | All four Illustration modes, current-Illustration rule, new-picture dot, first-use hint, lightbox | L |
| P1-LAY-07 | Layers menu in the reader: badges, AI labels, credits, enable, reorder, mode picker | S |

**UX notes**
- The picture button sits in the top-right corner of the page and **stays visible when the chrome hides**, because it's the showpiece. The dot appears when the current Illustration has changed since the last look.
- First-use hint: a one-off coach mark pointing at the button the first time a Book with Illustrations opens, gone for good once dismissed.
- The pop-up card closes on tap outside, the close button, Esc or swipe down. Swipe sideways between packs when several have a candidate.
- Per-page mode uses a left panel on medium and expanded screens; on compact, a strip above the text that collapses to a thumbnail.
- Crossfades are slow and gentle; instant under reduced motion.

**Try it**
- Open *Alice*: notice the hint, open the picture, close it, read on until the dot appears.
- Switch between pop-up, per-page, spread, in-text and off from the toolbar; your position stays put.
- Open the lightbox and zoom.
- Turn on the Rackham pack too, put it first, and swipe between packs.
- Jump far ahead with the scrubber, then back: nothing from ahead of you ever appears.

**Done (12 October 2026): what was built and how it differs from the plan.** Every Try-it item is a Playwright spec in Chromium and WebKit (`apps/web/e2e/illustrations.spec.ts`), with the never-ahead rule checked in each mode and after scrubber jumps, and the Layers contract cases in `@book/contract-tests`. Deviations:

- **`tools/resolve-anchors` and `tools/images` are one command**, `npm run layers` (`tools/src/build-packs.ts`, a new `@book/tools` workspace run with tsx; sharp 0.35.5 for images). It reads hand-checked pack sources in `fixtures/layers/*.source.json`, fails unless every quote occurs exactly once in the catalogue *Alice* and every picture has alt text, and writes `pack.json` (Anchors on the Revision `backend-local` makes) plus WebP variants under `apps/web/static/demo/layers/`. **That output isn't committed** (about 14 MB): `dev`, `build`, `build:tester` and `test` build it first when it's missing or older than its sources. `draft-pack-sources.ts` drafted the quotes from the captions and the Rackham edition's text; they were then checked by hand.
- **Variants never upscale:** the Tenniel scans are 1,184 px wide, so they get 640 and 1,184; Rackham's are smaller still. WebP quality 78 (lossless was twice the size on the engravings).
- **Rackham's alt text was written for this pack** from the pictures (Gutenberg's are titles or missing); Tenniel's is Standard Ebooks' (CC0). Placement: Tenniel inline; Rackham's colour plates full page, drawings inline. Early pictures (Chapters 1–2) are marked `spoilerSafe` for store pages in 1.6.
- **Seed version 5, backend database version 4:** Illustration Pack records with Products and grant Entitlements. Every Persona holds both packs except the Moderator, who lacks Rackham's, so the "can't turn on" path is tryable. Claiming or buying packs comes with the store (1.6).
- **`Backend.layers`** has `list(bookId)` (with `entitled` per pack) and `openPack(packId)`; images are read with `content.read` under a pack-scoped content token, so Layer files and Book files share one loader, as P1-LAY-01 says. A pack token reads only that pack's files.
- **Default selection** (every official pack held) and saved-selection clean-up (packs no longer held drop out) are rules in `@book/domain`. Nothing is written to `layerSelection` until the reader changes it.
- **The engine** gained `relayout(change)` (the per-page and spread panels resize the page; the first visible Word stays on screen) and re-paginates around `injectFigures`; figures carry their image size so pages don't shift while images load. DESIGN.md §9.1 updated. (Fixed during Phase 1.5: the figure CSS's `width: auto` overrode that size, so an image was 300 px wide until it decoded and could push the first visible Word off the page after the engine had checked it. Each figure's box is now set from its size before the image arrives.)
- **Mode switching keeps the first visible Word on screen**, as §9.1 requires; it can end up near the bottom of the new page, so several switches in a row drift back a little.
- **The mode picker is a radio list with a line about each mode** (five segments didn't fit the side sheet), in an Illustrations sheet opened from a top-bar button; I opens the picture (pop-up mode) or the sheet.
- **First-use hint** is a dismissible card under the picture button, shown in pop-up mode until "Got it" or the first look; it's remembered in Reader Preferences as `hintsSeen` (DESIGN.md §9.4), so it's per reader and syncs later.
- **The new-picture dot** compares with the picture last opened in this session (not stored).
- **Spread mode** shows the previous and current pictures side by side from 900 px wide when both are single-page; there's no double-page art in either pack yet, so `span: 'double'` is untested with real art.
- **A crossfade can show the outgoing picture for its 600 ms fade** after moving back past its Anchor; the current picture is always one at or before the last visible Word.
- **New `Overlay` component** in `@book/ui` (a modal without a title bar, card or full screen) for the pop-up card and the lightbox; `Switch` gained `hideLabel`.

### Phase 1.5 — Narration ★

| ID | Task | Size |
|---|---|---|
| P1-LAY-03 | `tools/align` CLI and Sync Maps for chapters 1–3 of *Alice* (whisper.cpp and ffmpeg on the owner's Windows PC) | M |
| P1-LAY-04 | Narration player: highlighting, auto-turn, tap-to-seek, speed, background playback through the `lib/platform` audio adapter | L |

**UX notes**
- The play button lives in the bottom bar. Once narration starts, a mini-player docks above it (play/pause, ±15 s, speed) and expands into full controls (previous and next sentence, highlight granularity, auto-turn).
- Audio never starts by itself (Invariant 11). The first time narration plays in a Book, a one-line hint says "Tap any word to move the narration there."
- If the reader turns pages by hand while narration plays, auto-turn pauses and a "Back to narration" chip appears; following resumes when they tap it or when the narration reaches what's on screen (DESIGN.md §8.3).
- Chapters without a Sync Map show the play button disabled with a reason: "Narration covers chapters 1–3".

**Try it**
- Play chapter 1; watch the highlight follow and the pages turn by themselves; switch to 1.5×.
- Tap a Word to jump the audio; page ahead by hand, then use "Back to narration".
- Lock your phone and keep listening; use the lock-screen controls.

**Done (12 October 2026): what was built and how it differs from the plan.** The Try-it items are Playwright specs in Chromium and WebKit (`apps/web/e2e/narration.spec.ts`), including the 100 ms acceptance check: the audio clock minus the Word's start when the highlight moves is p50 8 ms / p95 16 ms at 1× and p50 15 ms / p95 35 ms at 2× in Chromium, about the same in WebKit (audio output latency excluded, as in ADR-003). Background playback and the system media controls passed on the Android Studio emulator (ADR-004 check 4). Deviations:

- **`tools/align` is `npm run narration`** (`tools/src/align.ts` in `@book/tools`, beside `npm run layers`); the P0-06 spike script is deleted. Its Sync Maps now use `text-pipeline`'s Revision ID, Chapter IDs and WordIds for the catalogue *Alice*, and a root test (`tests/sync-maps.test.ts`) fails if those ever change. Coverage: 0.9958, 0.9925, 0.9947 for chapters 1–3. ADR-003 has the details.
- **An Audio Track is a Layer like a pack.** `Backend.layers.list` returns both kinds (packs first), and the new `openTrack(trackId)` gives each Chapter's Sync Map (read with `content.read` under a Layer-scoped token), its duration, coverage and status (`ready`, `needs_review` below 0.90, `stale` once the Book has a newer Revision, ready for P1-STU-03). The audio itself is a URL the platform player streams: in `backend-local` the static file (`// SIMULATION:`, readable by anyone who knows the path), in Phase 2 a signed URL that expires with the token (Invariant 16). Seed version 6, backend database version 5. Every Persona holds the narration except the Moderator, so the "you don't have it" path is tryable.
- **The `lib/platform` audio adapter plays a playlist**, a Chapter per item, so narration goes on to the next Chapter by itself, also in the background on Android. On the web it's one `<audio>` element with Media Session metadata and actions (play, pause, ±15 s, previous and next Chapter, seek).
- **Android: our own `Narration` plugin** (Kotlin, AndroidX Media3 1.11.1, Kotlin Gradle plugin 2.2.20) with a `mediaPlayback` foreground service and media session; the system controls have ±15 s buttons. It reports its position on every change and every 250 ms while playing, and the WebView extrapolates between reports, rather than polling every 50 ms as ADR-004 planned. The app's own audio is played from the APK's assets.
- **The play button** ("Listen to the narration", a headphones icon) sits in the bottom bar and becomes play/pause once narration has started. Where it can't play, it looks disabled but stays focusable and says why when pressed ("Narration covers chapters 1–3." or "You don't have the narration for this book yet."), with the same text as its accessible description: a disabled button couldn't give the reason.
- **The mini-player docks at the foot of the page and keeps its height free** (the text re-lays out above it, keeping place), lifting above the bottom bar when that shows. It has play/pause, ±15 s and a speed menu (0.5× to 3× in nine steps); "More narration controls" adds the position in the Chapter, previous and next sentence, highlighting (Word, Sentence, Off), "Turn pages with the narration", the track's credit and "Close player".
- **Play starts from the first Word on the page** (a quarter-second before it); from the top of a Chapter the recording's own introduction plays first. The narration position isn't stored separately: Reading Progress follows the narration, so the next play starts where the reader is.
- **Auto-turn** turns the page when the narrated Word is just past it and jumps when it's further. Turning pages by hand or jumping with the player open, playing or paused, stops following until the reader taps "Back to narration" or the narration reaches the page, so a paused player never pulls the reader back. When the narration moves to the next Chapter the reader turns to it as its recording starts, not only at its first Word.
- **Tap to seek works while narration plays**; while it's paused a tap keeps its usual meaning (a highlight's toolbar, the tap zones).
- **The hint shows once per reader, not once per Book** (`hintsSeen: 'narration'`): the gesture is the same in every Book. It goes after 8 s, on "Got it" or on the first tap to seek.
- **Sentences** come from the Chapter's Words by a rule in `@book/domain` (`sentenceSpans`); the engine gained `chapterText(chapterId)` for the Words' text (DESIGN.md §9.1, §8.3 updated). The narration highlight paints over the reader's own highlights.
- **Frames stop when a window is hidden**, so a 250 ms timer keeps the narrated Word and auto-turn current alongside the per-frame update.
- **E2E audio is silence**: the real `.m4a` files are generated on the owner's PC and not committed, so the specs serve a silent WAV of each Chapter's real length (with byte ranges); the Sync Maps are the real ones. For P1-QA-03: the tester build only has narration audio if the build machine runs `npm run narration` first (ffmpeg and the LibriVox download).
- **The lock screen itself is checked on the phone later**: the emulator image has no screen lock, and adding one would change its security settings. The notification the lock screen shows is the one checked in the notification shade.

### Phase 1.6 — Store and ownership (simulated)

**Goal:** the "Steam for books" experience end to end, with simulated payments.

| ID | Task | Size |
|---|---|---|
| P1-STO-01 | Catalogue and Book page: shelves, search, Illustration previews, narration sample, AI labels, ratings and warnings, "Read sample" | M |
| P1-STO-02 | Products, Entitlements and Bundles: "Add to library", simulated checkout, Complete edition, purchases; content and Layers gated by Entitlements | L |
| P1-STO-03 | Bookmark Designs shop; a default design and a design per Placed Bookmark | S |
| P1-STO-04 | Tips and Creator Subscriptions, with early-access Chapters of the demo serial and renewals on the dev clock | L |
| P1-STO-05 | AI labels everywhere; "Hide AI-generated content" setting | S |

**UX notes**
- On the Book page the primary button is the Complete edition ("Get the complete edition · £X.XX", or "Add to library" when free), with "Book only" as the secondary choice. The Layers section shows what's included, so the Bundle explains itself (DESIGN.md §18, "too many purchase choices").
- Checkout is a sheet over the current page, labelled **Simulated**, with no card fields. Success says "Added to your library", with "Read now".
- Locked content always explains itself: a locked early-access Chapter says whose it is, when it becomes free, and offers "Subscribe". Never a dead end.
- Tip and Subscribe live on Creator profiles and next to the author's name on Book pages.

**Try it** (as the Reader Persona)
- Browse and search the store; open a Book page; preview Illustrations (once phase 1.4 is done); play the narration sample; read a sample.
- Buy the Complete edition (simulated): Illustrations and narration are on when you open it. Buy another Book as "Book only": its Layers show as available to get.
- Set the payment outcome to "decline" in the dev panel and try again.
- Buy a Bookmark Design and use it in two Books.
- Tip the demo serial's author; subscribe; read an early-access Chapter; cancel; move the clock forward a month: the Chapter locks again but your purchases stay.
- Turn on "Hide AI-generated content".

### Phase 1.7 — Creator Studio (simulated)

**Goal:** the author's side: publish a Book, update it, give it Illustrations and narration, and set up support.

| ID | Task | Size |
|---|---|---|
| P1-STU-01 | Upload, ingest report, preview and publish; new Revisions with Anchor migration and `stale` Sync Maps | L |
| P1-STU-02 | Book settings: details, cover, price, rating and warnings, AI-use answer, community policy | M |
| P1-LAY-05 | Placement tool grown into the Studio pack builder (Creator mode in the reader) | L |
| P1-STU-03 | Narration manager: audio plus Sync Map per Chapter, coverage and status, review screen | M |
| P1-STU-04 | Subscription plans and a simulated earnings dashboard with placeholder revenue splits | M |

**UX notes**
- Studio dashboard: your Books (draft, processing, published), Flags and reports on them (1.8), earnings tiles (simulated), and suggested next steps ("Add illustrations to chapter 3").
- The ingest report is in plain language, with warnings grouped by severity and each linked to its place in the preview.
- Creator mode is the same reader with a visible "Creator mode" bar; the selection toolbar gains "Attach illustration"; selecting a placed Illustration shows its Anchor range. Images are re-encoded on the device to WebP, which strips EXIF data.
- Publishing is a deliberate step: "Publish revision" → a confirmation summarising what changed ("3 chapters changed; narration for chapter 2 needs re-alignment") → a "Published" snackbar.
- Stretch for P1-STU-03: align short Chapters in the browser with whisper.cpp's WebAssembly build instead of importing a Sync Map.

**Try it** (as the Author Persona)
- Upload an EPUB (a chapter of your own novel works; nothing leaves your device), read the report, preview, answer the AI question, publish.
- As the Reader, add it to your library and highlight something. As the Author, edit one paragraph and publish a new Revision. As the Reader, your highlight is still there.
- Attach three Illustrations in Creator mode and publish the pack; see them as the Reader.
- Import a Sync Map for a Chapter and step through its review screen.
- Create a subscription plan and find it on your Creator profile.

### Phase 1.8 — Community and moderation (simulated)

| ID | Task | Size |
|---|---|---|
| P1-COM-01 | Community submissions under each `community_policy` and `community_ai` setting | M |
| P1-COM-02 | Per-Book community hub and Creator profiles: rate, enable, endorse, follow | M |
| P1-ADM-01 | Flag rules in `domain`, a stub AI detector and the held-for-review state | M |
| P1-ADM-02 | Reports, admin review queue, actions and action log; author curation view | L |

**Try it**
- As the Illustrator, submit a pack for the demo serial (policy `approval`). As the Author, approve and endorse it. As the Reader, enable it, rate it, and see the endorsed badge.
- As the Author, set the serial to `closed`; the Illustrator can no longer submit.
- As the Reader, report a community pack. As the Moderator, work the queue: require relabelling, then approve.
- Set the AI detector to "suspect" in the dev panel, upload an unlabelled pack as the Illustrator, and see it held for review.
- Use the dev panel's bulk-upload helper as the Author and watch `upload_volume` fire.

### Phase 1.9 — Android build and PoC readiness

| ID | Task | Size |
|---|---|---|
| P1-MOB-01 | Android build of everything above; icons and splash screen; `docs/device-checklist.md` | M |
| P1-QA-01 | Performance pass against DESIGN.md §12.3 on your phone (with CPU throttling if it's much faster than the reference class) | M |
| P1-QA-02 | Accessibility pass: axe on every route, TalkBack and desktop screen-reader walkthroughs, keyboard map, reduced-motion audit | M |
| P1-QA-03 | Tester build (`tester` profile, first-run welcome), static web deploy, Android internal testing, `docs/poc-review.md` | M |

**Exit:** DESIGN.md's Phase 1 exit passes (automatically on web, by hand on your Android phone) and so does its simulated areas exit, for the phases kept in scope; then the owner runs the PoC review (DESIGN.md §13.3).

---

## 7. Dependencies and parallel tracks

```mermaid
flowchart LR
  P01["0.1 Foundations"] --> P02["0.2 De-risk the reader"]
  P01 --> P11["1.1 App shell and design system"]
  P02 --> P11
  P02 --> P12["1.2 Read a book"]
  P11 --> P12
  P12 --> P13["1.3 Make it yours"]

  subgraph Layers["Layers track"]
    P14["1.4 Illustrations ★"] --> P15["1.5 Narration ★"]
  end
  subgraph Platform["Platform track (simulated)"]
    P16["1.6 Store and ownership"] --> P17["1.7 Creator Studio"] --> P18["1.8 Community and moderation"]
  end

  P13 --> P14
  P13 --> P16
  P14 -. "Book page previews" .-> P16
  P14 -. "pack builder" .-> P17
  P15 -. "narration manager" .-> P17
  P15 --> P19["1.9 Android build and PoC readiness"]
  P18 --> P19
```

- **Within 0.1–0.2:** P0-03, P0-06, P0-10 and P0-11 can start as soon as P0-01 lands; P0-08 runs alongside the spikes.
- **Within 0.2–1.1:** the design-system work (P1-UI-01, P1-APP-02) needs no spike result except P0-10, so the app shell grows while the reader is being de-risked.
- **After 1.3:** the dotted links hold back single tasks, not whole phases. Phase 1.6 can start before 1.4; its Book pages show Illustration previews once 1.4 lands. Phase 1.7 can start before 1.4 and 1.5 too, but its pack builder (P1-LAY-05) waits for P1-LAY-02 and its narration manager (P1-STU-03) waits for P1-LAY-04.
- **If time runs short before the PoC review:** drop 1.8 first, then 1.7. Phases 0.1–1.5 and 1.9 are the PoC DESIGN.md requires; nothing in 1.9 depends on 1.6–1.8.

---

## 8. UX standards for every screen

1. **Five states, designed up front:** loading (skeletons appear only after about 300 ms, so fast responses don't flicker), empty (says what to do next, DESIGN.md §11.6), error (what happened, how to fix it, a retry), offline (what still works), and success.
2. **Local-first writes are instant.** Annotations, bookmarks, progress and preferences never wait on anything. Backend actions show a pending state on the control itself and confirm with a snackbar that keeps the action's name ("Add to library" → "Added to library").
3. **Simulated means labelled.** Checkout, Tips, subscriptions and earnings carry a visible "Simulated" marker, so neither the owner nor testers mistake them for real money.
4. **Responsive by window class**, checked at 360, 600, 840 and 1280 px wide: bottom sheets on compact screens, side sheets or dialogs on expanded ones; navigation bar vs rail; nothing depends on hover; safe-area insets respected.
5. **Calm reader, expressive app** (DESIGN.md §11.1): the reading surface stays quiet and its chrome fades; personality lives in the app layer and the Illustration panel.
6. **Accessibility floor** (DESIGN.md §11.7): 48 px targets, visible focus, full keyboard use, labelled controls, live-region announcements, reduced motion makes every transition instant.
7. **Copy** (DESIGN.md §11.6): sentence case, readers' words ("Narration", "Illustrations", "Bookmarks"), errors that explain without apologising.

---

## 9. Testing and quality

| Layer | From phase | Covers |
|---|---|---|
| Unit (Vitest) | 0.1 | `core`, `domain` rules, theme generation, `text-pipeline`, `alignment`, `reader-core` mapping |
| Contract | 0.1 | Every `Stores` and `Backend` implementation (local now, remote in Phase 2) |
| Golden files | 1.2 | Ingestion: fixture EPUB → XHTML, word index and manifest |
| Component (@testing-library/svelte) | 1.1 | `ui` components and reader components: keyboard, focus, reduced motion |
| End to end (Playwright, Chromium + WebKit) | 0.1 (smoke) | One spec per phase's Try-it list; DESIGN.md's Phase 1 exit flows. WebKit is also the only stand-in for iOS until the backlog item is picked up |
| Accessibility | 1.1 | axe on every route; TalkBack and a desktop screen reader walkthrough in 1.9 |
| Device | 0.1 | The owner's Android phone, per `docs/device-checklist.md` from 1.9; iPhone checks are in the backlog |

E2E tests run `backend-local` with zero latency, no injected failures and a fixed clock, plus dedicated specs that switch failures on to check the error states.

---

## 10. Risks specific to this plan

| Risk | Mitigation |
|---|---|
| Simulated areas take time from the core bet | The Platform track starts only after 1.3; each simulated task is a thin vertical slice (main path and main errors, no edge-case polish); 1.8 and then 1.7 can be dropped before the PoC review |
| The simulation drifts from what a real backend can do (instant cross-user effects, client-side secrets, unchecked permissions) | Contract tests; rules in `domain`; `backend-local` keeps its own database and enforces permissions; the "would this work over a network?" review question |
| Testers mistake simulated purchases for real ones | "Simulated" labels, no card fields, and the tester profile can hide the store entirely |
| Neither reader engine passes the spike | DESIGN.md's fallback (a minimal in-house CSS-columns paginator); 1.1 and the backend seam continue meanwhile |
| iOS problems surface late (D-024) | Playwright WebKit on every PR; feature code uses only `lib/platform` adapters; testers with iPhones use the web build in Safari during the PoC review; [BACKLOG.md](BACKLOG.md) lists what to verify |
| The owner's phone is faster than the reference device, hiding performance problems | Budgets are also checked with Chrome's CPU throttling (P1-QA-01) |
| Browser or WebView storage is cleared and testers lose notes | P1-APP-04 (persistent storage, export); P0-07 checks the WebView case |
| Demo content licensing | Public domain and CC0 sources only, each recorded in `fixtures/LICENSES.md` |
| Personas tangle user data | Stores data is kept per Persona and the app reloads on switch |

---

## 11. Keeping this plan and DESIGN.md in step

- DESIGN.md §13 defines tasks; this plan orders them. A new task gets its ID and acceptance criteria in DESIGN.md first, then a row here.
- When a phase is done, set its status in §1 and note anything learned that changes a later phase.
- Decisions go in DESIGN.md §16, never only here.
- Deferred work goes in [BACKLOG.md](BACKLOG.md) with the trigger that would bring it back.
