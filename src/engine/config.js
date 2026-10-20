/*
 * Engine runtime config. Set once by createViewport() before any store or
 * view is constructed; read at call-time everywhere else. Single-instance by
 * design — this is a prototyping harness, not a multi-canvas widget.
 */
let config = {
  // localStorage key prefix. All engine keys become `${namespace}:...`.
  storageNamespace: 'viewport',
  // Name of the auto-created starter project.
  defaultProjectName: 'Default',
  // Layer taxonomy: ordered. `key` matches an artboard's meta.layer; drives
  // the canvas column order and the sidebar group label.
  layers: [
    { key: 'primitive', label: 'Primitives' },
    { key: 'module', label: 'Modules' },
    { key: 'composite', label: 'Composites' },
  ],
};

export function setEngineConfig(partial = {}) {
  config = { ...config, ...partial };
}

/** Namespaced localStorage key, e.g. storageKey('document'). */
export function storageKey(suffix) {
  return `${config.storageNamespace}:${suffix}`;
}

export function getLayers() {
  return config.layers;
}

export function getDefaultProjectName() {
  return config.defaultProjectName;
}

export const LAYER_GROUPS = ['Primitives', 'Artboards'];

export function artboardGroup(entry) {
  if (entry?.group) return entry.group;
  return entry?.layer === 'primitive' ? LAYER_GROUPS[0] : LAYER_GROUPS[1];
}

/** Ordered layer keys, for canvas column placement. */
export function layerOrder() {
  return config.layers.map((l) => l.key);
}
