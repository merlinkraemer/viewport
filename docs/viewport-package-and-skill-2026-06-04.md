# Viewport as an installable package + authoring skill

**Date:** 2026-06-04
**Status:** draft

## Problem

Viewport today is a single Vite app: the engine, the fourfour design-system, and a
fixed set of `*.artboard.js` are all in one bundle, globbed at build time
(`import.meta.glob`). That doesn't match the actual goal — a tool you **install into
any project**, where the agent authors that project's UI elements and Viewport renders
them live.

Two concrete pains block this:

1. **No distribution model.** The engine can't be reused across projects without copying
   it, which defeats the whole reason it was extracted (fix the engine once, every
   project benefits).
2. **The canvas "resets" on hot reload.** Camera pan/zoom is never persisted, and no
   artboard module accepts HMR — so editing any element triggers a full page reload that
   re-inits the Konva stage. Card positions survive (localStorage), but the camera snaps
   back, so it *feels* like everything resets.

## Solution

Viewport becomes an **npm dev-dependency**, not an app:

- The **`viewport` package** ships the engine (`createViewport()`) + a Vite-based CLI.
  This is a versioned dependency in `node_modules`; bumping it updates every project.
- **Project-owned content** lives in a `viewport/` folder in the consuming project:
  `viewport/artboards/*.artboard.js`, `viewport/design-system/` (the project's own
  primitives + tokens), and `viewport.config.js`. Scaffolded by `npx viewport init`,
  **blank** — no seeded components; only the *method* is shared.
- `npx viewport` boots a Vite server pointed at that `viewport/` folder and opens the
  browser. Agent edits a file → HMR → canvas updates surgically.
- A **skill** (dropped by `init`) encodes the only thing that's universal: the
  primitive → module → composite method and token discipline, so "change a primitive →
  everything cascades" holds. No MCP — human eyeballs the canvas.

One install = one codebase. Multiple projects = multiple servers on different ports +
multiple browser tabs. No multi-project switcher.

The HMR pains are fixed independently and first, since they're quick wins and make the
whole live-authoring loop usable: persist camera state, and make artboard modules
`import.meta.hot.accept` so a single edited card re-renders in place.

## Out of scope

- **Tauri / desktop app.** Dropped entirely — a browser tab around `localhost` is enough.
- **MCP server.** Skill only for v1. Add a screenshot/validate MCP later *only if*
  human-eyeballs becomes the bottleneck.
- **`layout.json` in repo.** Persistence stays `localStorage` for v1. Layout-travels-with-
  code is a separate want; revisit when actually needed.
- **`--ff-*` → `--vp-*` token rename.** Engine still references `--ff-*`; host supplies
  them. Defer.
- **Migrating fourfour / graft_audio onto the package.** User is actively working in both;
  do not touch them.
- **Multi-codebase management UI inside Viewport.** Dissolved — one install per project.

## Slices

### s1: Persist + restore camera
- **outcome:** Reloading the page keeps the canvas exactly where you left it (pan + zoom).
- **depends_on:** none
- **likely_files:** `src/engine/canvas.js`, `src/engine/document-store.js`, `src/engine/config.js`
- **acceptance:**
  - [ ] Stage `{x, y, scale}` is written to a namespaced storage key on pan/zoom (debounced).
  - [ ] On `createViewport()` init, the stored camera is restored before first paint.
  - [ ] Hard reload → camera unchanged; no jump to default center/zoom.

### s2: Surgical HMR for artboards
- **outcome:** Editing one `*.artboard.js` re-renders only that card in place — no full page reload, camera and other cards untouched.
- **depends_on:** none
- **likely_files:** `src/main.js` (glob/registry), `src/engine/canvas.js` (per-card re-render path), `src/artboards/*.artboard.js`
- **acceptance:**
  - [ ] `import.meta.hot.accept` wired for artboard modules; Vite no longer escalates to full reload on artboard edits.
  - [ ] Editing an artboard's `render()` updates that card's DOM in place.
  - [ ] Camera position and all other cards are unchanged across the edit.

### s3: Package the engine + CLI shell
- **outcome:** `npx viewport` (run inside the viewport repo) boots the Vite server and shows the canvas via a real `bin`, with the engine exposed as the package entry.
- **depends_on:** none
- **likely_files:** `package.json` (`bin`, `exports`, deps), `bin/viewport.js` (new), `vite.config.js`, `src/engine/index.js`
- **acceptance:**
  - [ ] `package.json` exposes `createViewport` via `exports` and a `viewport` bin.
  - [ ] `bin/viewport.js` launches Vite (dev) programmatically and opens the browser.
  - [ ] Running the bin renders the existing canvas with no console errors.

### s4: Serve an external content folder
- **outcome:** `npx viewport` run in *another* folder renders that folder's `viewport/artboards` + `viewport/design-system`, driven by its `viewport.config.js`.
- **depends_on:** s3
- **likely_files:** `vite.config.js` (root from `cwd`), `bin/viewport.js`, a virtual host-entry module that globs `<cwd>/viewport/**`, config resolution loader
- **acceptance:**
  - [ ] Vite serves a virtual entry that globs the consuming project's `viewport/artboards/**/*.artboard.js`.
  - [ ] `viewport.config.js` (layers, storageNamespace, mount) is loaded from the project and passed to `createViewport`.
  - [ ] A throwaway sibling test folder with 2 artboards renders both on the canvas.

### s5: `npx viewport init` scaffold
- **outcome:** Running `init` in an empty project creates a blank, working `viewport/` setup that renders an example artboard.
- **depends_on:** s4
- **likely_files:** `bin/viewport.js` (init subcommand), `templates/` (new: `viewport.config.js`, `design-system/tokens.css`, `design-system/index.js` with `el()`, `artboards/example.artboard.js`, `SKILL.md`), `package.json` script injection
- **acceptance:**
  - [ ] `npx viewport init` writes the `viewport/` folder + config + dev script into `package.json`.
  - [ ] Scaffolded design-system is **blank** (tokens shell + `el()` helper + one example artboard only).
  - [ ] Fresh empty folder → `init` → `npx viewport` → example artboard visible, no errors.
  - [ ] The authoring skill (s6) is dropped into the project by `init`.

### s6: Authoring skill (primitive → module → composite)
- **outcome:** A skill doc that teaches an agent to build UI as composed primitives with token-only styling, so changing a primitive cascades everywhere.
- **depends_on:** none
- **likely_files:** `templates/SKILL.md` (new), `docs/`
- **acceptance:**
  - [ ] Skill states the rules: import & call primitives (never re-implement markup), style only via token CSS vars, artboard file shape (`meta` + `default render()`), the three layers.
  - [ ] Includes a minimal worked example: token → primitive → module → composite → artboard.
  - [ ] Following it, editing a primitive visibly cascades to every consuming artboard via HMR.

## Dependency graph

```
s1 → (none)
s2 → (none)
s3 → s4
s4 → s5
s6 → (none)
```

## Parallel batches

- **Batch 1** (independent): s1, s2, s3, s6
- **Batch 2** (after s3): s4
- **Batch 3** (after s4, with s6 done): s5

## Notes

- **Camera storage key:** reuse the `storageKey()` namespacing from `config.js` (e.g.
  `storageKey('camera')`). Verified in code: `canvas.js` reads/writes `stage.scaleX()` /
  `stage.x()` during interaction but never persists them; `grep` for `import.meta.hot`
  returns nothing — so s1 and s2 are genuinely just-not-done, not broken.
- **The glob relocation (s4) is the real engineering.** `import.meta.glob` is resolved
  relative to the module that calls it. Today that's `src/main.js` inside the package.
  To glob the *consumer's* folder, the host entry must be a **virtual module** (Vite
  `virtual:` plugin) that globs an absolute path under `process.cwd()/viewport`, or the
  Vite `root` is set to the consumer and the package is a linked dep. Decide this in s4;
  it's the load-bearing trick that makes "installed package serves project content" work.
- **Blank design-system contract:** the scaffolded `design-system/index.js` must export
  at least `el()` (the DOM helper the engine and artboards rely on) so the example
  artboard runs with zero hand-written components.
- **Engine still references `--ff-*` tokens.** For a blank project the scaffolded
  `tokens.css` must define whatever `--ff-*` vars the *engine itself* uses (sidebars,
  cards, canvas chrome), separate from the project's own component tokens. Worth auditing
  which `--ff-*` vars the engine hard-depends on during s4/s5. (Token rename is out of
  scope, but the engine's required vars must ship in the scaffold or the canvas chrome
  renders unstyled.)
- localStorage is per-origin, so multiple projects on different ports are already
  isolated — no namespace collision work needed beyond what `config.js` does.
