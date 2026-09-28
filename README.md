# Webdeck

A presenter for Claude Design slide decks (and PDFs). It shows exactly what the deck renders, with
presenter tools on the level of PowerPoint's, and no browser chrome anywhere near the audience.

- **Audience window**: frameless, locked to the deck's aspect ratio, and draggable anywhere
  (QuickTime-style). Double-click for fullscreen. Window-share it on a call or fullscreen it on a
  projector.
- **Presenter window**: live preview (interactive: clicks, scrolling, and typing reach the slide),
  a slide list, elapsed and per-slide timers, "up next", Markdown speaker notes, and the deck's
  **Tweaks** as presenter-only controls.
- Laser pointer (**L**), black/white screen (**B**/**W**, or **.**/**,**), audience fullscreen
  (**F**), and jump-to-slide (type the number, then **Enter**). Clicker keys (PgUp/PgDn) work in
  either window.
- Stateless: launch → Open dialog → present. A `.zip` holding several decks gets a picker with
  rendered covers. `.pdf` files (e.g. Beamer) open the same way.

```sh
pnpm install
pnpm dev                 # electron-vite + TanStack Start dev server
pnpm check               # typecheck, oxlint, oxfmt --check, vitest
pnpm dist:mac            # arm64 .dmg/.zip → dist/
pnpm dist:win            # x64 portable .exe + .msi → dist/ (needs Windows; see packaging notes)
pnpm smoke deck.zip      # end-to-end run on the real GPU path; screenshots → out/smoke/
```

## How it works

```
                ┌──────────── main process ────────────┐
 deck.zip ─────▶│ DeckFiles (yauzl, lazy, no extraction)│
                │   └─ deck://<mount>/…  protocol       │
                │                                        │
                │ LiveStage ── StageHost (offscreen,     │   GPU shared texture
                │   │           isolated, sandboxed) ────┼──┬──▶ audience window  (canvas)
                │   │  paint → importSharedTexture       │  └──▶ presenter preview (canvas)
                │   └─ FrameFanout (ref-counted, per-    │        same pixels, zero copies
                │       sink backpressure)               │
                │ SlideThumbnailer ── StageHost (CPU,    │──▶ slide list / up next (JPEG)
                │                     animations frozen) │
                │ PresentationSession · AppController    │◀─▶ typed IPC (src/shared/ipc.ts)
                └────────────────────────────────────────┘
```

**Layers** (each talks only to the one below it, through a small typed interface):

| Layer                       | Where                                      | Knows about                                                                   |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| Shared model and pure logic | `src/shared/`                              | Decks, tweaks, input, the IPC and stage protocols. No Electron. Unit-tested.  |
| Deck sources                | `src/main/deck/`, `src/main/protocol/`     | Archives and files → `deck://` URLs                                           |
| Stage                       | `src/main/stage/`                          | One offscreen web context: load, drive, input, frames. Nothing about windows. |
| Session / controller        | `src/main/session.ts`, `app-controller.ts` | Glue: stage ↔ windows ↔ state                                                 |
| Driver (in the slide page)  | `src/preload/stage*.ts`                    | Adapts `<deck-stage>` (or a plain page) to the stage protocol                 |
| UI                          | `src/renderer/`                            | TanStack Start (SPA mode) + shadcn/ui. Renders state; sends commands.         |

- **The slide page owns the truth.** The host sends commands (`goTo`, `step`, `setTweaks`) and the
  driver reports what actually happened (`slide`, `changed`). A link or script inside the deck that
  navigates keeps everything in sync.
- **Double-buffered reloads.** Anything that needs a reload (a resolution change, an EDITMODE tweak)
  loads a second stage off to the side, waits for it to settle, then swaps atomically, so the
  audience never sees a blank frame.
- **Frames.** Offscreen paint → `sharedTexture.importSharedTexture` → `sendSharedTexture` to each
  window → a `VideoFrame` drawn to a canvas. The fanout gives each window at most one pending frame
  (newer frames replace it), so a slow window drops frames rather than exhausting Chromium's small
  OSR texture pool. If the GPU path is unavailable, it falls back to CPU JPEG frames.
- **Resolution.** The stage lays out at the deck's design size (1920×1080 for Claude Design) with a
  device scale factor chosen for the largest attached display, so text stays sharp on 4K.

## What's inside a Claude Design export

Findings from reverse-engineering `example-deck.zip`, which is what the driver relies on:

- **Structure.** `<Name>.dc.html` is a _Design Component_ page. `support.js` is the `x-dc` runtime,
  which loads React 18 UMD from unpkg and renders the `<x-dc>` template. `deck-stage.js` defines
  `<deck-stage>`; `_ds/` holds the design system; `assets/` and `uploads/` hold media. `.thumbnail`
  is a WebP of the project.
- **Pagination.** `<deck-stage width height>` holds one `<section>` per slide. All slides stay mounted,
  and the inactive ones are hidden. The active slide gets `[data-deck-active]`. It has a public API
  (`goTo`, `next`, `prev`, `index`, `length`, `designWidth`/`designHeight`) and fires a `slidechange`
  event. `#N` in the URL restores slide N on load. `data-deck-skip` marks skipped slides.
  The `__omelette_presenting` message and the `no-rail` attribute hide its editor chrome; the driver
  also removes the nav overlay and the slide-edge ring from its shadow root.
- **Notes.** Stored per slide in `data-speaker-notes`, falling back to a
  `<script id="speaker-notes">` JSON array.
- **Animations.** There are no slide transitions: switching slides is instant. Entrance animations
  are CSS gated on `[data-deck-active]`, so they replay each time a slide is entered. Thumbnails
  freeze all animations and transitions at their end state.
- **Tweaks.** In `.dc.html` they're root-component props, declared as JSON in
  `<script data-dc-script data-props='{"key":{"default":…}}'>`. The runtime exposes them as
  `__dcRegistry[root].propsMeta` and applies them live via `window.__dcSetProps(root, values)`, which
  is how Webdeck drives them. Older HTML decks keep a
  `/*EDITMODE-BEGIN*/{…}/*EDITMODE-END*/` block of defaults and have no live setter. Webdeck rewrites
  that block as the file is served and reloads the stage (double-buffered). The deck's own Tweaks
  panel is never activated, so it never appears on a slide.

## PDFs

PDFs render in Chromium's built-in viewer inside the same offscreen stage. The viewer lives in a
cross-origin extension frame, so main drives it directly (`src/main/stage/pdf-viewer-driver.ts`):
it zooms so a page exactly fills the viewport, navigates with `viewport_.goToPage`, and hides
scrollbars. That's the viewer's internal API, not a public one. It's verified against the Chromium
in Electron 44, so recheck it when upgrading Electron.

## Releases

- **CI** (`.github/workflows/ci.yml`) runs on every PR and push to `main`: typecheck, oxlint,
  oxfmt, vitest, and a full build.
- **Release** (`.github/workflows/release.yml`) runs when you push a `v*` tag:

  ```sh
  git tag v0.2.0 && git push origin v0.2.0
  ```

  It builds on native runners and publishes a GitHub release with:

  | Platform    | Files                                                                                   |
  | ----------- | --------------------------------------------------------------------------------------- |
  | macOS arm64 | `Webdeck-<v>-mac-arm64.dmg` (drag-to-install), `Webdeck-<v>-mac-arm64.zip` (the `.app`) |
  | Windows x64 | `Webdeck-<v>-win-x64.msi` (installer), `Webdeck-<v>-win-x64-portable.exe`               |

  The version comes from the tag, so `package.json` doesn't need bumping. Tags with a suffix
  (`v0.2.0-beta.1`) publish as prereleases. It can also be re-run from the Actions tab for an
  existing tag.

- macOS builds are **ad-hoc signed**, not notarized, so users right-click → Open the first time. To
  sign and notarize, add `CSC_LINK`/`CSC_KEY_PASSWORD` secrets, set `mac.identity`, and add the
  notarization settings.

## Packaging notes

- `pnpm build` runs `electron-vite build` (main, preloads) and then `vite build -c
vite.renderer.config.ts`. electron-vite's build runs only a single Vite environment, but TanStack
  Start needs its multi-environment `buildApp` (client plus a prerendered SPA shell).
- Sandboxed preloads must be single-file CJS, so `electron` is marked external. Otherwise the bundler
  inlines the npm stub, which just returns a path.
- Windows: the portable `.exe` and the `.msi` need NSIS and WiX, so they're built on Windows in CI.
  `pnpm dist:win:zip` cross-builds a plain zip from any OS.
