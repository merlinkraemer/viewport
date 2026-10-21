import { setEngineConfig, artboardGroup, LAYER_GROUPS, listPages, pageId } from './config.js';
import { createCanvas } from './canvas.js';
import { createSidebar } from './sidebar.js';
import { createPinSidebar } from './pin-sidebar.js';
import { loadInitialDocument, createDocumentStore } from './document-store.js';
import { showTextDialog } from './sidebar-context-menu.js';
import { getPrimaryArtboardNote, upsertArtboardPrimaryNote } from './notes.js';
import { copyText } from './dom.js';

export { setEngineConfig };

/**
 * @param {object}  opts
 * @param {Element} opts.mount             container for the canvas viewport
 * @param {Array}   opts.registry          [{ id, sourceTitle, layer, render, file?, group?, page? }]
 * @param {Array}   [opts.layers]          taxonomy [{ key, label }]
 * @param {string}  [opts.storageNamespace]
 * @param {string}  [opts.defaultProjectName]
 * @param {object}  [opts.build]           review build stamp { sha, dirty, builtAt, hash }; null in dev
 * @returns {{ documentStore, canvas, sidebar, pinSidebar, updateRegistry }}
 */
export function createViewport({
  mount,
  registry,
  layers,
  storageNamespace,
  defaultProjectName,
  build = null,
} = {}) {
  if (!mount) throw new Error('createViewport: `mount` element is required');
  if (!Array.isArray(registry)) throw new Error('createViewport: `registry` array is required');
  const activeRegistry = registry.slice();

  setEngineConfig({
    ...(layers ? { layers } : {}),
    ...(storageNamespace ? { storageNamespace } : {}),
    ...(defaultProjectName ? { defaultProjectName } : {}),
  });

  let pages = listPages(activeRegistry);
  const baseTitle = document.title;

  function hashPage() {
    return decodeURIComponent(window.location.hash.slice(1)).split(/[/?]/)[0];
  }

  function pageFromHash() {
    const slug = hashPage();
    return pages.some((page) => page.id === slug) ? slug : null;
  }

  function resolvePage(preferred) {
    if (pages.length < 2) return null;
    if (pages.some((page) => page.id === preferred)) return preferred;
    return pages[0].id;
  }

  function reflectPage(page) {
    const label = pages.find((entry) => entry.id === page)?.label;
    document.title = label ? `${label} · ${baseTitle}` : baseTitle;
    if (page && hashPage() !== page) {
      const url = new URL(window.location.href);
      url.hash = page;
      window.history.replaceState(null, '', url);
    }
  }

  const bootstrapDoc = loadInitialDocument(activeRegistry);
  bootstrapDoc.ui.activePage = resolvePage(pageFromHash() ?? bootstrapDoc.ui.activePage);
  reflectPage(bootstrapDoc.ui.activePage);
  const documentStore = createDocumentStore(bootstrapDoc);

  function selectPage(page) {
    const next = resolvePage(page);
    reflectPage(next);
    if (documentStore.get().ui.activePage === next) return;
    documentStore.mutate((draft) => {
      draft.ui.activePage = next;
      draft.ui.focusGroup = null;
    });
  }

  window.addEventListener('hashchange', () => {
    const page = pageFromHash();
    if (page) selectPage(page);
  });

  const pinSidebar = createPinSidebar({
    onLayoutChange(width, pinned, meta) {
      canvas.onSidebarLayoutChange(width, pinned, meta);
    },
  });
  document.body.appendChild(pinSidebar.element);

  const canvas = createCanvas({
    viewport: mount,
    documentStore,
    pinSidebar,
    registry: activeRegistry,
    onSelectActiveArtboard: (id) => sidebar.setActiveArtboard(id),
  });

  const sidebar = createSidebar({
    build,
    onSelectPage: selectPage,
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
    onFocusGroup(group) {
      const next = documentStore.get().ui.focusGroup === group ? null : group;
      documentStore.mutate((draft) => {
        draft.ui.focusGroup = next;
      });
      if (next) canvas.fitGroup(next);
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
      if (!options.extended) {
        canvas.copyIds([artboardId]);
        return;
      }
      const project = state.projects.find((p) => p.id === artboard.projectId);
      const file = activeRegistry.find((entry) => entry.id === artboardId)?.file;
      const lines = [
        `Artboard: ${artboardId}`,
        `Name: ${artboard.displayName || artboard.sourceTitle}`,
        `Project: ${project?.name || artboard.projectId}`,
        ...(file ? [`File: ${file}`] : []),
      ];
      copyText(lines.join('\n'))
        .then(() => canvas.showCopyToast(`Copied ${artboardId}`))
        .catch((err) => canvas.showCopyToast(`Copy failed: ${err.message}`));
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

  function buildSidebarModel(documentState) {
    const artboardsByProject = {};
    documentState.projects.forEach((project) => {
      artboardsByProject[project.id] = [];
    });

    const archivedArtboards = [];
    const activePage = documentState.ui.activePage;
    Object.entries(documentState.artboards).forEach(([id, artboard]) => {
      if (artboard.orphaned) return;
      if (activePage && artboard.page !== activePage) return;

      const regEntry = activeRegistry.find((r) => r.id === id);
      const layer = regEntry ? regEntry.layer : 'primitive';
      const group = artboardGroup(regEntry || { layer });

      const modelEntry = {
        id,
        sourceTitle: artboard.sourceTitle,
        displayName: artboard.displayName,
        projectId: artboard.projectId,
        pinned: artboard.pinned && !artboard.archived,
        noteCount: (documentState.notes || []).filter((n) => n.target?.artboardId === id).length,
        sidebarOrder: artboard.sidebarOrder,
        layer,
        group,
      };
      if (artboard.archived) archivedArtboards.push(modelEntry);
      else artboardsByProject[artboard.projectId]?.push(modelEntry);
    });

    Object.values(artboardsByProject).forEach((rows) => {
      rows.sort((a, b) => a.sidebarOrder - b.sidebarOrder);
    });
    archivedArtboards.sort((a, b) => a.id.localeCompare(b.id));

    const pageRegistry = activePage ? activeRegistry.filter((entry) => pageId(entry) === activePage) : activeRegistry;
    const namedGroups = [...new Set(pageRegistry.map((entry) => entry.group).filter(Boolean))];
    return {
      pages,
      activePage,
      groups: [...namedGroups, ...LAYER_GROUPS],
      hideEmptyGroups: namedGroups.length > 0,
      focusGroup: documentState.ui.focusGroup,
      projects: documentState.projects,
      activeProjectId: documentState.ui.activeProjectId,
      artboardsByProject,
      archivedArtboards,
      ui: documentState.ui,
    };
  }

  documentStore.subscribe((state) => {
    canvas.render(state);
    sidebar.render(buildSidebarModel(state));
  });

  const initialState = documentStore.get();
  canvas.render(initialState);
  sidebar.render(buildSidebarModel(initialState));

  setTimeout(() => documentStore.resolveOverlaps(), 200);

  function updateRegistry(nextRegistry, { changedIds } = {}) {
    if (!Array.isArray(nextRegistry)) throw new Error('updateRegistry: `nextRegistry` array is required');
    const idsToRefresh = changedIds || nextRegistry.map((entry) => entry.id);
    activeRegistry.splice(0, activeRegistry.length, ...nextRegistry);
    pages = listPages(activeRegistry);
    documentStore.syncRegistry(activeRegistry);
    const page = documentStore.get().ui.activePage;
    if (resolvePage(page) !== page) selectPage(page);
    canvas.refreshArtboards(idsToRefresh);
  }

  return { documentStore, canvas, sidebar, pinSidebar, updateRegistry };
}
