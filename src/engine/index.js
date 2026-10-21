import { setEngineConfig, artboardGroup, listPages, sortGroups, groupLabel, shortTitle } from './config.js';
import { createCanvas } from './canvas.js';
import { createSidebar, pageNodeKey } from './sidebar.js';
import { createPinSidebar } from './pin-sidebar.js';
import { loadInitialDocument, createDocumentStore, clearStoredState } from './document-store.js';
import { createCommentsStore } from './comments.js';
import { createCommentThread } from './comment-thread.js';
import { createVariantBar } from './review.js';
import { readingOrder } from './layout.js';
import { copyText } from './dom.js';

export { setEngineConfig };

/**
 * @param {object}  options
 * @param {Element} options.mount             container for the canvas viewport
 * @param {Array}   options.registry          [{ id, sourceTitle, layer, render, file?, group?, page? }]
 * @param {Array}   [options.layers]          taxonomy [{ key, label }]
 * @param {string}  [options.storageNamespace]
 * @param {string}  [options.defaultProjectName]
 * @param {Array}   [options.areas]           sidebar areas [{ name, pages: [pageId] }]; unlisted pages go under "Other"
 * @param {object}  [options.build]           review build stamp { sha, dirty, builtAt, hash }; null in dev
 * @returns {{ documentStore, canvas, sidebar, pinSidebar, updateRegistry }}
 */
export function createViewport(options = {}) {
  const recoveryKey = `${options.storageNamespace || 'viewport'}:recovered`;
  try {
    const app = mountViewport(options);
    sessionStorage.removeItem(recoveryKey);
    return app;
  } catch (err) {
    if (!options.mount || !Array.isArray(options.registry) || sessionStorage.getItem(recoveryKey)) throw err;
    console.warn('viewport: failed to start with the saved state; clearing it and reloading', err);
    sessionStorage.setItem(recoveryKey, '1');
    clearStoredState();
    window.location.reload();
    return null;
  }
}

function mountViewport({
  mount,
  registry,
  layers,
  storageNamespace,
  defaultProjectName,
  build = null,
  areas = null,
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

  function hashTargetsBoard() {
    return decodeURIComponent(window.location.hash.slice(1)).split('?')[0].includes('/');
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
  if (linkedPage && hashTargetsBoard() && !bootstrapDoc.ui.expanded.includes(pageNodeKey(linkedPage))) {
    bootstrapDoc.ui.expanded.push(pageNodeKey(linkedPage));
  }
  bootstrapDoc.ui.activePage = resolvePage(linkedPage ?? bootstrapDoc.ui.activePage);
  const focusOnPage = activeRegistry.some((entry) => artboardGroup(entry) === bootstrapDoc.ui.focusGroup
    && (!bootstrapDoc.ui.activePage || bootstrapDoc.artboards[entry.id]?.page === bootstrapDoc.ui.activePage));
  if (!focusOnPage) bootstrapDoc.ui.focusGroup = null;
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
    if (page) selectPage(page, { expand: hashTargetsBoard() });
  });

  const pinSidebar = createPinSidebar({
    onLayoutChange(width, pinned, meta) {
      canvas.onSidebarLayoutChange(width, pinned, meta);
    },
  });
  document.body.appendChild(pinSidebar.element);

  const comments = createCommentsStore({
    onChange() {
      commentThread.refresh();
      variantBar.refresh();
      canvas.refreshComments();
      sidebar.render(buildSidebarModel(documentStore.get()));
    },
  });

  const commentThread = createCommentThread(comments, {
    onClose() {
      variantBar.unlock();
    },
  });

  const variantBar = createVariantBar({
    mount,
    comments,
    onOpenComments: (key, anchor) => commentThread.open(key, anchor),
  });

  function openComments(artboardId, anchor) {
    const button = anchor || mount.querySelector(`[data-artboard-id="${CSS.escape(artboardId)}"] .ff-card__comments`);
    if (button) commentThread.open(artboardId, button);
  }

  const canvas = createCanvas({
    viewport: mount,
    documentStore,
    pinSidebar,
    registry: activeRegistry,
    comments,
    onSelectActiveArtboard: (id) => sidebar.setActiveArtboard(id),
    onOpenComments: openComments,
    onCameraChange: () => {
      commentThread.reposition();
      variantBar.reposition();
    },
  });

  const sidebar = createSidebar({
    build,
    onSelectPage(page) {
      selectPage(page);
      if (documentStore.get().ui.focusGroup !== null) {
        documentStore.mutate((draft) => {
          draft.ui.focusGroup = null;
        });
      }
      canvas.resetPageView();
    },
    onToggleNode(key) {
      documentStore.mutate((draft) => {
        const expanded = new Set(draft.ui.expanded);
        if (!expanded.delete(key)) expanded.add(key);
        draft.ui.expanded = [...expanded];
      });
    },
    onNavigateArtboard(artboardId) {
      selectPageOf(artboardId);
      canvas.centerOn(artboardId);
    },
    onFocusGroup(group, { page } = {}) {
      if (page) selectPage(page);
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
    onOpenComments(artboardId) {
      selectPageOf(artboardId);
      canvas.centerOn(artboardId);
      openComments(artboardId);
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
    const numbers = new Map();
    const readingIndex = new Map();
    readingOrder(documentState, activeRegistry).forEach(({ ids }) => ids.forEach((id, index) => {
      numbers.set(id, index + 1);
      readingIndex.set(id, readingIndex.size);
    }));
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
        number: numbers.get(id),
        layer,
        page: artboard.page,
        group: artboardGroup(regEntry || { layer }),
      };
      modelEntry.shortTitle = shortTitle(artboard.sourceTitle, { page: artboard.page, group: modelEntry.group });
      modelEntry.groupLabel = groupLabel(modelEntry.group, artboard.page);
      if (!artboard.archived) artboardsByProject[artboard.projectId]?.push(modelEntry);
      else if (!activePage || artboard.page === activePage) archivedArtboards.push(modelEntry);
    });

    Object.values(artboardsByProject).forEach((rows) => {
      rows.sort((a, b) => (readingIndex.get(a.id) ?? Infinity) - (readingIndex.get(b.id) ?? Infinity));
    });
    archivedArtboards.sort((a, b) => a.id.localeCompare(b.id));

    return {
      pages,
      areas,
      activePage,
      groupOrder: sortGroups(activeRegistry),
      focusGroup: documentState.ui.focusGroup,
      projects: documentState.projects,
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

  setTimeout(() => documentStore.relayout(activeRegistry), 200);

  async function migrateLocalNotes() {
    const notes = (documentStore.get().notes || []).filter((note) => note.text?.trim());
    if (!notes.length || !comments.isAvailable()) return;
    for (const note of notes) await comments.add(note.target.artboardId, note.text);
    documentStore.mutate((draft) => {
      draft.notes = [];
    });
  }

  comments.load()
    .then(migrateLocalNotes)
    .catch((err) => console.error('Failed to move local notes into comments.json', err));

  function updateRegistry(nextRegistry, { changedIds } = {}) {
    if (!Array.isArray(nextRegistry)) throw new Error('updateRegistry: `nextRegistry` array is required');
    const idsToRefresh = changedIds || nextRegistry.map((entry) => entry.id);
    activeRegistry.splice(0, activeRegistry.length, ...nextRegistry);
    pages = listPages(activeRegistry);
    documentStore.syncRegistry(activeRegistry);
    documentStore.relayout(activeRegistry);
    const page = documentStore.get().ui.activePage;
    if (resolvePage(page) !== page) selectPage(page);
    canvas.refreshArtboards(idsToRefresh);
  }

  return { documentStore, canvas, sidebar, pinSidebar, updateRegistry };
}
