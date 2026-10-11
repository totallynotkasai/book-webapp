# Interactive Book Platform — Initial Design Plan

> Status: DRAFT v0.1 · Owner: Kasai · Intended location in repo: `docs/DESIGN.md`
> Working name: TBD (OPEN-07). Package scope placeholder: `@bp/*` — rename once a name is chosen.

---

## 0. How to use this document (agents read first)

This is the source of truth for architecture, terminology and build order. It is written to be executed by coding agents as well as read by humans.

**Before starting any task, an agent MUST:**

1. Read §2 Glossary and §3 Invariants. Use glossary terms exactly — in code, comments, DB columns and UI copy where applicable.
2. Locate the task by its ID (e.g. `P1-RDR-04`) in §13. Check its `Depends on` list is complete.
3. Check §15 for any `OPEN-xx` question the task touches. **Do not silently resolve an OPEN item.** Propose a resolution in the PR description and stop if the choice is irreversible (schema, public API, storage layout).

**While working:**

- Only work on tasks in the current phase unless explicitly told otherwise. Never build anything listed under §13.7 Parked.
- One task ID per branch/PR. Branch name: `p1-rdr-04-typography`. Reference the task ID in commit messages.
- If a task appears to conflict with an Invariant, stop and flag it. Invariants win.
- Do not add a dependency without stating why in the PR, and prefer libraries already listed in §4.
- If you change a decision, update §14 Decision log in the same PR.
- A task is done only when it meets §12 Definition of Done **and** its listed acceptance criteria.

---

## 1. Product summary

**One-line pitch:** "Steam for books" — a store, library and reader where a book can carry optional layers (narration, illustrations, cosmetics) made by the author or the community, all inside one reader with no extra setup.

**Problem:** People say books are hard to get into. Audio and pictures help, but pairing an audiobook with an ebook is a separate step that stops people starting.

**Core bet:** If narration and illustrations are already attached to the text, in the same reader, more people start and finish books.

**Primary users (launch):**

- *Readers* of web fiction and indie fantasy/LitRPG.
- *Authors* who own their rights (indie and web-serial authors). The owner's own LitRPG novel is the launch title.
- *Community creators* (illustrators, narrators) — from Phase 4 only.

**Monetisation model:** every purchasable thing (book, cover, bookmark design, illustration pack, audio track, bundle) is a Product with a price that may be zero. See §6.4.

**Platforms:** web app + iOS + Android, from one Svelte codebase.

**Product principles:**

1. Reduce friction first. Defaults must give a good experience with zero choices (e.g. a "Complete edition" bundle, official layers pre-selected).
2. The text is the spine. Everything attaches to the text, never to pages (§3, §6.1).
3. Authors control their books. Community content for a book exists only if the author allows it.
4. Accessible by default (WCAG 2.2 AA, keyboard, screen reader, reduced motion, dyslexia-friendly fonts).

---

## 2. Glossary (use these terms exactly)

| Term | Meaning |
|---|---|
| **Book** | A title on the platform. Has many Revisions. |
| **Revision** | An immutable, processed version of a Book's text. Exactly one is *current* (published) at a time. Serial authors publish new Revisions when they add or edit chapters. |
| **Chapter** | One spine item of a Revision (one XHTML document). Identified by `chapterId`. |
| **Word** | A word-like token produced by the tokeniser (§7.1). Punctuation and whitespace are not Words. |
| **WordId** | Integer ID for a Word, unique within a Book across all Revisions, never reused. Unchanged Words keep their WordId across Revisions. |
| **Anchor** | A position (`PointAnchor`) or range (`RangeAnchor`) in a Book's text, expressed with WordIds plus a text quote for recovery (§6.1). The *only* way anything attaches to text. |
| **Locator** | The reader engine's internal position format (e.g. Readium Locator). Only `reader-core` converts between Anchor and Locator. Locators are never persisted. |
| **Page** | An ephemeral, computed screenful for the current device and settings. Never stored. |
| **Layer** | An optional content overlay a reader can enable on a Book: an Illustration Pack or an Audio Track. |
| **Illustration Pack** | A set of Illustrations for one Book, made by one creator. |
| **Illustration** | An image attached to an Anchor with a placement (§8.3). |
| **Audio Track** | A set of audio for one Book. Kind is `narration` (Phase 2) or `ambient` (Parked). |
| **Sync Map** | Per-Chapter list of `[wordId, startMs, endMs]` linking a narration Audio Track to Words (§7.2). |
| **Official / Community** | Official = made or endorsed by the Book's author. Community = made by another Creator with author permission. |
| **Creator** | Any user who publishes Products. Authors are Creators. |
| **Product** | Anything that can be listed, priced (including free) and owned. |
| **Entitlement** | A record that a user owns a Product. The single source of truth for access. |
| **Bundle** | A Product that grants Entitlements to other Products (e.g. "Complete edition"). |
| **Bookmark Design** | A collectible cosmetic Product (the look of a bookmark). |
| **Placed Bookmark** | A user's saved position in a Book (a PointAnchor), drawn using one of their Bookmark Designs. Unlimited per user. |
| **Annotation** | A user's highlight, optionally with a note, on a RangeAnchor. |
| **Reading Progress** | A user's last position in a Book (a PointAnchor) plus progression %. |
| **Reader Preferences** | Typography, layout and theme settings (§9.4). |

Do not use "page" to mean a stored position. Do not use "bookmark" without qualifying it as Bookmark Design or Placed Bookmark.

---

## 3. Invariants (MUST / MUST NOT)

These are non-negotiable. Code that violates them will be rejected.

1. **No stored page numbers.** Pages are computed at render time. Persist Anchors and progression only.
2. **Everything attached to text uses `Anchor`** (Annotations, Placed Bookmarks, Reading Progress, Illustrations, Sync Maps, future glossary entries). No raw character offsets, CFIs or Locators in the database.
3. **WordIds are immutable and never reused** within a Book. New Words get new IDs from the Book's counter.
4. **Selections snap to whole Words.** A RangeAnchor always starts and ends on a Word boundary.
5. **All access checks go through the Entitlements module** (`apps/api/src/modules/entitlements`). No other code decides ownership. Free Products still require an Entitlement (created by "Add to library").
6. **Paid or gated content is never publicly readable.** Content is served only through short-lived content access tokens (§10.3).
7. **Money is integer minor units + ISO 4217 currency code.** Never floats.
8. **Shared types and schemas live in `packages/contracts`.** API and clients import from there; never duplicate a DTO.
9. **App code never imports the reader engine directly.** Only `packages/reader-core` adapters may import Readium/foliate-js.
10. **Uploaded content is untrusted.** EPUB scripts are stripped, CSS is allowlisted, images are re-encoded, audio is transcoded (§10).
11. **Community content requires the author's policy to allow it** (§6.5). Never list a community Product for a Book whose policy is `closed`.
12. **Clients never connect to Postgres directly.** All data access goes through `apps/api`.
13. **Svelte 5 runes only** (`$state`, `$derived`, `$effect`, `$props`) in new components. Shared reactive state lives in `.svelte.ts` modules.
14. **TypeScript strict mode everywhere.** No `any` without an explaining comment.
15. **Respect `prefers-reduced-motion`** in every animation, including page turns.

---

## 4. Architecture overview

### 4.1 System diagram

```
┌──────────────────────────┐      ┌───────────────────────────────┐
│ apps/app (SvelteKit SPA) │      │ same build inside Capacitor   │
│ web, served from CDN     │      │ iOS / Android shells          │
└────────────┬─────────────┘      └───────────────┬───────────────┘
             │  HTTPS JSON, Bearer JWT            │
             ▼                                    ▼
      ┌─────────────────────────────────────────────────┐
      │ apps/api  (Hono on Node, TypeScript)            │──► Supabase Auth (JWT issue/verify)
      │ catalogue, entitlements, annotations, progress, │──► Postgres (Drizzle ORM)
      │ uploads, content access tokens, (later) Stripe  │
      └───────────────┬─────────────────────────────────┘
                      │ enqueue jobs (pg-boss, Postgres-backed)
                      ▼
      ┌──────────────────────────────┐        ┌───────────────────────────┐
      │ apps/worker (Node, TS)       │──────► │ Object storage (R2; MinIO │
      │ EPUB ingest, image variants, │        │ locally) + CDN            │
      │ ffmpeg, whisper.cpp, align   │        └─────────────▲─────────────┘
      └──────────────────────────────┘                      │
                                     reader fetches content via /v1/content/{token}/…
```

### 4.2 Stack decisions

TypeScript and Svelte wherever possible. Exceptions are listed explicitly and are wrapped by TS code.

| Concern | Choice | Notes |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | |
| Language | TypeScript (strict) | |
| UI framework | Svelte 5 + SvelteKit | Built as SPA (`adapter-static`, `fallback: 'index.html'`, `ssr = false`) so one build runs on web and in Capacitor. SSR store pages come in Phase 5. |
| Mobile | Capacitor (iOS + Android) | Wraps the SPA build. Native plugins only where web APIs fail (background audio, deep links, filesystem). |
| Reader engine | Readium ts-toolkit (`@readium/navigator`, `@readium/shared`) **or** foliate-js | Decided by spike P0-05 (OPEN-01). Always behind the `ReaderEngine` interface (§9.1). |
| API | Hono on Node + Zod validation | Runs as a standard container. |
| Database | Postgres + Drizzle ORM + drizzle-kit migrations | Hosted on Supabase (or any Postgres). |
| Auth | Supabase Auth (email magic link, Google, Apple) | API verifies Supabase JWTs. Check App Store login rules when choosing providers. |
| Jobs | pg-boss | Postgres-backed queue; no Redis needed. |
| Object storage | Cloudflare R2 (prod), MinIO (local) | S3-compatible API via `@aws-sdk/client-s3`. No egress fees for audio streaming. |
| Images | sharp | Variants + EXIF stripping. |
| Audio | ffmpeg (binary) | **Exception:** non-TS binary, called from the worker. |
| Speech alignment | whisper.cpp (binary) for word timestamps; alignment logic in TS | **Exception:** non-TS binary. |
| EPUB validation | epubcheck (Java) | **Exception:** non-TS. Optional in Phase 1 (report-only). |
| Payments (Phase 3+) | Stripe Checkout; Stripe Connect for creator payouts | Merchant-of-record question is OPEN-04. |
| Design system | Material 3 tokens via `@material/material-color-utilities`, own Svelte components | OPEN-02: evaluate `m3-svelte` before building from scratch. |
| Icons | Material Symbols (self-hosted subset) | |
| Testing | Vitest, @testing-library/svelte, Playwright (chromium + webkit) | WebKit matters: iOS Capacitor runs WKWebView. |
| Lint/format | ESLint (+ eslint-plugin-svelte), Prettier (+ prettier-plugin-svelte), svelte-check | |
| Errors/monitoring | Sentry (web, Capacitor, API, worker) | |

---

## 5. Repository structure

```
/
├─ AGENTS.md                    # short pointer to this doc + commands (Appendix A)
├─ docs/
│  ├─ DESIGN.md                 # this file
│  └─ adr/                      # ADR-001-reader-engine.md, etc.
├─ apps/
│  ├─ app/                      # SvelteKit SPA (web) + Capacitor config
│  │  ├─ src/
│  │  │  ├─ routes/             # (store)/, (library)/, read/[bookId]/, creator/, settings/
│  │  │  ├─ lib/
│  │  │  │  ├─ api/             # typed API client (uses @bp/contracts)
│  │  │  │  ├─ state/           # *.svelte.ts shared state (session, prefs, library)
│  │  │  │  └─ platform/        # web vs capacitor adapters (audio, storage, share)
│  │  ├─ ios/  android/         # generated by Capacitor
│  │  └─ capacitor.config.ts
│  ├─ api/                      # Hono API
│  │  └─ src/
│  │     ├─ modules/            # one folder per domain: books, revisions, entitlements,
│  │     │                      # annotations, progress, uploads, content, packs, tracks
│  │     ├─ middleware/         # auth, rate limit, error handler
│  │     └─ index.ts
│  └─ worker/                   # pg-boss job handlers
│     └─ src/jobs/              # ingest-epub, process-image, transcode-audio,
│                               # align-narration, migrate-anchors
├─ packages/
│  ├─ contracts/                # Zod schemas + inferred TS types (Anchor, DTOs, errors)
│  ├─ db/                       # Drizzle schema, migrations, seed
│  ├─ text-pipeline/            # EPUB parse/sanitise, tokenise, WordId assignment,
│  │                            # revision diff, manifest generation (pure TS, tested)
│  ├─ alignment/                # transcript ↔ WordId alignment, Sync Map format (pure TS)
│  ├─ reader-core/              # ReaderEngine interface, engine adapters, Anchor↔Locator,
│  │                            # layer orchestration (framework-agnostic TS)
│  ├─ reader-svelte/            # reader UI components (toolbar, scrubber, panels, menus)
│  ├─ ui/                       # design tokens, theme generation, Svelte components
│  └─ config/                   # shared tsconfig, eslint, prettier presets
├─ fixtures/                    # test EPUBs, audio clips, images (see P0-05)
├─ docker-compose.yml           # postgres, minio
└─ turbo.json, pnpm-workspace.yaml, package.json
```

Dependency direction (enforce with ESLint import rules):
`apps/*` → `packages/*`. `packages/reader-svelte` → `reader-core`, `ui`, `contracts`. `reader-core` → `contracts` only. `text-pipeline` and `alignment` → `contracts` only. No package imports from `apps/*`.

---

## 6. Core domain model

### 6.1 Anchors

Defined in `packages/contracts/src/anchor.ts`:

```ts
/** Unique within a Book across all Revisions. Never reused. */
export type WordId = number;

/** Recovery context. prefix/suffix are up to 32 characters of surrounding text. */
export interface TextQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface PointAnchor {
  kind: 'point';
  bookId: string;
  revisionId: string; // Revision this anchor was created on or last migrated to
  wordId: WordId;
  quote: TextQuote;   // exact = the word itself
}

export interface RangeAnchor {
  kind: 'range';
  bookId: string;
  revisionId: string;
  startWordId: WordId;
  endWordId: WordId;  // inclusive
  quote: TextQuote;
}

export type Anchor = PointAnchor | RangeAnchor;

export type AnchorStatus = 'ok' | 'migrated' | 'orphaned';
```

Every table that stores an Anchor stores it as typed columns (`revision_id`, `start_word_id`, `end_word_id`, `quote_exact`, `quote_prefix`, `quote_suffix`, `anchor_status`), not as opaque JSON, so migrations and queries stay cheap.

### 6.2 Revisions, WordId carry-forward and re-anchoring

Serial authors edit and append constantly, so anchors must survive new Revisions.

**WordId assignment (in `text-pipeline`):**

1. First Revision: tokenise (§7.1) and assign WordIds sequentially from 1. Store `books.next_word_id`.
2. New Revision: tokenise the new text, then run a token-level diff (Myers) against the previous Revision's normalised token sequence, chapter by chapter with a whole-book fallback for moved chapters.
   - Unchanged tokens inherit their old WordId.
   - Inserted tokens get new IDs from `books.next_word_id`.
   - Deleted WordIds are recorded in `revision_deleted_words` for the new Revision.

**Re-anchoring job (`migrate-anchors`, runs when a Revision is published):**

For every Anchor on the previous Revision:

1. If all referenced WordIds still exist → set `revision_id` to the new Revision, refresh `quote`, status `migrated`.
2. Else search the new Revision for `quote` (exact, then fuzzy, limited to the same Chapter first) → if found, rewrite WordIds, status `migrated`.
3. Else status `orphaned`, keep the old data, and notify the owner (reader for Annotations/Placed Bookmarks; creator for Illustrations). Reading Progress falls back to the nearest surviving Word before it.

Narration Sync Maps for changed Chapters are marked `stale` and re-alignment is enqueued (§7.2).

### 6.3 Database tables

Phase column = phase in which the table is first needed. Create tables only when their phase starts, but **reserve the columns listed here** so later phases don't need disruptive migrations.

| Table | Purpose | Phase |
|---|---|---|
| `users` | Profile linked to Supabase Auth user ID | 1 |
| `creators` | Creator profile (display name, bio, payout status) | 1 |
| `books` | Title, slug, author `creator_id`, `current_revision_id`, `next_word_id`, `community_policy` | 1 |
| `book_revisions` | `revision_no`, status (`processing` / `ready` / `published` / `failed`), manifest key, word count, ingest report | 1 |
| `chapters` | Per Revision: `spine_index`, `href`, `title`, `first_word_id`, `last_word_id` | 1 |
| `revision_deleted_words` | WordIds removed in a Revision | 1 |
| `products` | `kind`, `ref_id`, `book_id`, `creator_id`, `is_official`, `price_minor`, `currency`, `status`, `revenue_split` | 1 |
| `bundle_items` | Bundle → Product membership | 3 |
| `entitlements` | `user_id`, `product_id`, `source`, `order_id`, `parent_entitlement_id`, `granted_at`, `revoked_at` | 1 |
| `annotations` | Highlight colour, optional note text, Anchor columns, `deleted_at` | 1 |
| `placed_bookmarks` | PointAnchor columns, `bookmark_design_product_id`, optional label | 1 |
| `reading_progress` | PointAnchor columns, `progression`, `device_id`, `updated_at`, `furthest_progression` | 1 |
| `reader_preferences` | `user_id`, nullable `book_id` (per-book override), `prefs` JSON validated by Zod | 1 |
| `assets` | Storage key, MIME, bytes, sha256, dimensions/duration, `moderation_state` | 1 |
| `uploads` | Presigned upload tracking and processing status | 1 |
| `illustration_packs` | `book_id`, `creator_id`, `is_official`, `status`, `approval_state` | 2 |
| `illustrations` | `pack_id`, `asset_id`, Anchor columns, `placement`, `alt_text` (required), `caption` | 2 |
| `audio_tracks` | `book_id`, `creator_id`, `kind`, `is_official`, `status`, `approval_state`, narrator credit | 2 |
| `audio_files` | `track_id`, `chapter_id`, `asset_id`, `duration_ms` | 2 |
| `sync_maps` | `track_id`, `revision_id`, `chapter_id`, storage key, `coverage`, `status` (`ready` / `stale` / `needs_review`) | 2 |
| `user_layer_selection` | `user_id`, `book_id`, ordered `illustration_pack_ids`, `narration_track_id` | 2 |
| `orders`, `order_items`, `payments`, `refunds` | Commerce | 3 |
| `payout_accounts`, `payout_ledger` | Creator earnings and Stripe Connect state | 4 |
| `moderation_reports`, `moderation_actions` | Community safety | 4 |
| `reviews`, `wishlists`, `achievements` | Steam layer | 5 |

IDs: UUIDv7 (time-sortable) for all rows. Timestamps: `timestamptz`, UTC.

### 6.4 Products and Entitlements

```ts
export type ProductKind =
  | 'book' | 'illustration_pack' | 'audio_track'
  | 'cover' | 'bookmark_design' | 'bundle';

export type EntitlementSource = 'free_claim' | 'purchase' | 'bundle' | 'grant';
```

Rules:

- Every Book, Illustration Pack, Audio Track, Cover and Bookmark Design has exactly one Product row (more later if we add regional pricing).
- `price_minor = 0` means free. Free Products are claimed with "Add to library", which creates an Entitlement (`source: 'free_claim'`). This keeps the library and access checks uniform (Invariant 5).
- Buying a Bundle creates one parent Entitlement and child Entitlements (`source: 'bundle'`, `parent_entitlement_id` set). Refunding the Bundle revokes the children.
- Every user automatically owns one default Bookmark Design (granted at sign-up).
- `revenue_split` is stored per Product at listing time as basis points: `{ platformBps, authorBps, creatorBps }` summing to 10000. It is copied onto order items at purchase so later changes don't rewrite history.
- The API exposes one function for access: `entitlements.check(userId, productId): Promise<boolean>` and a batch variant. Content access tokens (§10.3) are only issued after this check.

### 6.5 Community content policy (fields now, behaviour in Phase 4)

`books.community_policy`:

- `closed` — no community Layers can be submitted. **Default.**
- `approval` — submissions need explicit author approval before listing.
- `open` — submissions list automatically, subject to moderation; the author can delist.

Official content: `is_official = true` is only settable by the Book's author, or on a community Product the author has endorsed.

### 6.6 Object storage layout

```
uploads/tmp/{uploadId}                                        # raw uploads, deleted after processing
books/{bookId}/rev/{revisionId}/manifest.json                 # engine manifest (format per ADR-001)
books/{bookId}/rev/{revisionId}/content/{chapterHref}         # sanitised XHTML with word spans
books/{bookId}/rev/{revisionId}/index/{chapterId}.words.json  # [[wordId, text], …]
books/{bookId}/rev/{revisionId}/res/{path}                    # images, CSS, fonts from the EPUB
packs/{packId}/img/{assetId}/{w640|w1280|w2048}.webp
tracks/{trackId}/audio/{chapterId}.m4a
tracks/{trackId}/sync/{revisionId}/{chapterId}.json
cosmetics/{productId}/{file}
```

Revision folders are immutable once written. Never overwrite; write a new Revision.

---

## 7. Content pipelines (apps/worker)

### 7.1 EPUB ingestion — job `ingest-epub`

Phase 1 accepts EPUB only (authors can export EPUB from Vellum, Atticus, Scrivener, Calibre, etc.). DOCX/Markdown import is a Phase 2 stretch task (Pandoc — non-TS exception).

1. **Upload:** client requests a presigned PUT URL from the API (`POST /v1/uploads`), uploads to `uploads/tmp/`, then calls `POST /v1/books/{bookId}/revisions` with the upload ID.
2. **Validate:** ZIP structure, `mimetype`, `META-INF/container.xml`, OPF parse. Fatal parse failures → Revision `failed` with a readable reason. Run epubcheck if available and attach its output to the ingest report (non-blocking in Phase 1).
3. **Sanitise:**
   - Remove `<script>`, `<iframe>`, `<object>`, `<embed>`, forms, event-handler attributes and `javascript:` URLs.
   - Remove external resource references (only resources inside the EPUB are allowed).
   - Filter CSS to an allowlist of properties (typography, colour, borders, spacing, tables, lists). Colours in author CSS are kept but must be overridable by the reader theme (see §9.6).
4. **Tokenise:** walk text nodes in reading order; segment with `Intl.Segmenter(lang, { granularity: 'word' })`; for each segment where `isWordLike` is true, wrap in `<span data-w="{wordId}">`. Never split or wrap across existing element boundaries. Use the Book's `lang` from the OPF.
5. **Assign WordIds** (§6.2) — sequential for the first Revision, diff-based thereafter.
6. **Emit:** sanitised XHTML, per-Chapter word index files, the engine manifest (format chosen in ADR-001), TOC, and `chapters` rows with first/last WordId.
7. **Report:** word count, chapter count, warnings (unsupported CSS removed, missing alt text on images, etc.). The author sees this before publishing.
8. **Publish** (separate API action): sets `books.current_revision_id`, status `published`, enqueues `migrate-anchors` and narration re-alignment for changed Chapters.

`text-pipeline` must be pure, deterministic and unit-tested: the same input EPUB produces byte-identical output.

### 7.2 Narration alignment — job `align-narration`

Input: one audio file per Chapter (Phase 2). Single-file-with-chapter-markers is a later enhancement.

1. **Transcode** with ffmpeg to AAC in `.m4a`, mono, ~64 kbps, loudness-normalised (target −18 LUFS integrated; configurable).
2. **Transcribe** with whisper.cpp, producing word-level timestamps (JSON output).
3. **Normalise** both sides: lowercase, strip punctuation, expand numbers both ways ("42" ↔ "forty-two"), collapse hyphenation and contractions.
4. **Align** transcript tokens to the Chapter's word index with a global sequence alignment (Needleman–Wunsch on normalised tokens, fuzzy match by edit distance).
5. **Fill gaps:** Words with no matched audio get interpolated times between their matched neighbours and an `interpolated` flag.
6. **Score:** `coverage = matched / total`. If coverage < 0.90 (configurable), status `needs_review`; the creator gets a review screen that jumps to low-confidence regions.
7. **Write** the Sync Map:

```json
{
  "version": 1,
  "trackId": "…",
  "revisionId": "…",
  "chapterId": "…",
  "audioKey": "tracks/…/audio/ch03.m4a",
  "durationMs": 1834000,
  "coverage": 0.97,
  "words": [[1201, 0, 320, 0], [1202, 320, 610, 0], [1203, 610, 900, 1]]
}
```

`words` entries are `[wordId, startMs, endMs, flags]`, sorted by `startMs`; `flags & 1` = interpolated.

Reference implementation worth reading before building: the open-source Storyteller project (MIT), which aligns ebooks with audiobooks using whisper.cpp + ffmpeg + Readium.

### 7.3 Image processing — job `process-image`

Accept JPEG, PNG, WebP, AVIF up to 25 MB. Decode and re-encode with sharp (this strips EXIF and embedded payloads). Generate WebP variants at 640, 1280 and 2048 px on the long edge. Record dimensions and a dominant colour (for loading placeholders). `alt_text` is required before an Illustration can be published.

---

## 8. Layers

### 8.1 Layer selection

Per user, per Book (`user_layer_selection`):

- Zero or more Illustration Packs, ordered. If two packs anchor to the same block, show both, in the user's pack order.
- At most one narration Audio Track active at a time.
- Default on first open: all *official* Layers the user is entitled to are enabled. This is the zero-choice path (Product principle 1).

Only Layers the user holds Entitlements for can be enabled.

### 8.2 Narration playback

- Audio drives position. The current Word is highlighted through an engine decoration (`group: 'narration'`), at word or sentence granularity (preference).
- When the highlighted Word leaves the visible range, the reader turns the page automatically (preference, default on).
- Tapping or clicking a Word while narration is active seeks to that Word's `startMs`.
- Controls: play/pause, ±15 s, previous/next sentence, playback rate 0.5×–3×, sleep timer (Phase 5).
- Lookup from time to Word uses binary search on the Sync Map; lookup from Word to time uses a `Map<WordId, index>` built on load.
- Mobile: background playback and lock-screen/Media Session controls are required (validated in spike P0-08).
- Playing narration updates Reading Progress the same way manual reading does.

### 8.3 Illustration placement

`illustrations.placement`:

- `inline` (default): a `<figure>` is injected after the block element that contains the Anchor's end Word. Pagination recalculates around it.
- `full_page`: injected with a forced page break before and after; the image is scaled to fit the page.
- `rail`: not injected into the text. Shown in a side panel (desktop) or a peek sheet (mobile) whenever its Anchor is in the visible range.

Injection happens at render time through `ReaderEngine.injectFigures()`. Illustrations are **never** baked into Revision content, because Layers are per user.

Tapping an Illustration opens a lightbox with pinch/scroll zoom. This is where "zoom" lives; text size is handled by Reader Preferences.

### 8.4 Ambient audio (Parked)

Ambient tracks and sound-effect cues are Parked (§13.7). A silent reader's position can't be known precisely, so cues could only trigger when an Anchor becomes visible. Booktrack shipped this idea with community-made soundtracks and retired its ebook platform in 2019. Revisit only with evidence of demand.

---

## 9. Reader architecture

### 9.1 ReaderEngine interface (`packages/reader-core`)

App code talks only to this interface. Each engine (Readium, foliate-js) gets an adapter.

```ts
export type LayoutMode = 'paginated-single' | 'paginated-spread' | 'scroll';

export interface VisibleRange {
  chapterId: string;
  firstWordId: WordId;
  lastWordId: WordId;
  progression: number;                          // 0..1 across the whole Book
  pageInChapter?: { index: number; count: number }; // display only, never stored
}

export interface Decoration {
  id: string;
  anchor: RangeAnchor;
  style: 'highlight' | 'underline' | 'narration' | 'search';
  color?: string; // token name, not a raw hex
}

export interface FigureInjection {
  id: string;
  anchor: Anchor;
  placement: 'inline' | 'full_page';
  src: string;        // signed/content-token URL
  srcset?: string;
  alt: string;
  caption?: string;
}

export interface EngineEvents {
  relocated: VisibleRange;
  selection: { anchor: RangeAnchor; clientRect: DOMRect } | null;
  wordActivated: { wordId: WordId };          // tap/click on a Word
  contextMenu: { anchor: RangeAnchor | null; x: number; y: number };
  figureActivated: { id: string };
  error: { code: string; message: string };
}

export interface ReaderEngine {
  mount(el: HTMLElement, publication: PublicationHandle, opts: EngineOptions): Promise<void>;
  destroy(): void;

  goTo(target: Anchor | { progression: number } | { chapterId: string }): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;

  setLayout(mode: LayoutMode): Promise<void>;
  setTypography(t: TypographySettings): Promise<void>;
  setTheme(tokens: ReaderThemeTokens): void;

  setDecorations(group: string, items: Decoration[]): void; // replaces the group
  injectFigures(items: FigureInjection[]): void;            // replaces all figures

  getVisibleRange(): VisibleRange | null;
  on<E extends keyof EngineEvents>(event: E, cb: (payload: EngineEvents[E]) => void): () => void;
}
```

The adapter is responsible for mapping engine Locators ↔ Anchors via the `data-w` spans. Changing typography or layout MUST keep the first visible Word on screen.

### 9.2 Layout and navigation

- Layout modes: `paginated-single`, `paginated-spread` (offered when the viewport is ≥ 1024 px wide), `scroll`. Default `auto` = spread on wide screens, single otherwise.
- Navigation: previous/next buttons; keyboard (←/→, PageUp/PageDown, Space, Home/End for chapter start/end); click/tap zones (outer 25% of the width); swipe on touch; a scrubber showing chapter ticks and overall percentage; a table-of-contents drawer; a "back" control that returns to the position before the last jump.
- Display "page X of Y in this chapter" from `pageInChapter`, recomputed live. Never persist it.
- Page-turn animation: `none` / `slide` / `fade`; forced to `none` under reduced motion. A page-curl skin is Phase 5.
- Overview mode (4-up thumbnails) is Parked until Phase 5; with reflowable text it requires off-screen rendering of many pages.

### 9.3 Selection, Annotations and Placed Bookmarks

- Desktop: selecting text shows a floating toolbar; right-click on a selection opens the same actions in a context menu.
- Touch: long-press starts native selection; the same floating toolbar appears. Phones have no right-click, so the toolbar is the primary path. Suppressing/augmenting the native iOS/Android selection menu is validated in P0-08.
- Actions: Highlight (4 colours from theme tokens), Add note, Copy, Remove highlight.
- Selections snap to whole Words (Invariant 4).
- Notes panel: list by Chapter, jump to Anchor, edit, delete, export all as Markdown.
- Placed Bookmarks: unlimited; added from the toolbar or a keyboard shortcut (B); placed on the first visible Word; drawn with the selected Bookmark Design; listed in the same panel as notes.

### 9.4 Reader Preferences

Zod schema in `contracts`; stored globally per user with optional per-Book overrides.

```ts
export interface ReaderPreferences {
  layout: 'auto' | LayoutMode;
  fontFamily: FontId;            // curated list only (§11.3)
  fontScale: number;             // 0.75–2.5, step 0.05
  lineHeight: number;            // 1.2–2.0
  margins: 'narrow' | 'normal' | 'wide';
  justify: boolean;
  hyphenate: boolean;
  theme: { mode: 'system' | 'light' | 'dark' | 'sepia'; seedColor?: string; contrast?: 'standard' | 'medium' | 'high' };
  pageTurn: 'none' | 'slide' | 'fade';
  narration: { rate: number; autoTurn: boolean; highlight: 'word' | 'sentence' | 'off' };
}
```

Settings changes apply live without reloading the Chapter, and preserve position (§9.1).

### 9.5 Reading Progress sync

- Save on `relocated`, debounced to 2 s and on app background/close.
- Conflict rule: last write wins by `updated_at`. If the server position on open differs from the local one by more than 1% progression and came from another device, show a prompt: "You were further ahead on another device. Jump there?"
- `furthest_progression` is tracked separately (used later for reviews and refunds).

### 9.6 Styled blocks (LitRPG status windows and similar)

Web fiction, especially LitRPG, uses boxed blocks for status windows, system messages and tables. Requirements:

- Ingestion preserves these blocks' structure and allowlisted CSS (borders, backgrounds, padding, monospace, tables).
- Author colours are re-mapped onto theme tokens at render time so blocks stay readable in light, dark and sepia themes (e.g. author background → `surface-container`, author border → `outline`).
- Fixture EPUB with status windows is part of P0-05 and every reader E2E suite.

### 9.7 Platform differences

`apps/app/src/lib/platform/` exposes one interface per capability with `web` and `capacitor` implementations: `audio` (HTML audio + Media Session vs native plugin), `storage` (IndexedDB vs Capacitor Filesystem/Preferences), `share`, `haptics`, `deepLinks`. Feature code imports the interface, never the implementation.

---

## 10. API conventions, security and privacy

### 10.1 API conventions

- REST over JSON under `/v1`. One Hono router per module in `apps/api/src/modules/`.
- Every request body, query and response is validated with a Zod schema exported from `@bp/contracts`. The app's API client (`apps/app/src/lib/api`) uses the same schemas.
- Errors: `{ "error": { "code": "ENTITLEMENT_REQUIRED", "message": "…", "details": { … } } }`. Codes are a string enum in `contracts` (`VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `ENTITLEMENT_REQUIRED`, `RATE_LIMITED`, `UPLOAD_TOO_LARGE`, `INGEST_FAILED`, …). Messages say what happened and what to do.
- Pagination: cursor-based, `?cursor=&limit=` → `{ items, nextCursor }`.
- Auth: `Authorization: Bearer <Supabase JWT>`. Unauthenticated access only for public catalogue reads.
- Mutations that create money movements or Entitlements accept an `Idempotency-Key` header.
- CORS: the web origin plus Capacitor origins (`capacitor://localhost` on iOS, `https://localhost` on Android).

**Phase 1 endpoints (initial):**

| Method & path | Purpose |
|---|---|
| `GET /v1/me`, `PATCH /v1/me`, `DELETE /v1/me` | Profile; account deletion (required by the App Store when sign-up exists) |
| `POST /v1/uploads` | Presigned upload URL |
| `POST /v1/books`, `GET/PATCH /v1/books/:bookId` | Author book management |
| `POST /v1/books/:bookId/revisions` | Start ingest from an upload |
| `GET /v1/books/:bookId/revisions/:revisionId` | Status + ingest report |
| `POST /v1/books/:bookId/revisions/:revisionId/publish` | Publish a Revision |
| `GET /v1/catalogue` | Public list of listed Books |
| `POST /v1/products/:productId/claim` | Add a free Product to the library |
| `GET /v1/library` | User's Entitlements, grouped by Book |
| `POST /v1/books/:bookId/open` | Entitlement check → content token, manifest URL, Layers, progress, prefs |
| `GET /v1/content/:token/*` | Content delivery (§10.3) |
| `GET/PUT /v1/books/:bookId/progress` | Reading Progress |
| `GET/POST/PATCH/DELETE /v1/books/:bookId/annotations[/:id]` | Annotations |
| `GET/POST/DELETE /v1/books/:bookId/placed-bookmarks[/:id]` | Placed Bookmarks |
| `GET/PUT /v1/preferences[?bookId=]` | Reader Preferences |

### 10.2 Upload safety

- Size limits: EPUB 100 MB, image 25 MB, audio 1 GB per file.
- Sniff file types from content, not extension.
- EPUB content is sanitised (§7.1); images are re-encoded (§7.3); audio is transcoded (§7.2). Originals are deleted from `uploads/tmp/` after processing.
- Per-user rate limits on uploads and job creation.

### 10.3 Content access tokens

`POST /v1/books/:bookId/open` checks Entitlements and returns a short-lived token (HMAC-signed; claims: `userId`, `bookId`, `revisionId`, allowed `packIds` and `trackIds`, `exp` = 1 hour).

Content is served at `/v1/content/{token}/{path}`. Because the token is a **path prefix**, relative URLs inside chapter XHTML (images, stylesheets, fonts) resolve under the same prefix and are authorised automatically — no per-resource signing. The reader refreshes the token before expiry.

Phase 1 serves this from the Node API (streaming from object storage, `Cache-Control: private`). Moving it to an edge worker is OPEN-03. Heavy DRM (Readium LCP) is Parked; watermarking is a Phase 3 consideration.

### 10.4 Reader sandboxing

Chapter content renders in a sandboxed iframe (as the reader engine does). Only our own injected scripts run inside it. Apply a strict Content-Security-Policy on content responses: no inline scripts from the book, no external origins.

### 10.5 Privacy

What people read is personal data. No third-party ad or tracking SDKs. Analytics are first-party, minimal and documented in `docs/analytics.md`. Users can export their Annotations and delete their account and data.

---

## 11. Design system and UI

### 11.1 Direction

Material 3 (the current Google design language) as the default look; users can customise colours, contrast, mode and reading fonts. Build on Material 3 tokens so customisation means changing token values, not components.

### 11.2 Colour and theming

- Generate schemes with `@material/material-color-utilities` from a single seed colour, for light and dark modes and three contrast levels. Output CSS custom properties named after M3 roles: `--md-sys-color-primary`, `--md-sys-color-on-primary`, `--md-sys-color-surface`, `--md-sys-color-surface-container`, `--md-sys-color-outline`, etc.
- Theme generation lives in `packages/ui/src/theme/` and is pure (seed + mode + contrast → token map), so it runs on server, web and Capacitor identically.
- User customisation: choose a seed colour (or one of ~8 presets), mode and contrast. Sepia is a reader-surface override on top of the light scheme.
- Default seed: **do not ship M3's baseline purple (`#6750A4`)**; it reads as an unbranded template. Pick a brand seed when the product is named (OPEN-07).
- Reader content uses the same tokens (§9.6), so author styling adapts to the theme.

### 11.3 Typography

- UI font: Roboto Flex. (Google Sans is not licensed for third-party use — don't use it.)
- Reading fonts (curated, self-hosted, no Google Fonts CDN so they work offline): Literata, Source Serif 4, Merriweather, Roboto Flex, Atkinson Hyperlegible, OpenDyslexic, plus "Publisher default" (the EPUB's own font). Verify each licence before bundling (expected: SIL OFL).
- Use the M3 type scale tokens for UI text. Reading line length defaults to ≤ 75 characters per line on wide screens via the `margins` preference.

### 11.4 Components (Phase 1 set, in `packages/ui`)

Button (filled, tonal, outlined, text), IconButton, Slider, Switch, Radio, Checkbox, TextField, Menu, Dialog, Bottom sheet, Navigation bar, Navigation rail, Snackbar, Card, Chip, Tabs, Progress indicator, Tooltip. OPEN-02 decides whether to wrap `m3-svelte` or build these directly.

### 11.5 Layout

- M3 window size classes: compact < 600 px, medium 600–839 px, expanded ≥ 840 px.
- App navigation: navigation bar on compact; navigation rail on medium/expanded.
- Main areas: Store, Library, Reader, Creator (author tools), Settings.
- Reader is full-screen; its toolbars auto-hide and toggle with a tap in the centre zone or the Esc key.

### 11.6 UI copy rules

- Sentence case everywhere. Active, specific verbs: "Add to library", "Publish revision", "Save note".
- An action keeps its name through the flow: the "Publish" button produces a "Published" snackbar.
- Errors say what happened and how to fix it, without apologising. Empty states tell the user what to do next ("Your library is empty. Browse the store to add a book.").
- Name things as users understand them ("Narration", "Illustrations"), not by system internals ("Layers", "Sync Maps").

### 11.7 Accessibility floor

WCAG 2.2 AA; visible keyboard focus; 48 × 48 dp minimum touch targets; full keyboard operation of the reader; labelled controls; reduced motion respected; book content readable by VoiceOver and TalkBack (word spans must not break screen reader output — verify in P0-06).

---

## 12. Testing, CI and Definition of Done

### 12.1 Test layers

| Layer | Tool | Required for |
|---|---|---|
| Unit | Vitest | `text-pipeline`, `alignment`, `contracts`, `reader-core` mapping, entitlements, theme generation |
| Golden files | Vitest snapshots | Ingestion: fixture EPUB → expected XHTML, word index and manifest |
| Component | @testing-library/svelte | `ui`, `reader-svelte` |
| API integration | Vitest + docker Postgres + MinIO | Every API module |
| End-to-end | Playwright (chromium **and** webkit) | Each phase's acceptance flows |
| Device smoke | Manual checklist (`docs/device-checklist.md`) | Every mobile release, on a real iPhone and a mid-range Android |

### 12.2 Fixtures (`fixtures/`)

- A public-domain novel EPUB from Standard Ebooks (CC0, well-formed EPUB 3).
- A matching public-domain LibriVox recording of a few chapters of the same work. Different source editions create realistic text/audio mismatches for alignment tests.
- An image-heavy EPUB.
- The owner's own sample chapter containing LitRPG status windows and tables.
- (Phase 2) EPUBs in a right-to-left language and a CJK language for tokeniser tests.

### 12.3 Initial performance budgets

- Open a cached 10,000-word Chapter in < 1 s on a mid-range Android device.
- Re-layout after a typography change in < 300 ms, keeping the first visible Word on screen.
- Reader route JavaScript (excluding the engine) < 250 KB gzipped.

### 12.4 CI (GitHub Actions)

On every PR: install, `pnpm check` (svelte-check + tsc), `pnpm lint`, `pnpm test`, `pnpm build`, Playwright E2E against a preview build with docker services. Main branch deploys to staging.

### 12.5 Definition of Done

- [ ] Acceptance criteria of the task are met and demonstrated by tests.
- [ ] `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build` pass.
- [ ] No new `any` without an explaining comment; no `@ts-ignore` without a linked issue.
- [ ] New schemas/DTOs live in `@bp/contracts`.
- [ ] DB changes ship with a drizzle-kit migration and updated seed data.
- [ ] UI is keyboard-operable, labelled, and respects reduced motion.
- [ ] Glossary terms used correctly; this document updated if a decision changed.
- [ ] No secrets committed; new env vars added to `.env.example` with a comment.

---

## 13. Phases and tasks

Phases are sequential. Each phase ends with an exit review: acceptance flows pass, ADRs are written, and this document is updated.

| Phase | Goal | Outcome |
|---|---|---|
| 0 | Foundations and spikes | Repo, tooling, CI; the four technical unknowns de-risked |
| 1 | Reader MVP and author publishing | An author publishes an EPUB; readers add it free and read on web, iOS and Android |
| 2 | Official Layers | Author-made illustrations and synced narration |
| 3 | Commerce | Paid Products, Bundles, cosmetics |
| 4 | Community | Community Layers with author permission, payouts, moderation |
| 5 | Steam layer and retention | Store SEO, reviews, wishlists, achievements, glossary, offline |

### 13.1 Phase 0 — Foundations and spikes

Spikes produce ADRs in `docs/adr/` and throwaway code under `apps/app/src/routes/spike/` (deleted at phase end). Do not build features in Phase 0.

#### P0-01 Monorepo and tooling
Depends on: —
- pnpm workspaces, Turborepo, `packages/config` with strict tsconfig, ESLint (with import-boundary rules from §5), Prettier, Vitest, Playwright (chromium + webkit).
- Root scripts: `dev`, `check`, `lint`, `test`, `test:e2e`, `build`, `db:migrate`, `db:seed`.
- GitHub Actions CI per §12.4.

Acceptance:
- [ ] From a clean clone, `pnpm i && pnpm check && pnpm lint && pnpm test && pnpm build` succeeds.
- [ ] CI runs on pull requests and fails on a deliberate type error.
- [ ] An import from `packages/reader-core` into `apps/api` fails lint.

#### P0-02 Local services
Depends on: P0-01
- `docker-compose.yml` with Postgres and MinIO; `.env.example` documenting every variable.

Acceptance:
- [ ] `docker compose up -d && pnpm db:migrate && pnpm db:seed` works on a fresh machine.

#### P0-03 App shell (web + Capacitor)
Depends on: P0-01
- SvelteKit SPA build (`adapter-static`, fallback page, `ssr = false`), placeholder routes for Store, Library, Reader, Creator, Settings.
- Capacitor added with iOS and Android projects; `cap:sync`, `cap:ios`, `cap:android` scripts.
- `lib/platform/` interfaces (§9.7) with stub implementations.

Acceptance:
- [ ] The same build runs in a desktop browser, the iOS simulator and the Android emulator.

#### P0-04 API, worker and contracts shell
Depends on: P0-02
- Hono app with `/v1/health`, error middleware producing the §10.1 error shape, Zod validation helper.
- Drizzle connected; first migration creates `users`.
- Worker process running pg-boss with a no-op job; API can enqueue it.
- `@bp/contracts` exports error codes and the error schema; the app's API client consumes them.

Acceptance:
- [ ] Integration test: enqueue from API → worker processes → status visible via API.

#### P0-05 Spike: reader engine (resolves OPEN-01)
Depends on: P0-03
Evaluate Readium ts-toolkit and foliate-js on all fixtures (§12.2) in `/spike/reader`.

Score each on:
1. Paginated single, paginated spread and scroll modes.
2. Changing font size/family keeps the first visible Word on screen.
3. Decorations API usable for highlights and narration highlighting.
4. Selection events mappable to `data-w` Word ranges.
5. Injecting a `<figure>` re-paginates correctly.
6. Works inside iOS WKWebView and Android WebView via Capacitor.
7. 10,000-word Chapter with word spans meets §12.3 budgets.
8. Licence, maintenance activity, documentation quality.
9. Manifest format required and how content URLs are resolved (must work with §10.3 path-prefix tokens).

Acceptance:
- [ ] `docs/adr/ADR-001-reader-engine.md` with scores, chosen engine and manifest format.

#### P0-06 Spike: tokenisation and word spans
Depends on: P0-05
- Prototype `Intl.Segmenter` wrapping on fixtures. Measure span count, file size growth, render time.
- Check VoiceOver and TalkBack read wrapped text naturally.
- Confirm `data-w` attribute vs `id` approach.

Acceptance:
- [ ] `docs/adr/ADR-002-word-spans.md`.

#### P0-07 Spike: narration alignment
Depends on: P0-01
- Run whisper.cpp on two LibriVox chapters; implement a minimal Needleman–Wunsch aligner in `packages/alignment`.
- Report coverage, CPU time per hour of audio, and recommended model size.

Acceptance:
- [ ] Coverage ≥ 0.95 on clean narration of the matching text.
- [ ] `docs/adr/ADR-003-alignment.md` including hosting implications (CPU vs GPU).

#### P0-08 Spike: mobile platform capabilities
Depends on: P0-03
- Background audio with lock-screen controls (Capacitor native plugin) on iOS and Android.
- Long-press text selection inside the reader iframe with our own floating toolbar.
- Deep links for auth callbacks; safe-area handling.

Acceptance:
- [ ] `docs/adr/ADR-004-mobile-platform.md` naming the plugins used and any limitations.

#### P0-09 Authentication
Depends on: P0-03, P0-04
- Supabase Auth: email magic link, Google, Apple. Works on web and both mobile platforms (deep-link callback).
- API middleware verifies the JWT and upserts `users` on first request.

Acceptance:
- [ ] Playwright test signs in on web; manual sign-in verified on iOS and Android.

**Phase 0 exit:** ADR-001 to ADR-004 accepted; one fixture book readable on web, iOS and Android with a font-size change preserving position; CI green.

### 13.2 Phase 1 — Reader MVP and author publishing

Everything is free in this phase, but Products and Entitlements are real from day one (Invariant 5).

**Ingestion**

| ID | Task | Depends on | Acceptance |
|---|---|---|---|
| P1-ING-01 | Presigned uploads (`uploads` table, type/size checks, §10.2) | P0-04 | Oversized and wrong-type files are rejected with `UPLOAD_TOO_LARGE` / `VALIDATION_FAILED`. |
| P1-ING-02 | `text-pipeline`: parse, sanitise, tokenise, assign WordIds, emit manifest and word index (§7.1) | ADR-001, ADR-002 | Golden-file tests pass for all fixtures; output is byte-identical across runs; scripts and external resources are removed. |
| P1-ING-03 | `ingest-epub` job, Revision status, ingest report screen in Creator | P1-ING-01, P1-ING-02 | Uploading a fixture shows word count, chapters and warnings; a corrupt EPUB shows a readable failure reason. |
| P1-ING-04 | Preview and publish a Revision | P1-ING-03 | Author can read a `ready` Revision before publishing; publishing updates `current_revision_id`. |
| P1-ING-05 | Revision diff, WordId carry-forward, `migrate-anchors` job (§6.2) | P1-ING-04, P1-RDR-06 | Editing one paragraph keeps all other Annotations on the same WordIds (`migrated`); an Annotation on deleted text is re-found by quote if moved, else `orphaned` with the owner notified. |

**Catalogue and library**

| ID | Task | Depends on | Acceptance |
|---|---|---|---|
| P1-CAT-01 | Creator profile and Book management; public Book page (cover, description, chapter list, "Add to library") | P0-09 | Book page renders for signed-out users; edits by non-owners return `FORBIDDEN`. |
| P1-CAT-02 | Products and Entitlements (free claim), default Bookmark Design at sign-up, Library screen | P1-CAT-01 | Claiming twice is idempotent; Library lists claimed Books; `entitlements.check` has full unit coverage. |
| P1-CAT-03 | `POST /books/:id/open`, content access tokens and `/v1/content` delivery (§10.3) | P1-CAT-02, P1-ING-04 | Without an Entitlement → `ENTITLEMENT_REQUIRED`; expired token → 401; relative image URLs inside chapters load. |

**Reader**

| ID | Task | Depends on | Acceptance |
|---|---|---|---|
| P1-RDR-01 | Engine adapter implementing `ReaderEngine`; Anchor ↔ Locator mapping | ADR-001, P1-CAT-03 | Unit tests round-trip Anchors through Locators for every fixture. |
| P1-RDR-02 | Reader shell and navigation (§9.2) | P1-RDR-01 | All inputs listed in §9.2 work; "back" returns to the pre-jump position. |
| P1-RDR-03 | Layout modes, including `auto` | P1-RDR-02 | Switching modes keeps the first visible Word on screen. |
| P1-RDR-04 | Reader Preferences UI, persistence, live apply (§9.4) | P1-RDR-02, P1-UI-01 | Changing any setting re-lays out within budget and keeps position; settings sync across devices. |
| P1-RDR-05 | Reading Progress sync (§9.5) | P1-RDR-02 | Reading on web then opening on mobile resumes at the same Word; the cross-device prompt appears when appropriate. |
| P1-RDR-06 | Selection toolbar, Annotations, notes panel, Markdown export (§9.3) | P1-RDR-01 | Works with mouse, keyboard and long-press; selections snap to whole Words; export produces valid Markdown with chapter headings. |
| P1-RDR-07 | Placed Bookmarks (§9.3) | P1-RDR-06 | Unlimited bookmarks; each drawn with the chosen Bookmark Design; survive font changes. |
| P1-RDR-08 | Styled block theming (§9.6) | P1-RDR-04 | The LitRPG fixture's status windows meet AA contrast in light, dark and sepia. |

**UI, mobile and operations**

| ID | Task | Depends on | Acceptance |
|---|---|---|---|
| P1-UI-01 | Theme generation and tokens (§11.2) | P0-01 | Pure function tested: same seed/mode/contrast → same tokens; all text roles meet AA. |
| P1-UI-02 | Component set (§11.4) | P1-UI-01, OPEN-02 | Each component has keyboard, focus and reduced-motion tests. |
| P1-UI-03 | App navigation, responsive layout, Settings with theme customisation (§11.5) | P1-UI-02 | Layout correct at compact, medium and expanded widths; theme changes apply app-wide instantly. |
| P1-MOB-01 | iOS and Android builds for the full Phase 1 flow; account deletion; icons and splash; offline-tolerant reading of the current Chapter with queued writes | P0-08, P1-RDR-07 | Device checklist passes; progress and notes made offline sync when back online. |
| P1-OPS-01 | Staging: API and worker containers, managed Postgres, R2, web on CDN, Sentry, backups | P0-04 | A merge to main deploys automatically; errors from all four runtimes appear in Sentry. |

**Phase 1 exit (end-to-end flow, automated on web, manual on devices):**
An author uploads the launch-title EPUB, reviews the ingest report and publishes. A reader signs up, adds the Book to their library, opens it, changes font size and layout (position kept), highlights a sentence with a note, places three bookmarks and closes the app. On a second device they see the same position, note and bookmarks. The author publishes a Revision that edits one paragraph; the reader's other notes and bookmarks are unaffected.

### 13.3 Phase 2 — Official Layers

| ID | Task | Depends on | Acceptance |
|---|---|---|---|
| P2-ILL-01 | Illustration Packs, image upload and `process-image` (§7.3) | Phase 1 | Variants generated; EXIF stripped; publishing blocked without alt text. |
| P2-ILL-02 | Author placement tool: select text in Creator mode → "Attach illustration" → image, placement, alt text | P2-ILL-01 | Placement stored as a RangeAnchor; survives Revision migration. |
| P2-ILL-03 | Illustration rendering: `inline`, `full_page`, `rail`; lightbox zoom (§8.3) | P2-ILL-02 | Re-pagination correct after injection; rail shows only Illustrations in the visible range. |
| P2-LAY-01 | Layer selection UI and defaults (§8.1) — labelled "Narration" and "Illustrations" | P2-ILL-03 | Official Layers on by default; selections persist per Book. |
| P2-NAR-01 | Audio Tracks, per-Chapter audio upload, `transcode-audio` | Phase 1 | Output loudness within ±1 LU of target. |
| P2-NAR-02 | `align-narration` job and creator review screen (§7.2) | P2-NAR-01, ADR-003 | Coverage reported per Chapter; `needs_review` Chapters list low-confidence regions with jump links. |
| P2-NAR-03 | Narration player in the reader (§8.2) | P2-NAR-02 | Word highlight within 100 ms of audio; auto page turn; tap-to-seek; rate control. |
| P2-NAR-04 | Mobile background playback and lock-screen controls | P2-NAR-03, ADR-004 | Audio continues with the screen locked on iOS and Android; progress updates on resume. |
| P2-NAR-05 | Re-alignment when a Revision is published | P2-NAR-02, P1-ING-05 | Changed Chapters go `stale` → `ready` automatically when audio still matches. |
| P2-SRCH-01 | *(stretch)* In-book search using the word index | Phase 1 | Results jump to the match and decorate it. |
| P2-TTS-01 | *(stretch)* Device text-to-speech fallback when no narration exists, reusing narration highlighting | P2-NAR-03 | Works on web (Web Speech API) and both mobile platforms. |
| P2-IMP-01 | *(stretch)* DOCX/Markdown import via Pandoc into the EPUB pipeline | P1-ING-02 | Imported fixture produces a valid Revision. |

**Phase 2 exit:** the launch title has an official Illustration Pack and official narration for at least three Chapters; readers can toggle both; narration highlights Words and turns pages on web, iOS and Android, including with the screen locked.

### 13.4 Phase 3 — Commerce (outline; detail before starting)

- Stripe Checkout on web; paid Products; receipts.
- Bundles, with "Complete edition" (Book + official Layers) as the default purchase option on the Book page.
- Covers and Bookmark Designs as cosmetic Products; a simple cosmetics shop.
- Refund policy using `furthest_progression` (e.g. refundable below a read threshold).
- Early-access chapters for serials (needs chapter-range Products — OPEN-10).
- Tax handling (OPEN-04) and mobile purchasing model (OPEN-05).
- Account data export; evaluate watermarking.

### 13.5 Phase 4 — Community (outline)

- Creator onboarding and Stripe Connect payouts; earnings ledger.
- Author settings for `community_policy` (§6.5).
- Community Illustration Pack and Audio Track submission → author approval (if required) → moderation → listing.
- Reporting, takedown process, AI-generated content disclosure (OPEN-09), revenue splits (OPEN-08).
- "Author-endorsed" badge.
- Workshop-style hub per Book: browse, rate and enable community Layers.

### 13.6 Phase 5 — Steam layer and retention (outline)

- Server-rendered store pages for search engines.
- Reviews showing how far the reviewer read; wishlists and sale alerts.
- Reading stats and achievements.
- Spoiler-safe glossary: entries anchored in the text and shown only if the reader has passed their first appearance.
- "Story so far" recap when returning after a break.
- Popular highlights; author analytics (drop-off by Chapter).
- Offline downloads; overview (thumbnail) mode; page-curl skin; sleep timer.

### 13.7 Parked (do not build without explicit approval)

- Ambient audio and sound-effect cues (§8.4).
- Random bookmark drops, trading or any loot-box mechanic (gambling regulation risk). Bookmark Designs are direct purchases only.
- Heavy DRM (Readium LCP).
- A native (non-WebView) reader.
- Facing-page Illustration placement in spread mode.
- Real-time co-reading or chat.

---

## 14. Decision log

| ID | Decision | Status |
|---|---|---|
| D-001 | pnpm + Turborepo monorepo, TypeScript strict | Accepted |
| D-002 | Svelte 5 + SvelteKit built as an SPA, wrapped by Capacitor for iOS/Android | Accepted |
| D-003 | Hono API on Node; Postgres + Drizzle; pg-boss jobs; no direct client DB access | Accepted |
| D-004 | Supabase Auth (email, Google, Apple) | Accepted |
| D-005 | R2 object storage (MinIO locally) | Accepted |
| D-006 | Everything attaches via WordId Anchors with text-quote recovery; no stored pages | Accepted |
| D-007 | EPUB 3 is the only ingest format in Phase 1 | Accepted |
| D-008 | Every purchasable is a Product; access only via Entitlements; free = price 0 + claim | Accepted |
| D-009 | Material 3 tokens via material-color-utilities; user-customisable seed, mode, contrast | Accepted |
| D-010 | Community content default `closed`; author controls policy | Accepted |
| D-011 | Reader engine | Pending ADR-001 |
| D-012 | Word span format (`data-w`) | Pending ADR-002 |
| D-013 | Alignment model and hosting | Pending ADR-003 |
| D-014 | Mobile audio and selection plugins | Pending ADR-004 |

---

## 15. Open questions

| ID | Question | Resolve by |
|---|---|---|
| OPEN-01 | Readium ts-toolkit or foliate-js? | P0-05 |
| OPEN-02 | Wrap `m3-svelte` or build our own Material 3 components? Check maintenance, Svelte 5 support, theming via our tokens. | Before P1-UI-02 |
| OPEN-03 | Keep content delivery in the Node API or move to an edge worker? | When traffic justifies; before Phase 3 |
| OPEN-04 | Stripe + Stripe Tax vs a merchant of record for digital-goods VAT/sales tax, given creator payouts in Phase 4. | Before Phase 3 |
| OPEN-05 | Mobile purchasing. Default: "reader app" model (no purchasing in the mobile app; buy on web, read anywhere, as the Kindle app does). Re-check App Store and Play rules before Phase 3: as of October 2026, US iOS link-outs carry no Apple commission while a court sets a fee (Apple has proposed 5–15%), and Google has cut its rate to 10%. | Before Phase 3 |
| OPEN-06 | Hosting for API and worker (containers need ffmpeg and whisper.cpp; GPU per ADR-003). | P1-OPS-01 |
| OPEN-07 | Product name and brand seed colour. | Before public launch |
| OPEN-08 | Default revenue splits (platform / author / community creator). | Before Phase 4 |
| OPEN-09 | Policy on AI-generated illustrations and narration (allowed? disclosed? author opt-out?). | Before Phase 4 |
| OPEN-10 | Chapter-range Products for early-access serial chapters. | Before Phase 3 |

---

## 16. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Two-sided marketplace cold start | No readers without books, no authors without readers | Launch with the owner's own title; target web-serial and indie authors who own rights; free-first Phase 1 |
| Alignment quality on real narration | Bad highlighting kills the core feature | Spike P0-07, coverage threshold, creator review screen |
| WebView reader performance on low-end Android | Sluggish page turns | Budgets in §12.3 measured from Phase 0; engine choice scored on it |
| Rights disputes over community content | Legal exposure, author distrust | Default `closed`; approval flow; takedown process; recorded licences |
| App store policy changes | Fees or rejection | Web-first sales; reader-app model; revisit OPEN-05 |
| Too many purchase choices | Undermines the low-friction pitch | "Complete edition" default; official Layers on by default |
| Scope creep / solo bandwidth | Nothing ships | Strict phases, Parked list, exit reviews |

---

## Appendix A — `AGENTS.md` template (repo root)

```md
# AGENTS.md

Read docs/DESIGN.md §0–§3 before any task. Glossary terms and Invariants are binding.
Find your task ID in docs/DESIGN.md §13; check its dependencies and any OPEN items it touches.

## Commands
pnpm i
docker compose up -d
pnpm db:migrate && pnpm db:seed
pnpm dev                 # app + api + worker
pnpm check               # svelte-check + tsc
pnpm lint
pnpm test
pnpm test:e2e
pnpm --filter app cap:sync | cap:ios | cap:android

## Rules
- One task ID per branch/PR (branch: p1-rdr-04-typography).
- Svelte 5 runes only. TypeScript strict. Schemas in @bp/contracts.
- Never import the reader engine outside packages/reader-core.
- Never store page numbers; attach everything with Anchors.
- Never resolve an OPEN-xx item silently; propose it in the PR.
- Meet the Definition of Done in docs/DESIGN.md §12.5.
```

If you use Claude Code, a `CLAUDE.md` containing the single line `@AGENTS.md` pulls these instructions in.
