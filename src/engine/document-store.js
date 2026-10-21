import { storageKey, getDefaultProjectName, pageId } from './config.js';
import { layoutPages, LAYOUT_ORIGIN } from './layout.js';

const DOC_VERSION = 2;
const DEFAULT_PROJECT_ID = 'default';

const DEFAULT_UI = {
  leftSidebarOpen: true,
  leftSidebarWidth: 220,
  pinPanelOpen: true,
  pinPanelWidth: 280,
  activeProjectId: DEFAULT_PROJECT_ID,
  focusGroup: null,
  activePage: null,
  expanded: [],
  layoutVersion: 1,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function nowIso() {
  return new Date().toISOString();
}

function slugify(input) {
  const base = String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'project';
}

export function createEmptyDocument() {
  return {
    version: DOC_VERSION,
    projects: [
      {
        id: DEFAULT_PROJECT_ID,
        name: getDefaultProjectName(),
        collapsed: false,
        frame: { x: 0, y: 0 },
        createdAt: nowIso(),
      },
    ],
    artboards: {},
    notes: [],
    ui: { ...DEFAULT_UI },
  };
}

function ensureDefaultProject(doc) {
  const hasDefault = doc.projects.some((project) => project.id === DEFAULT_PROJECT_ID);
  if (!hasDefault) {
    doc.projects.unshift({
      id: DEFAULT_PROJECT_ID,
      name: getDefaultProjectName(),
      collapsed: false,
      frame: { x: 0, y: 0 },
      createdAt: nowIso(),
    });
  }
}

function normalizeProject(project) {
  return {
    id: typeof project?.id === 'string' && project.id ? project.id : slugify(project?.name || 'project'),
    name: typeof project?.name === 'string' && project.name ? project.name : 'Untitled Project',
    collapsed: Boolean(project?.collapsed),
    frame: {
      x: Number.isFinite(project?.frame?.x) ? project.frame.x : 0,
      y: Number.isFinite(project?.frame?.y) ? project.frame.y : 0,
    },
    createdAt: typeof project?.createdAt === 'string' ? project.createdAt : nowIso(),
  };
}

function normalizeUi(ui) {
  return {
    leftSidebarOpen: ui?.leftSidebarOpen !== false,
    leftSidebarWidth: Number.isFinite(ui?.leftSidebarWidth) ? Math.max(160, Math.min(600, ui.leftSidebarWidth)) : DEFAULT_UI.leftSidebarWidth,
    pinPanelOpen: ui?.pinPanelOpen !== false,
    pinPanelWidth: Number.isFinite(ui?.pinPanelWidth) ? Math.max(220, Math.min(800, ui.pinPanelWidth)) : DEFAULT_UI.pinPanelWidth,
    activeProjectId: typeof ui?.activeProjectId === 'string' && ui.activeProjectId ? ui.activeProjectId : DEFAULT_PROJECT_ID,
    focusGroup: typeof ui?.focusGroup === 'string' && ui.focusGroup ? ui.focusGroup : null,
    activePage: typeof ui?.activePage === 'string' && ui.activePage ? ui.activePage : null,
    expanded: Array.isArray(ui?.expanded) ? [...new Set(ui.expanded.filter((key) => typeof key === 'string'))] : [],
    showReviewed: ui?.showReviewed === true,
    layoutVersion: Number.isFinite(ui?.layoutVersion) ? ui.layoutVersion : DEFAULT_UI.layoutVersion,
  };
}

function normalizeNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes
    .filter((note) => note && note.target?.type === 'artboard' && typeof note.target.artboardId === 'string')
    .map((note) => ({
      id: typeof note.id === 'string' && note.id ? note.id : `note-${Math.random().toString(16).slice(2)}`,
      target: { type: 'artboard', artboardId: note.target.artboardId },
      text: typeof note.text === 'string' ? note.text : '',
      canvasOffset: {
        x: Number.isFinite(note.canvasOffset?.x) ? note.canvasOffset.x : 8,
        y: Number.isFinite(note.canvasOffset?.y) ? note.canvasOffset.y : -32,
      },
      createdAt: typeof note.createdAt === 'string' ? note.createdAt : nowIso(),
      updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : nowIso(),
    }));
}

function normalizeArtboard(id, artboard, projectIds) {
  const fallbackProjectId = projectIds.has(DEFAULT_PROJECT_ID)
    ? DEFAULT_PROJECT_ID
    : [...projectIds][0];
  const projectId = typeof artboard?.projectId === 'string' && projectIds.has(artboard.projectId)
    ? artboard.projectId
    : fallbackProjectId;
  return {
    sourceTitle: typeof artboard?.sourceTitle === 'string' && artboard.sourceTitle
      ? artboard.sourceTitle
      : id,
    displayName: typeof artboard?.displayName === 'string' && artboard.displayName.trim()
      ? artboard.displayName.trim()
      : null,
    projectId,
    position: {
      x: Number.isFinite(artboard?.position?.x) ? artboard.position.x : 24,
      y: Number.isFinite(artboard?.position?.y) ? artboard.position.y : 48,
    },
    size: artboard?.size && Number.isFinite(artboard.size.width) && Number.isFinite(artboard.size.height)
      ? { width: artboard.size.width, height: artboard.size.height }
      : null,
    archived: Boolean(artboard?.archived),
    pinned: Boolean(artboard?.pinned),
    sidebarOrder: Number.isFinite(artboard?.sidebarOrder) ? artboard.sidebarOrder : 0,
    moved: Boolean(artboard?.moved),
    orphaned: Boolean(artboard?.orphaned),
    page: typeof artboard?.page === 'string' && artboard.page ? artboard.page : null,
  };
}

function normalizeSidebarOrder(doc) {
  const projectIds = doc.projects.map((project) => project.id);
  projectIds.forEach((projectId) => {
    const ids = Object.keys(doc.artboards)
      .filter((id) => doc.artboards[id].projectId === projectId)
      .sort((a, b) => doc.artboards[a].sidebarOrder - doc.artboards[b].sidebarOrder);
    ids.forEach((id, index) => {
      doc.artboards[id].sidebarOrder = index;
    });
  });
}

function ensureSinglePin(doc) {
  const pinned = Object.keys(doc.artboards).filter((id) => doc.artboards[id].pinned && !doc.artboards[id].archived);
  if (pinned.length <= 1) return;
  pinned.slice(1).forEach((id) => {
    doc.artboards[id].pinned = false;
  });
}

function ensureVisibleRegistryArtboards(doc, registry) {
  const registryIds = registry.map((entry) => entry.id);
  const visibleCount = registryIds.filter((id) => {
    const artboard = doc.artboards[id];
    return artboard && !artboard.archived && !artboard.orphaned;
  }).length;

  if (visibleCount > 0) return;

  registryIds.forEach((id, index) => {
    const artboard = doc.artboards[id];
    if (!artboard) return;
    artboard.archived = false;
    artboard.orphaned = false;
    if (!Number.isFinite(artboard.sidebarOrder)) {
      artboard.sidebarOrder = index;
    }
  });
}

function migrateFromV1(raw) {
  const ui = raw.ui && typeof raw.ui === 'object' ? raw.ui : {};
  const artboards = raw.artboards && typeof raw.artboards === 'object' ? raw.artboards : {};
  return {
    version: DOC_VERSION,
    projects: Array.isArray(raw.projects)
      ? raw.projects.map((project) => ({ ...project, collapsed: false }))
      : [],
    artboards: Object.fromEntries(Object.entries(artboards).map(([id, artboard]) => [id, {
      displayName: artboard?.displayName,
      projectId: artboard?.projectId,
      archived: artboard?.archived,
      pinned: artboard?.pinned,
    }])),
    notes: raw.notes,
    ui: {
      leftSidebarOpen: ui.leftSidebarOpen,
      leftSidebarWidth: ui.leftSidebarWidth,
      pinPanelOpen: ui.pinPanelOpen,
      pinPanelWidth: ui.pinPanelWidth,
    },
  };
}

function clearStoredCameras() {
  const prefix = storageKey('camera');
  Object.keys(localStorage)
    .filter((key) => key === prefix || key.startsWith(`${prefix}:`))
    .forEach((key) => localStorage.removeItem(key));
}

export function migrateDocument(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw !== null) console.warn('viewport: saved state is not a document; starting fresh');
    clearStoredCameras();
    return null;
  }
  if (raw.version === DOC_VERSION) return raw;
  if (raw.version === 1 || raw.version === undefined) {
    console.warn(`viewport: saved state is from an older version (v${raw.version ?? 0}); keeping names, pins and archive, resetting layout and view`);
    clearStoredCameras();
    return migrateFromV1(raw);
  }
  console.warn(`viewport: saved state has unknown version ${raw.version}; starting fresh`);
  clearStoredCameras();
  return null;
}

export function clearStoredState() {
  try {
    const prefix = storageKey('');
    Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => localStorage.removeItem(key));
  } catch (err) {
    console.warn('viewport: could not clear saved state', err);
  }
}

export function normalizeDocument(raw) {
  const base = raw && typeof raw === 'object' ? raw : createEmptyDocument();
  const doc = {
    version: DOC_VERSION,
    projects: Array.isArray(base.projects) ? base.projects.map(normalizeProject) : [],
    artboards: {},
    notes: normalizeNotes(base.notes),
    ui: normalizeUi(base.ui),
  };

  ensureDefaultProject(doc);

  const projectIds = new Set(doc.projects.map((project) => project.id));
  const rawArtboards = base.artboards && typeof base.artboards === 'object' ? base.artboards : {};
  Object.keys(rawArtboards).forEach((id) => {
    doc.artboards[id] = normalizeArtboard(id, rawArtboards[id], projectIds);
  });

  if (!projectIds.has(doc.ui.activeProjectId)) {
    doc.ui.activeProjectId = DEFAULT_PROJECT_ID;
  }

  normalizeSidebarOrder(doc);
  ensureSinglePin(doc);
  return doc;
}

function getProjectArtboardCount(doc, projectId) {
  return Object.values(doc.artboards).filter((entry) => entry.projectId === projectId).length;
}

function syncRegistry(doc, registry) {
  const projectIds = new Set(doc.projects.map((project) => project.id));
  registry.forEach((entry) => {
    if (!doc.artboards[entry.id]) {
      const projectId = projectIds.has(doc.ui.activeProjectId) ? doc.ui.activeProjectId : DEFAULT_PROJECT_ID;
      doc.artboards[entry.id] = {
        sourceTitle: entry.sourceTitle,
        displayName: null,
        projectId,
        position: { ...LAYOUT_ORIGIN },
        size: null,
        archived: false,
        pinned: false,
        sidebarOrder: getProjectArtboardCount(doc, projectId),
        moved: false,
        orphaned: false,
        page: pageId(entry),
      };
      return;
    }
    doc.artboards[entry.id].sourceTitle = entry.sourceTitle;
    doc.artboards[entry.id].orphaned = false;
    doc.artboards[entry.id].page = pageId(entry);
  });

  const registryIds = new Set(registry.map((entry) => entry.id));
  Object.keys(doc.artboards).forEach((id) => {
    if (!registryIds.has(id)) {
      doc.artboards[id].orphaned = true;
    }
    if (!projectIds.has(doc.artboards[id].projectId)) {
      doc.artboards[id].projectId = DEFAULT_PROJECT_ID;
    }
  });

  normalizeSidebarOrder(doc);
  ensureSinglePin(doc);
  ensureVisibleRegistryArtboards(doc, registry);
  layoutPages(doc, registry);
  return doc;
}

function buildDocument(raw, registry) {
  return normalizeDocument(syncRegistry(normalizeDocument(raw ?? createEmptyDocument()), registry));
}

export function loadInitialDocument(registry) {
  let finalDoc;
  try {
    const data = localStorage.getItem(storageKey('document'));
    finalDoc = buildDocument(migrateDocument(data ? JSON.parse(data) : null), registry);
  } catch (err) {
    console.warn('viewport: saved state could not be read; starting fresh', err);
    clearStoredState();
    finalDoc = buildDocument(null, registry);
  }

  try {
    localStorage.setItem(storageKey('document'), JSON.stringify(finalDoc));
  } catch (err) {
    console.error('Failed to write initialized canvas document', err);
  }

  return finalDoc;
}

export function createDocumentStore(initialDoc) {
  let doc = clone(initialDoc);
  const listeners = new Set();
  let hasPendingSave = false;

  const saveDebounced = debounce(() => {
    if (!hasPendingSave) return;
    hasPendingSave = false;
    try {
      localStorage.setItem(storageKey('document'), JSON.stringify(doc));
    } catch (err) {
      console.error('Failed to persist canvas document mutation', err);
    }
  }, 400);

  function notify() {
    listeners.forEach((listener) => listener(clone(doc)));
  }

  function mutate(mutator, { persist = true } = {}) {
    const draft = clone(doc);
    mutator(draft);
    doc = normalizeDocument(draft);
    if (persist) {
      hasPendingSave = true;
      saveDebounced();
    }
    notify();
  }

  return {
    get() {
      return clone(doc);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mutate,
    syncRegistry(registry) {
      doc = normalizeDocument(syncRegistry(normalizeDocument(doc), registry));
      hasPendingSave = true;
      saveDebounced();
      notify();
    },
    saveNow() {
      hasPendingSave = false;
      try {
        localStorage.setItem(storageKey('document'), JSON.stringify(doc));
      } catch (err) {
        console.error('Failed to save document immediately', err);
      }
    },
    createProject(name) {
      const base = slugify(name);
      let id = base;
      let counter = 2;
      const projectIds = new Set(doc.projects.map((project) => project.id));
      while (projectIds.has(id)) {
        id = `${base}-${counter}`;
        counter += 1;
      }
      mutate((draft) => {
        const offset = draft.projects.length;
        draft.projects.push({
          id,
          name: name.trim() || 'Untitled Project',
          collapsed: false,
          frame: { x: 40 + offset * 40, y: 32 + offset * 24 },
          createdAt: nowIso(),
        });
      });
      return id;
    },
    relayout(registry) {
      mutate((draft) => {
        layoutPages(draft, registry);
      });
    },
  };
}
