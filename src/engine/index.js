/*
 * Viewport engine — public entry. A host calls createViewport() with its own
 * artboard registry; everything below (stores, canvas, sidebars, the wiring
 * between them) is content-agnostic. The host supplies WHAT to show; the
 * engine owns HOW it's shown, persisted, and navigated.
 */
import { setEngineConfig } from './config.js';
import { createCanvas } from './canvas.js';
import { createSidebar } from './sidebar.js';
import { createPinSidebar } from './pin-sidebar.js';
import { loadInitialDocument, createDocumentStore } from './document-store.js';
import { showTextDialog } from './sidebar-context-menu.js';
import { getPrimaryArtboardNote, upsertArtboardPrimaryNote } from './notes.js';

export { setEngineConfig };

/**
 * @param {object}  opts
 * @param {Element} opts.mount             container for the canvas viewport
 * @param {Array}   opts.registry          [{ id, sourceTitle, layer, render }]
 * @param {Array}   [opts.layers]          taxonomy [{ key, label }]
 * @param {string}  [opts.storageNamespace]
 * @param {string}  [opts.defaultProjectName]
 * @returns {{ documentStore, canvas, sidebar, pinSidebar, updateRegistry }}
 */
export function createViewport({
  mount,
  registry,
  layers,
  storageNamespace,
  defaultProjectName,
} = {}) {
  if (!mount) throw new Error('createViewport: `mount` element is required');
  if (!Array.isArray(registry)) throw new Error('createViewport: `registry` array is required');
  const activeRegistry = registry.slice();

  setEngineConfig({
    ...(layers ? { layers } : {}),
    ...(storageNamespace ? { storageNamespace } : {}),
    ...(defaultProjectName ? { defaultProjectName } : {}),
  });

  // Document + persistence
  const bootstrapDoc = loadInitialDocument(activeRegistry);
  const documentStore = createDocumentStore(bootstrapDoc);

  // Right pin sidebar
  const pinSidebar = createPinSidebar({
    onLayoutChange(width, pinned, meta) {
      canvas.onSidebarLayoutChange(width, pinned, meta);
    },
  });
  document.body.appendChild(pinSidebar.element);

  // Central canvas
  const canvas = createCanvas({
    viewport: mount,
    documentStore,
    pinSidebar,
    registry: activeRegistry,
    onSelectActiveArtboard: (id) => sidebar.setActiveArtboard(id),
  });

  // Left tree sidebar
  const sidebar = createSidebar({
    onCreateProject(name) {
      const newId = documentStore.createProject(name);
      if (!newId) return;
      documentStore.mutate((draft) => {
        draft.ui.activeProjectId = newId;
      });
    },
    onSelectActiveProject(projectId) {
      documentStore.mutate((draft) => {
        draft.ui.activeProjectId = projectId;
      });
    },
    onToggleProjectCollapse(projectId) {
      documentStore.mutate((draft) => {
        const project = draft.projects.find((item) => item.id === projectId);
        if (project) project.collapsed = !project.collapsed;
      });
    },
    onNavigateArtboard(artboardId) {
      canvas.centerOn(artboardId);
    },
    onRenameArtboard(artboardId, newName) {
      documentStore.mutate((draft) => {
        if (!draft.artboards[artboardId]) return;
        draft.artboards[artboardId].displayName = newName;
      });
    },
    onArchiveArtboard(artboardId) {
      documentStore.mutate((draft) => {
        if (!draft.artboards[artboardId]) return;
        draft.artboards[artboardId].archived = true;
        draft.artboards[artboardId].pinned = false;
      });
    },
    onRestoreArtboard(artboardId) {
      documentStore.mutate((draft) => {
        if (!draft.artboards[artboardId]) return;
        draft.artboards[artboardId].archived = false;
      });
    },
    onTogglePin(artboardId) {
      documentStore.mutate((draft) => {
        const pinned = Object.keys(draft.artboards).find((id) => draft.artboards[id].pinned && !draft.artboards[id].archived);
        Object.keys(draft.artboards).forEach((id) => {
          draft.artboards[id].pinned = false;
        });
        if (pinned !== artboardId && !draft.artboards[artboardId]?.archived) {
          draft.artboards[artboardId].pinned = true;
        }
      });
    },
    onCopyArtboard(artboardId, options = {}) {
      const state = documentStore.get();
      const artboard = state.artboards[artboardId];
      if (!artboard) return;
      const project = state.projects.find((p) => p.id === artboard.projectId);
      const displayName = artboard.displayName || artboard.sourceTitle;
      const text = options.extended
        ? `Artboard: ${artboardId}\nName: ${displayName}\nProject: ${project?.name || artboard.projectId}`
        : `${artboardId} - ${displayName}`;
      navigator.clipboard?.writeText(text).catch(() => {});
      canvas.showCopyToast(`Copied ${artboardId}`);
    },
    onMoveArtboardProject(artboardId, projectId) {
      documentStore.mutate((draft) => {
        const artboard = draft.artboards[artboardId];
        if (artboard) {
          artboard.projectId = projectId;
          artboard.sidebarOrder = Object.values(draft.artboards).filter((a) => a.projectId === projectId).length;
        }
      });
    },
    onEditArtboardNote(artboardId) {
      const state = documentStore.get();
      const note = getPrimaryArtboardNote(state, artboardId);
      showTextDialog({
        title: `Note: ${artboardId}`,
        initialValue: note?.text || '',
        placeholder: 'Add a note for this artboard...',
        confirmLabel: 'Save',
        onSubmit: (value) => {
          documentStore.mutate((draft) => {
            upsertArtboardPrimaryNote(draft, artboardId, value);
          });
        },
      });
    },
    onReorderProjectArtboards(projectId, orderedIds) {
      documentStore.mutate((draft) => {
        orderedIds.forEach((id, index) => {
          if (draft.artboards[id] && draft.artboards[id].projectId === projectId) {
            draft.artboards[id].sidebarOrder = index;
          }
        });
      });
    },
    onWidthChange(width) {
      documentStore.mutate((draft) => {
        draft.ui.leftSidebarWidth = width;
      });
    },
  });
  document.body.appendChild(sidebar.element);

  // Map document state → sidebar explorer model
  function buildSidebarModel(documentState) {
    const artboardsByProject = {};
    documentState.projects.forEach((project) => {
      artboardsByProject[project.id] = [];
    });

    const archivedArtboards = [];
    Object.entries(documentState.artboards).forEach(([id, artboard]) => {
      if (artboard.orphaned) return;

      const regEntry = activeRegistry.find((r) => r.id === id);
      const layer = regEntry ? regEntry.layer : 'primitive';

      const modelEntry = {
        id,
        sourceTitle: artboard.sourceTitle,
        displayName: artboard.displayName,
        projectId: artboard.projectId,
        pinned: artboard.pinned && !artboard.archived,
        noteCount: (documentState.notes || []).filter((n) => n.target?.artboardId === id).length,
        sidebarOrder: artboard.sidebarOrder,
        layer,
      };
      if (artboard.archived) archivedArtboards.push(modelEntry);
      else artboardsByProject[artboard.projectId]?.push(modelEntry);
    });

    Object.values(artboardsByProject).forEach((rows) => {
      rows.sort((a, b) => a.sidebarOrder - b.sidebarOrder);
    });
    archivedArtboards.sort((a, b) => a.id.localeCompare(b.id));

    return {
      projects: documentState.projects,
      activeProjectId: documentState.ui.activeProjectId,
      artboardsByProject,
      archivedArtboards,
      ui: documentState.ui,
    };
  }

  // Re-render on every mutation
  documentStore.subscribe((state) => {
    canvas.render(state);
    sidebar.render(buildSidebarModel(state));
  });

  // Initial render
  const initialState = documentStore.get();
  canvas.render(initialState);
  sidebar.render(buildSidebarModel(initialState));

  // Resolve card overlaps once layout has measured real card sizes
  setTimeout(() => documentStore.resolveOverlaps(), 200);

  function updateRegistry(nextRegistry, { changedIds } = {}) {
    if (!Array.isArray(nextRegistry)) throw new Error('updateRegistry: `nextRegistry` array is required');
    const idsToRefresh = changedIds || nextRegistry.map((entry) => entry.id);
    activeRegistry.splice(0, activeRegistry.length, ...nextRegistry);
    documentStore.syncRegistry(activeRegistry);
    canvas.refreshArtboards(idsToRefresh);
  }

  return { documentStore, canvas, sidebar, pinSidebar, updateRegistry };
}
