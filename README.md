# Viewport

Viewport is a tiny npm dev tool for prototyping UI on an infinite canvas.

It visualizes a simple modular UI philosophy:

```txt
primitives → modules → composites
````

Think Figma, but the mockups are already code.

Viewport is agent-first: not an editor, just the render engine. Projects own their artboards and design system; Viewport renders them as draggable DOM cards with persisted layout, camera state, and HMR.

## Install

```bash
npm install -D viewport
npx viewport init
npx viewport
```

## Project structure

```txt
viewport/
  artboards/
  design-system/
viewport.config.js
```

## Artboard

```js
import { Button } from '../design-system/button.js';

export const meta = { title: 'Button', layer: 'primitive' };

export default function render() {
  return Button({ children: 'Save' });
}
```

Every artboard exports `meta` and a default `render()` that returns one DOM element.

## Workflow

```txt
primitive  → Button
module     → Toolbar
composite  → EditorShell
```

Edit a primitive and every artboard using it updates live while the canvas keeps pan, zoom, and card positions.

## Authoring

Use tokens and CSS variables. Reuse primitives inside modules and composites. Keep project content inside `viewport/`.

```
```
