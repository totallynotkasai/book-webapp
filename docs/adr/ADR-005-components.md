# ADR-005: UI components: our own on Bits UI primitives, or wrap m3-svelte

- **Status:** **Accepted** (12 October 2026, owner decision before Phase 1). Resolves OPEN-02.
- **Date:** 11 October 2026
- **Task:** P0-10 Spike: UI components. Resolves OPEN-02 once accepted.
- **Spike code:** was `apps/web/src/routes/spike/components/` and `apps/web/e2e/spike-components.spec.ts`; deleted in Phase 1.1 with `m3-svelte` and `vite-plugin-functions-mixins`. P1-UI-02 builds `packages/ui` on Bits UI.

## Context

DESIGN.md §11 fixes the design direction: Material 3's colour system and role tokens with our own brand, generated from one seed colour for light and dark modes and three contrast levels (§11.2), the UI font stack with Arial Rounded MT where installed and Nunito as the fallback (§11.3), and the accessibility floor in §11.7: 48 px touch targets, visible focus, full keyboard use, labelled controls, and reduced motion (Invariant 12). §11.4 lists the 20 components P1-UI-02 has to build in `packages/ui`. All of our code uses Svelte 5 runes (Invariant 13).

OPEN-02 asks how to build them: wrap `m3-svelte`, or build our own on headless Bits UI primitives styled with our tokens. Its recommendation was to evaluate m3-svelte first and fall back to Bits UI.

## Options

- **A. Wrap m3-svelte.** A complete Material 3 (Expressive) component library for Svelte. Our `packages/ui` would wrap its components and theme them by mapping its `--m3c-*` colour variables to our `--md-sys-color-*` roles.
- **B. Our own components on Bits UI.** Bits UI is a headless library: it provides behaviour and ARIA (focus management, keyboard support, positioning, dismissal) and no styling. `packages/ui` would style each component with our tokens.

## How the spike compared them

`/spike/components` builds the same four components twice: Button (filled, tonal, outlined, text), Slider, Menu and Bottom sheet. A theme is generated with `@material/material-color-utilities` from a **placeholder** deep-teal seed (`#1b6b6b`, marked `SIMULATION:`; OPEN-07 picks the real one, and it is not M3 purple). Its roles are set as `--md-sys-color-*` on `<html>`, so content portalled to `<body>` inherits them. Seed, mode (light, dark) and contrast (standard, medium, high) switch live, and both sets follow. Both sets use `--font-ui` from `packages/tokens`. Each set is loaded with a dynamic import so the build puts it in its own chunk, which lets `bundle-size.mjs` measure what each set adds.

`spike-components.spec.ts` runs in Chromium and WebKit. For each set it checks: Tab order and accessible names; the slider from the keyboard; the menu opened, navigated, chosen from and closed with the keyboard, with focus returning to the trigger; menu roles; the sheet opened from the keyboard, with focus contained, Escape, focus return and an accessible name; and the sheet filling the bottom edge of a 360 × 780 viewport. Across both sets it checks running animations with `prefers-reduced-motion` emulated, measures touch-target heights, and checks that both follow live seed, mode and contrast changes and use the UI font stack. Where the two libraries behave differently, the spec asserts each one's actual behaviour, so the findings below can be re-run.

Versions tested (each published at least two weeks before 11 October 2026): m3-svelte **7.2.1** (20 Sep 2026), bits-ui **2.19.3** (22 Sep 2026; 2.19.4 and 2.19.5 were too new), @material/material-color-utilities **0.4.0** (21 Jan 2026), plus the dependencies they needed (see Dependencies below).

## Measurements

### 1. Svelte 5 runes support

| | m3-svelte 7.2.1 | Bits UI 2.19.3 |
|---|---|---|
| Components using `$props()` | 54 of 54 `.svelte` files | 220 of 226 (the other 6 take no props) |
| Legacy syntax (`export let`, `<slot>`, `$:`, `on:`, `createEventDispatcher`, `svelte/store`) | none | none |
| Snippets / `{@render}` | yes (21 files) | yes (191 files), plus 58 `.svelte.js` rune state modules |
| Svelte peer range | `^5.40.0` | `^5.33.0` |
| `npm run check` | 0 errors, 0 warnings (1,036 files) | same run |

**Both are fully runes-based.** Svelte 5 support does not separate them.

### 2. Theming from our generated tokens

**m3-svelte** reads `--m3c-<role>`, using the same M3 role names, so our tokens map onto it one alias per role. `m3-theme.css` has 31 role aliases, `--m3-font: var(--font-ui)`, and 3 approximations for m3-svelte's own extra roles (`on-on-primary` and `*-container-subtle`), which standard M3 generation doesn't produce. Colour theming itself works. The cost is elsewhere:

- **It needs a non-standard CSS build step.** Its styles use draft CSS (`@mixin`, `@apply`, `@function`, `--translucent()`, `--m3-density()`), which `vite-plugin-functions-mixins` compiles away. The app also has to define `@function --m3-density`. Without the plugin, its styles are broken.
- **That plugin doesn't fit our stack.** Its 0.4.1 release declares `peer vite@^7.2.4`, and we're on Vite 8. npm refuses to install it (ERESOLVE), and `overrides` don't apply to peer ranges, so it went in with `--legacy-peer-deps`. While it's in the tree, every later `npm install <pkg>` needs the same flag. (`npm ci` from the lockfile still works.)
- **The plugin also assumes an unhoisted layout.** It looks for `<cwd>/node_modules/m3-svelte`, but npm workspaces hoist packages to the repo root, so the build failed with ENOENT until `vite.config.ts` computed a relative path to the root.
- **It breaks in dev.** In `vite dev`, the pre-bundled m3-svelte skips the plugin: buttons rendered 19 px tall and unstyled, with 10 unprocessed rules, until `optimizeDeps.exclude: ['m3-svelte']` was added. On every build, the plugin also scans every CSS file under `apps/web`.
- **Its CSS leaks into the whole app.** `m3-svelte/etc/styles.css` sets `*, *::before, *::after { box-sizing: inherit }` and gives every `:focus-visible` element on the page an animated, overshooting focus ring (`focus-outward`). The spec caught that animation on the *Bits UI* buttons. Our unlayered `app.css` wins only because m3-svelte's rules sit in cascade layers.
- **Its colour helper needs newer browsers.** `--translucent()` compiles to relative colour syntax, `oklch(from …)`, which needs Chrome/WebView 119+ and Safari 18+.
- **Its own theme generator uses a different package.** That is a fork, `@ktibow/material-color-utilities-nightly`, which defaults to the 2025 colour spec; we generate with Google's package, which defaults to the 2021 spec. Using m3-svelte's generator would bring in a second colour library.

**Bits UI** has no styles of its own. `bits.css` is 218 non-blank lines (5.6 kB of source; 1.4 kB gzipped). It reads `--md-sys-color-*` directly and covers four button variants with state layers, the slider, the menu, the sheet with scrim and animations, reduced motion and forced colours. That works out to roughly 50 lines of CSS per component, all of it ours, with no build plugin and no global side effects.

### 3. Keyboard and screen-reader behaviour

The results were the same in Chromium and WebKit.

| Component | m3-svelte | Bits UI |
|---|---|---|
| **Button** | A native `<button>`. Names and Tab order are fine. It has no `ref` prop, so the element can't be bound; returning focus needed a wrapper `<span>` and `querySelector('button')`. | A native `<button>`. Fine. |
| **Slider** | A native `<input type="range">`. `aria-label` passes through. Arrow keys, Home and End work, and the value is exposed natively. | A `role="slider"` thumb with `aria-valuenow`, `aria-valuemin` and `aria-valuemax`. Arrow keys, Home and End work. |
| **Menu** | **Styling only.** No trigger, open state, positioning, focus management or keyboard support. `Menu` and `MenuItem` accept no attributes, so `role="menu"` and `role="menuitem"` can't be added (the spec finds 0 `menu` and 0 `menuitem` roles). Its docs mark Menu "Not updated to M3 Expressive". The spike added about 35 lines of glue to make it a keyboard-operable disclosure (buttons in a `role="group"`): `aria-expanded`, focus the first item, arrow keys, Escape, focus return, close on Tab or outside click. | `role="menu"` and `menuitem`, `aria-haspopup="menu"` and `aria-expanded`. Enter, Space or arrow keys open it with the first item focused; arrow keys move between items, with typeahead; Escape and outside clicks close it and focus returns to the trigger. Positioning with collision handling comes from floating-ui. **No glue.** |
| **Bottom sheet** | A native `<dialog>` opened with `showModal()`: Escape works, the page behind is inert and focus starts inside. **It has no accessible name** (the component takes no `aria-labelledby`, so the spec finds an empty name). **Focus is not returned to the trigger**: the dialog stays modal through its 300 ms outro and is then removed without `close()`, so even a `focus()` call made on close fails. The spike added about 8 lines of glue to wait until the dialog is gone and then refocus. Tab passes through `<body>` once per cycle (on the 2nd of 4 presses), which is native `<dialog>` behaviour; nothing behind the sheet is reachable. The drag handle works with mouse and touch only. | `role="dialog"`, named by `Dialog.Title` and described by `Dialog.Description`. A strict focus trap (0 of 4 Tab presses left it), Escape, focus returned to the trigger, scroll lock, portalled to `<body>`. There's no drag-to-dismiss; we would build that (see Consequences). **No glue.** |

### 4. Reduced motion

The spec counts running animations on opening the sheet and on moving keyboard focus onto a button, with `prefers-reduced-motion: reduce` emulated.

- **m3-svelte ignores the setting.** With `reduce`, the sheet still runs its Svelte height transition and its backdrop keyframes, focus still plays the `focus-outward` keyframes, and the state layers still transition, exactly as without `reduce`. Only its ripple checks `prefers-reduced-motion`; it's the one file in the package that does. Its buttons also animate their colour when the theme changes. To meet Invariant 12, we would need overrides for library internals.
- **Bits UI does no animation of its own.** Our CSS animates the sheet (`b-sheet-in`, `b-fade-in`), and with `reduce` the spec counts **0** running animations, both for the sheet and for focus.

### 5. Touch targets (48 px floor, §11.7)

| Measured height | m3-svelte (defaults) | Bits UI (our CSS) |
|---|---|---|
| Buttons | **40 px** (default size `s`; its `::before` hit area is `inset: 0`, so nothing extends it) | 48 px |
| Slider hit area | **44 px** | 48 px |
| Menu items | 48 px | 48 px |

With m3-svelte, size `m` (56 px) passes but is visually heavier than M3's 40 px button. A global `--m3-density()` override would change every component.

### 6. Bundle size

These are the minified files a set adds beyond what the app shell already loads, gzipped at level 9 (`node src/routes/spike/components/bundle-size.mjs` after `npm run build`).

| | JS | CSS |
|---|---|---|
| m3-svelte set (4 components + glue + its `styles.css`) | 16.1 kB (**6.0 kB gz**) | 22.7 kB (**4.1 kB gz**) |
| Bits UI set (4 components + `bits.css`) | 127.7 kB (**36.3 kB gz**) | 4.4 kB (**1.4 kB gz**) |
| Theme generation (`material-color-utilities`; needed by either option) | 83.1 kB (**19.9 kB gz**) | — |

Each component measured on its own (a temporary probe build, not committed), gzipped JS:

- **Bits UI:** Button 0.6 kB, Slider 10.3 kB, DropdownMenu 31.3 kB, Dialog 15.2 kB, all four together 39.7 kB. Most of this is shared infrastructure (floating-ui, focus scope, dismissible layers, runed, svelte-toolbelt) that is paid once; Tabs, Switch, Checkbox, Radio, Tooltip and Popover reuse it.
- **m3-svelte:** Button 2.0 kB (+1.3 kB CSS), Slider 2.5 kB (+1.6 kB CSS), BottomSheet and Menu 2.0 kB (+0.8 kB CSS).

m3-svelte is about 30 kB gzipped smaller, mostly because it leaves out the behaviour Bits UI provides; the glue to add that back is ours to write and ship. Both fit comfortably inside the 250 KB reader-route budget (§12.3), and the app layer can load components per route.

### 7. Maintenance

These figures were taken on 11 October 2026 with `npm view` and `gh api`, covering 11 Oct 2025 to 11 Oct 2026.

| | m3-svelte | Bits UI |
|---|---|---|
| Licence | Apache-2.0 OR GPL-3.0-only (we would take Apache-2.0) | MIT |
| Releases in 12 months | 28 | 39 |
| Major versions in 12 months | **3 breaking majors**: 5.0 (Jul 2025), 6.0 (7 Dec 2025), 7.0 (30 Dec 2025) | none; the whole period is 2.x |
| Latest release | 7.2.1 (20 Sep 2026) | 2.19.5 (3 Oct 2026) |
| Commits in 12 months | 291, of which KTibow made 245 and dependabot 37; 8 authors including bots | 160 from 48 distinct authors (huntabyte 53, release bot 40) |
| Bus factor | **one maintainer** | a lead maintainer plus a wide contributor base; it is also the primitive layer under shadcn-svelte |
| Stars / forks | 463 / 28 | 3,606 / 246 |
| Open issues / open PRs | 5 / 4 | 52 / 39 |
| Issues opened / closed since 11 Apr 2026 | 2 / 1 | 58 / 29 |
| Last push | 4 Oct 2026 | 3 Oct 2026 |
| Extra packages it pulls in | `vite-plugin-functions-mixins` and `@ktibow/material-color-utilities-nightly`, both from the same author (as optional peers) and `@ktibow/iconset-material-symbols` (as a dependency) | `@floating-ui/*`, `tabbable`, `runed`, `svelte-toolbelt`, and the `@internationalized/date` peer |

`@material/material-color-utilities` (Google, Apache-2.0) is needed under either option. It has had one release in 12 months (0.4.0, Jan 2026). That release has extensionless relative ESM imports which Node rejects (open upstream issue #195), so Vitest has to inline it (`vitest.config.ts`, `web` project).

## Decision

**Option B: build our own `packages/ui` components on Bits UI primitives, styled only with our generated `--md-sys-color-*` tokens and `packages/tokens`.** This reverses the plan's starting recommendation ("evaluate m3-svelte first"), for these measured reasons:

1. **The accessibility floor (§11.7) and Invariant 12.** Bits UI gives correct roles, names, focus traps, focus return and keyboard support for the hard components (menu, dialog, sheet) with no glue. m3-svelte's Menu has no behaviour and no way to add ARIA roles, its sheet has no accessible name and loses focus on close, its default buttons are 40 px, and it ignores `prefers-reduced-motion`. Fixing that means wrapping or forking library internals.
2. **Theming.** Both take our M3 roles. With Bits UI, the tokens *are* the styling, which is exactly DESIGN.md §11.1's rule: "customisation means changing token values, never components". m3-svelte needs a draft-CSS build plugin that conflicts with Vite 8 and npm workspaces, breaks in dev without extra config, and adds global CSS to the whole app.
3. **Maintenance risk.** m3-svelte has one maintainer, has shipped three breaking majors in 12 months, and depends on its author's own plugins and a forked colour library. Bits UI is MIT, has had a stable 2.x line for a year and has a broad contributor base.

**What we give up:** about 30 kB gzipped of JS for the first overlay components (paid once), and writing the M3 look ourselves (about 50 lines of CSS per component). m3-svelte's CSS remains a useful reference for M3 measurements and states. Anything copied from it must be taken under Apache-2.0, with its notice kept.

## Resolution of OPEN-02

> **OPEN-02 → resolved by D-0xx (proposed):** build our own components in `packages/ui` on headless Bits UI primitives (`bits-ui` 2.x), styled only with the generated `--md-sys-color-*` role tokens and `packages/tokens`; don't wrap m3-svelte. Evidence: ADR-005.

The lead engineer updates DESIGN.md (OPEN-02, the decision log and the §5.2 "Design system" row) after review; this ADR does not edit them.

## Consequences

### For P1-UI-01 (theme generation and tokens)

- Generate in `packages/tokens` with `@material/material-color-utilities` 0.4.0. The spike's `theme.ts` and `theme.test.ts` are a working starting point: seed + mode + contrast → `--md-sys-color-*`, with WCAG checks of at least 4.5:1 at standard contrast and at least 7:1 at high contrast for the main text pairs, all passing for the placeholder seed.
  - `MaterialDynamicColors.allColors` leaves out `shadow` and `scrim`; add them explicitly.
  - Decide the spec version. The library defaults to 2021; m3-svelte uses 2025.
  - The package needs Vitest's `server.deps.inline` (issue #195), as the `web` project now has.
- Apply the tokens on `<html>` (and set `color-scheme`), because Bits UI portals sheets, menus and tooltips to `<body>`.
- Generation costs **19.9 kB gzipped**. Consider pre-generating the preset schemes (about 8 seeds × 2 modes × 3 contrasts) at build time and loading the generator only when someone picks a custom seed in Settings.
- Add the tokens the Bits UI styles needed and §11 doesn't name yet: state-layer opacities (0.08 hover, 0.10 pressed and focus), shape (full, extra-large 28 px, extra-small 4 px), elevation levels 1–3 built from `--md-sys-color-shadow`, the M3 type scale (label-large, title, headline) on `--font-ui`, and emphasized easing curves alongside the existing `--duration-*` (which already drop to 0 ms under reduced motion).

### For P1-UI-02 (component set)

Coverage of the §11.4 list:

| §11.4 component | Bits UI primitive (Option B) | Build ourselves | m3-svelte had it (for reference) |
|---|---|---|---|
| Button (filled, tonal, outlined, text) | `Button` (thin) | styles | yes |
| IconButton | `Button` | styles, required `aria-label` | yes (`iconType="full"`) |
| Segmented button | `ToggleGroup` | styles | `ConnectedButtons` |
| Slider | `Slider` | styles | yes |
| Switch | `Switch` | styles | yes |
| Radio | `RadioGroup` | styles | yes |
| Checkbox | `Checkbox` | styles | yes |
| TextField | `Label` only | **yes**: native `<input>` / `<textarea>`, label, supporting and error text with `aria-describedby` | yes |
| Menu | `DropdownMenu` (and `ContextMenu`) | styles | styling only |
| Dialog | `Dialog`, `AlertDialog` | styles | yes |
| Bottom sheet | `Dialog` | styles; **drag-to-dismiss** gesture with a keyboard-reachable close | yes |
| Side sheet | `Dialog` | styles | standard (non-modal) only |
| Navigation bar | — | **yes**: links with `aria-current` (small) | yes |
| Navigation rail | — | **yes**: as above | yes |
| Snackbar | — | **yes**: a queue with a `role="status"` live region and an optional action | yes |
| Card | — | **yes**: plain markup | yes |
| Chip | `Toggle` / `ToggleGroup` (filter chips) | assist and input chips | yes |
| Tabs | `Tabs` | styles | yes |
| Progress indicator | `Progress` (and `Meter`) | styles (linear and circular) | yes |
| Tooltip | `Tooltip` | styles; never the only way to reach information (§11.5: nothing depends on hover) | no |

Bits UI has a primitive for 15 of the 20; the other 5 (TextField, Navigation bar, Navigation rail, Snackbar, Card) are mostly simple markup and live regions. Every component gets: `min-height: var(--touch-target)` or an expanded hit area; a `:focus-visible` ring in `--md-sys-color-secondary`; animation turned off under `prefers-reduced-motion`; a forced-colours fallback; and component tests (keyboard, focus and reduced motion) with @testing-library/svelte, as the plan requires. Import boundaries are unchanged: `bits-ui` is imported only inside `packages/ui`, and the app imports `@book/ui`.

### Dependencies and clean-up

- **Added for the spike** (`apps/web`, exact versions):
  - `@material/material-color-utilities` 0.4.0: theme generation; kept, and moves to `packages/tokens` in P1-UI-01.
  - `bits-ui` 2.19.3 and its peer `@internationalized/date` 3.12.4: the recommended option; they move to `packages/ui` in P1-UI-02.
  - `m3-svelte` 7.2.1 and `vite-plugin-functions-mixins` 0.4.1 (dev dependency): the option being evaluated.
- **When the spike code is deleted** (end of Phase 0.2), remove whichever library loses: under this recommendation, `m3-svelte` and `vite-plugin-functions-mixins`, together with the `SPIKE P0-10` lines in `apps/web/vite.config.ts` (the plugin, the path workaround and `optimizeDeps.exclude`). After that, no `--legacy-peer-deps` is needed.
- `apps/web/e2e/spike-components.spec.ts` is deleted with the spike. Its checks become component tests in P1-UI-02.
- The tester build also serves `/spike/components`, because spike routes aren't behind a feature flag. That is harmless and goes when the spike code goes.
