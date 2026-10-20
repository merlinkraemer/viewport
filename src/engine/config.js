let config = {
  storageNamespace: 'viewport',
  defaultProjectName: 'Default',
  layers: [
    { key: 'primitive', label: 'Primitives' },
    { key: 'module', label: 'Modules' },
    { key: 'composite', label: 'Composites' },
  ],
};

export function setEngineConfig(partial = {}) {
  config = { ...config, ...partial };
}

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

export function layerOrder() {
  return config.layers.map((l) => l.key);
}
