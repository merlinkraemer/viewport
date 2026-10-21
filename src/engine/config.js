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

export const FALLBACK_PAGE = { id: 'other', label: 'Other' };

function pageLabel(entry) {
  return typeof entry?.page === 'string' && entry.page.trim() ? entry.page.trim() : null;
}

export function pageId(entry) {
  const label = pageLabel(entry);
  const slug = label?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || FALLBACK_PAGE.id;
}

export function listPages(registry) {
  const pages = new Map();
  registry.forEach((entry) => {
    const id = pageId(entry);
    if (!pages.has(id)) pages.set(id, { id, label: pageLabel(entry) ?? FALLBACK_PAGE.label, count: 0 });
    pages.get(id).count += 1;
  });
  const fallback = pages.get(FALLBACK_PAGE.id);
  pages.delete(FALLBACK_PAGE.id);
  return fallback ? [...pages.values(), fallback] : [...pages.values()];
}

export function layerOrder() {
  return config.layers.map((l) => l.key);
}
