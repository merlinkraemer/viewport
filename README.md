# Viewport

An infinite-canvas workspace for building and arranging **live, interactive UI components**.
Think Figma, but the cards are real code: pan, zoom, group widgets into projects, pin panels
side-by-side, annotate — and inspect everything natively in DevTools.

```bash
npm install
npm run dev          # web, http://localhost:5182
cargo tauri dev      # native window (from repo root, needs Rust toolchain)
```

## Two layers: engine vs. content

Viewport is split so the **canvas engine** is content-agnostic and reusable across host
projects (fourfour, graft_audio, …). A host supplies its own components; the engine never
imports them.

```
src/
  engine/          ← reusable canvas. NO imports from content. Pan/zoom (Konva-driven nav),
                     sidebar, pin-sidebar, document store, overlap-snapping, notes.
                     Ships tokens.css defaults; exposes createViewport().
  design-system/   ← host content: this project's primitives + token overrides
  artboards/       ← host content: *.artboard.js mockups, auto-discovered
  main.js          ← thin host: globs artboards, defines layers, calls createViewport()
```

### The engine API

```js
import { createViewport } from './engine/index.js';

createViewport({
  mount,             // container element
  registry,          // [{ id, sourceTitle, layer, render }]
  layers,            // taxonomy: [{ key: 'primitive', label: 'Primitives' }, ...]
  storageNamespace,  // localStorage key prefix, e.g. 'viewport'
});
```

The engine references `--ff-*` design tokens and ships defaults in `engine/tokens.css`. A host
overrides them by loading its own token sheet after the engine (load order wins). *(A future
`--vp-*` rename would fully neutralize the naming; deferred to avoid churn.)*

## The artboard contract

Every `src/artboards/**/*.artboard.js` is auto-discovered (`import.meta.glob`) — no registration.
Adding an artboard is adding a file.

```js
export const meta = { title: 'Track List', layer: 'module' };

export default function render() {
  const el = document.createElement('div');
  // build content with host primitives + tokens
  return el; // engine wraps it in a titled, draggable card
}
```

The filename (minus `.artboard.js`) is the artboard id. `layer` selects its sidebar group and
default canvas column, per the `layers` taxonomy the host passes in.

## Persistence

localStorage, keyed by `storageNamespace`. Holds projects, layout, pins, notes, sidebar width,
and manual drag overrides. Card overlaps snap apart on reload.
*(Native file-based storage via the Tauri backend is a planned follow-up.)*
