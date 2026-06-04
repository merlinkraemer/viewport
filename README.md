# Viewport

Installable infinite-canvas dev server for code-authored UI artboards.

```bash
npm install -D viewport
npx viewport init
npx viewport
```

Project content lives in `viewport/`:

- `viewport/artboards/*.artboard.js`
- `viewport/design-system/`
- `viewport.config.js`

Every artboard exports `meta` and a default `render()` function:

```js
export const meta = { title: 'Button', layer: 'primitive' };

export default function render() {
  return document.createElement('button');
}
```

The engine is imported as:

```js
import { createViewport } from 'viewport';
```
