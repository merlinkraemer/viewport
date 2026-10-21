import { setEngineConfig, artboardGroup, LAYER_GROUPS, listPages } from './config.js';
import { createCanvas } from './canvas.js';
import { createSidebar, pageNodeKey } from './sidebar.js';
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
  const linkedPage = pageFromHash();
  if (linkedPage && linkedPage !== bootstrapDoc.ui.activePage && !bootstrapDoc.ui.expanded.includes(pageNodeKey(linkedPage))) {
    bootstrapDoc.ui.expanded.push(pageNodeKey(linkedPage));
  }
  bootstrapDoc.ui.activePage = resolvePage(linkedPage ?? bootstrapDoc.ui.activePage);
  reflectPage(bootstrapDoc.ui.activePage);
  const documentStore = createDocumentStore(bootstrapDoc);

  function selectPage(page, { expand = false } = {}) {
    const next = resolvePage(page);
    reflectPage(next);
    const { ui } = documentStore.get();
    const expandKey = expand && next && !ui.expanded.includes(pageNodeKey(next)) ? pageNodeKey(next) : null;
    if (ui.activePage === next && !expandKey) return;
    documentStore.mutate((draft) => {
      if (draft.ui.activePage !== next) {
        draft.ui.activePage = next;
        draft.ui.focusGroup = null;
      }
      if (expandKey) draft.ui.expanded.push(expandKey);
    });
  }

  function selectPageOf(artboardId) {
    const page = documentStore.get().artboards[artboardId]?.page;
    if (page && pages.length > 1) selectPage(page);
  }

  window.addEventListener('hashchange', () => {
    const page = pageFromHash();
    if (page) selectPage(page, { expand: true });
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
    onSelectPage: (page) => selectPage(page, { expand: true }),
    onToggleNode(key) {
      documentStore.mutate((draft) => {
        const expanded = new Set(draft.ui.expanded);
        if (!expanded.delete(key)) expanded.add(key);
        draft.ui.expanded = [...expanded];
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
      selectPageOf(artboardId);
      canvas.centerOn(artboardId);
    },
    onFocusGroup(group, { page, nodeKey } = {}) {
      if (page) selectPage(page);
      const next = documentStore.get().ui.focusGroup === group ? null : group;
      documentStore.mutate((draft) => {
        draft.ui.focusGroup = next;
        if (next && nodeKey && !draft.ui.expanded.includes(nodeKey)) draft.ui.expanded.push(nodeKey);
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
        const ids = orderedIds.filter((id) => draft.artboards[id]?.projectId === projectId);
        const slots = ids.map((id) => draft.artboards[id].sidebarOrder).sort((a, b) => a - b);
        ids.forEach((id, index) => {
          draft.artboards[id].sidebarOrder = slots[index];
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

    const registryById = new Map(activeRegistry.map((entry) => [entry.id, entry]));
    const noteCounts = new Map();
    (documentState.notes || []).forEach((note) => {
      const id = note.target?.artboardId;
      if (id) noteCounts.set(id, (noteCounts.get(id) || 0) + 1);
    });

    const archivedArtboards = [];
    const activePage = documentState.ui.activePage;
    Object.entries(documentState.artboards).forEach(([id, artboard]) => {
      if (artboard.orphaned) return;

      const regEntry = registryById.get(id);
      const layer = regEntry ? regEntry.layer : 'primitive';

      const modelEntry = {
        id,
        sourceTitle: artboard.sourceTitle,
        displayName: artboard.displayName,
        projectId: artboard.projectId,
        pinned: artboard.pinned && !artboard.archived,
        noteCount: noteCounts.get(id) || 0,
        sidebarOrder: artboard.sidebarOrder,
        layer,
        page: artboard.page,
        group: artboardGroup(regEntry || { layer }),
      };
      if (!artboard.archived) artboardsByProject[artboard.projectId]?.push(modelEntry);
      else if (!activePage || artboard.page === activePage) archivedArtboards.push(modelEntry);
    });

    Object.values(artboardsByProject).forEach((rows) => {
      rows.sort((a, b) => a.sidebarOrder - b.sidebarOrder);
    });
    archivedArtboards.sort((a, b) => a.id.localeCompare(b.id));

    const namedGroups = [...new Set(activeRegistry.map((entry) => entry.group).filter(Boolean))];
    return {
      pages,
      activePage,
      groupOrder: [...namedGroups, ...LAYER_GROUPS],
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
