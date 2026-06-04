/*
 * Host entry. Viewport is content-agnostic; this file supplies the content:
 * the fourfour design system (tokens + primitives) and the auto-discovered
 * artboards. Everything else lives in ./engine.
 */
import './design-system/index.js';
import { createViewport } from './engine/index.js';

// Auto-discovery registry: every *.artboard.js under src/artboards.
const modules = { ...import.meta.glob('./artboards/**/*.artboard.js', { eager: true }) };
const modulePaths = Object.keys(modules);

function artboardId(path) {
  return path.split('/').pop().replace('.artboard.js', '');
}

function createRegistry(sourceModules) {
  return Object.entries(sourceModules).map(([path, mod]) => {
    const id = path.split('/').pop().replace('.artboard.js', '');
    return {
      id,
      sourceTitle: mod.meta?.title ?? id,
      layer: mod.meta?.layer ?? 'primitive',
      render: mod.default,
    };
  });
}

const viewportApp = createViewport({
  mount: document.getElementById('viewport'),
  registry: createRegistry(modules),
  storageNamespace: 'viewport',
  defaultProjectName: 'fourfour',
  layers: [
    { key: 'primitive', label: 'Primitives' },
    { key: 'module', label: 'Modules' },
    { key: 'composite', label: 'Composites' },
  ],
});

if (import.meta.hot) {
  import.meta.hot.accept(modulePaths, (updatedModules) => {
    const changedIds = [];
    updatedModules.forEach((mod, index) => {
      if (!mod) return;
      const path = modulePaths[index];
      modules[path] = mod;
      changedIds.push(artboardId(path));
    });
    viewportApp.updateRegistry(createRegistry(modules), { changedIds });
  });
}
