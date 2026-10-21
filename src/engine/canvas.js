import './canvas.css';
import './sidebar.css';
import './pin-sidebar.css';
import Konva from 'konva';
import { createArtboard } from './artboard.js';
import { copyText } from './dom.js';
import { storageKey, artboardGroup } from './config.js';
import { createProjectFrame } from './project-frame.js';
import { showRenameDialog } from './sidebar-context-menu.js';

const SCALE_BY = 1.05;
const MIN_SCALE = 0.15;
const MAX_SCALE = 4;
const SNAP = 8;
const CLICK_TRAVEL_PX = 4;

const ARTBOARD_BASE_X = 48;
const ARTBOARD_BASE_Y = 56;
const ARTBOARD_COL_SPACING = 360;
const ARTBOARD_ROW_SPACING = 300;

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const FIRST_MEASURE_SETTLE_MS = 150;

function cameraKey(page) {
  return storageKey(page ? `camera:${page}` : 'camera');
}

function readStoredCamera(page) {
  try {
    const raw = localStorage.getItem(cameraKey(page));
    const camera = raw ? JSON.parse(raw) : null;
    if (
      camera &&
      Number.isFinite(camera.x) &&
      Number.isFinite(camera.y) &&
      Number.isFinite(camera.scale)
    ) {
      return {
        x: camera.x,
        y: camera.y,
        scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, camera.scale)),
      };
    }
  } catch (err) {
    console.error('Failed to load canvas camera from localStorage', err);
  }
  return null;
}

export function createCanvas({ viewport, documentStore, pinSidebar, registry, onSelectActiveArtboard }) {
  let currentPage;
  const cards = new Map();
  const projectFrames = new Map();
  let copyToast = null;
  const selectedIds = new Set();
  const resolveAfterFirstMeasure = debounce(() => documentStore.resolveOverlaps(), FIRST_MEASURE_SETTLE_MS);

  let leftSidebarWidth = 220;
  let pinSidebarWidth = pinSidebar.getWidth();
  let pinSidebarPinned = pinSidebar.isActive();
  let leftSidebarOpen = true;
  let pinPanelOpen = true;

  function getCanvasInsets() {
    return {
      left: leftSidebarOpen ? leftSidebarWidth : 0,
      right: pinSidebarPinned && pinPanelOpen ? pinSidebarWidth : 0,
    };
  }

  function getCanvasWidth() {
    const { left, right } = getCanvasInsets();
    return window.innerWidth - left - right;
  }

  function getViewportCenterX() {
    const { left } = getCanvasInsets();
    return left + getCanvasWidth() / 2;
  }

  function clientXToCanvasX(clientX) {
    return clientX - getCanvasInsets().left;
  }

  let leftSidebarToggle;
  let pinSidebarToggle;
  let zoomUI = null;
  let zoomLevel = null;

  function updateSidebarToggles() {
    if (!leftSidebarToggle || !pinSidebarToggle) return;

    const { left, right } = getCanvasInsets();
    leftSidebarToggle.style.left = leftSidebarOpen ? `${leftSidebarWidth - 1}px` : '0';
    leftSidebarToggle.dataset.open = leftSidebarOpen ? 'true' : 'false';
    leftSidebarToggle.title = leftSidebarOpen ? 'Hide sidebar' : 'Show sidebar';
    leftSidebarToggle.setAttribute('aria-label', leftSidebarToggle.title);

    const showPinToggle = pinSidebarPinned;
    pinSidebarToggle.hidden = !showPinToggle;
    if (showPinToggle) {
      pinSidebarToggle.style.right = pinPanelOpen ? `${right - 1}px` : '0';
      pinSidebarToggle.dataset.open = pinPanelOpen ? 'true' : 'false';
      pinSidebarToggle.title = pinPanelOpen ? 'Hide pin panel' : 'Show pin panel';
      pinSidebarToggle.setAttribute('aria-label', pinSidebarToggle.title);
    }
  }

  function applyCanvasLayout() {
    const { left, right } = getCanvasInsets();
    viewport.style.left = `${left}px`;
    viewport.style.right = `${right}px`;
    stage.width(getCanvasWidth());
    stage.height(window.innerHeight);
    stage.batchDraw();
    if (zoomUI) zoomUI.style.right = `${16 + right}px`;
    pinSidebar.refreshAll();
    updateSidebarToggles();
  }

  function toggleLeftSidebar() {
    leftSidebarOpen = !leftSidebarOpen;
    const sidebarEl = document.getElementById('sidebar');
    sidebarEl?.classList.toggle('artboard-sidebar--hidden', !leftSidebarOpen);
    documentStore.mutate((draft) => {
      draft.ui.leftSidebarOpen = leftSidebarOpen;
    });
    applyCanvasLayout();
  }

  function togglePinPanel() {
    if (!pinSidebarPinned) return;
    pinPanelOpen = !pinPanelOpen;
    documentStore.mutate((draft) => {
      draft.ui.pinPanelOpen = pinPanelOpen;
    });
    applyCanvasLayout();
  }

  function createSidebarToggle(side, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sidebar-edge-toggle sidebar-edge-toggle--${side}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    document.body.appendChild(btn);
    return btn;
  }

  const stage = new Konva.Stage({
    container: viewport,
    width: getCanvasWidth(),
    height: window.innerHeight,
    draggable: true,
  });

  const bgLayer = new Konva.Layer();
  stage.add(bgLayer);

  bgLayer.add(new Konva.Rect({
    x: -10000,
    y: -10000,
    width: 20000,
    height: 20000,
    fill: 'transparent',
    listening: true,
  }));

  const gridSpacing = 40;
  const gridRange = 3000;
  for (let x = -gridRange; x <= gridRange; x += gridSpacing) {
    for (let y = -gridRange; y <= gridRange; y += gridSpacing) {
      bgLayer.add(new Konva.Circle({
        x, y,
        radius: 1,
        fill: 'rgba(255, 255, 255, 0.08)',
        listening: false,
      }));
    }
  }
  bgLayer.draw();

  const world = document.createElement('div');
  world.id = 'world';
  world.className = 'canvas-world';
  viewport.appendChild(world);

  function writeCamera() {
    try {
      localStorage.setItem(cameraKey(currentPage), JSON.stringify({
        x: stage.x(),
        y: stage.y(),
        scale: stage.scaleX(),
      }));
    } catch (err) {
      console.error('Failed to persist canvas camera', err);
    }
  }
  const persistCamera = debounce(writeCamera, 160);

  function syncDOM({ persist = true } = {}) {
    const s = stage.scaleX();
    const x = stage.x();
    const y = stage.y();
    world.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    if (zoomLevel) zoomLevel.textContent = `${Math.round(s * 100)}%`;
    if (persist) persistCamera();
  }
  syncDOM({ persist: false });

  stage.on('dragmove', syncDOM);
  stage.on('dragend', syncDOM);

  function clientToWorld(clientX, clientY) {
    const worldRect = world.getBoundingClientRect();
    const scale = stage.scaleX();
    return {
      x: (clientX - worldRect.left) / scale,
      y: (clientY - worldRect.top) / scale,
    };
  }

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();

    const r = viewport.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;

    if (e.ctrlKey || e.metaKey) {
      const oldScale = stage.scaleX();
      const mousePointTo = {
        x: (px - stage.x()) / oldScale,
        y: (py - stage.y()) / oldScale,
      };

      let direction = e.deltaY > 0 ? 1 : -1;
      if (e.ctrlKey || e.metaKey) direction = -direction;

      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE,
        direction > 0 ? oldScale * SCALE_BY : oldScale / SCALE_BY
      ));

      stage.scale({ x: newScale, y: newScale });
      stage.position({
        x: px - mousePointTo.x * newScale,
        y: py - mousePointTo.y * newScale,
      });
      stage.batchDraw();
      syncDOM();
    } else {
      const scale = stage.scaleX();
      const dx = e.deltaX / scale;
      const dy = e.deltaY / scale;
      stage.position({
        x: stage.x() - dx,
        y: stage.y() - dy,
      });
      stage.batchDraw();
      syncDOM();
    }
  }, { passive: false });

  function ensureCardEntry(id) {
    if (cards.has(id)) return cards.get(id);

    const reg = registry.find(item => item.id === id);
    if (!reg) return null;

    const title = reg.sourceTitle || reg.id;
    const el = createArtboard(title, reg.render(), { layer: reg.layer, id, file: reg.file });
    el.classList.add('module-card--positioned');
    el.dataset.artboardId = id;

    let resizeTimeout = null;
    const ro = new ResizeObserver(() => {
      const cardW = Math.round(el.offsetWidth);
      const cardH = Math.round(el.offsetHeight);
      if (cardW > 0 && cardH > 0) {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          const currentDoc = documentStore.get();
          const artboard = currentDoc.artboards[id];
          if (artboard) {
            const currentSize = artboard.size;
            if (!currentSize || currentSize.width !== cardW || currentSize.height !== cardH) {
              const isFirstMeasure = !currentSize;
              documentStore.mutate((draft) => {
                if (draft.artboards[id]) {
                  draft.artboards[id].size = { width: cardW, height: cardH };
                }
              }, { persist: true });
              if (isFirstMeasure) resolveAfterFirstMeasure();
            }
          }
        }, 100);
      }
    });
    ro.observe(el);

    const entry = {
      id,
      element: el,
      pinBtn: el.pinBtn,
      renameBtn: el.renameBtn,
      label: el.titleEl,
      bodyEl: el.bodyEl,
      dragBound: false,
      resizeObserver: ro,
    };
    cards.set(id, entry);
    return entry;
  }

  function refreshArtboard(id) {
    const entry = cards.get(id);
    if (!entry) return;
    const reg = registry.find(item => item.id === id);
    if (!reg) return;

    const contentEl = reg.render();
    entry.bodyEl.replaceChildren(contentEl);
    entry.element.dataset.layer = reg.layer || 'primitive';
    const currentDoc = documentStore.get();
    const artboard = currentDoc.artboards[id];
    const title = artboard ? getDisplayTitle(artboard) : (reg.sourceTitle || reg.id);
    entry.label.textContent = title;
    entry.element.titleEl.textContent = title;
  }

  function getDisplayTitle(artboardState) {
    return artboardState.displayName || artboardState.sourceTitle;
  }

  function getProjectVisibleArtboardIds(documentState, projectId) {
    return Object.keys(documentState.artboards)
      .filter((id) => {
        const artboard = documentState.artboards[id];
        return artboard.projectId === projectId && !artboard.archived && !artboard.orphaned && onActivePage(documentState, artboard);
      })
      .sort((a, b) => documentState.artboards[a].sidebarOrder - documentState.artboards[b].sidebarOrder);
  }

  function getProjectToggleAnchor(documentState, projectId, projectIndex) {
    const ids = getProjectVisibleArtboardIds(documentState, projectId);
    if (!ids.length) {
      return {
        x: ARTBOARD_BASE_X,
        y: ARTBOARD_BASE_Y + projectIndex * 28,
      };
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    ids.forEach((id) => {
      const position = documentState.artboards[id].position;
      if (position.x < minX) minX = position.x;
      if (position.y < minY) minY = position.y;
    });
    return {
      x: Number.isFinite(minX) ? minX : ARTBOARD_BASE_X,
      y: Number.isFinite(minY) ? Math.max(0, minY - 28) : ARTBOARD_BASE_Y + projectIndex * 28,
    };
  }

  function onActivePage(documentState, artboard) {
    const page = documentState.ui.activePage;
    return !page || artboard.page === page;
  }

  function showPage(documentState) {
    const page = documentState.ui.activePage;
    if (page === currentPage) return;
    if (currentPage !== undefined) writeCamera();
    currentPage = page;
    const stored = readStoredCamera(page);
    if (stored) {
      stage.scale({ x: stored.scale, y: stored.scale });
      stage.position({ x: stored.x, y: stored.y });
    } else {
      const positions = Object.values(documentState.artboards)
        .filter((artboard) => !artboard.archived && !artboard.orphaned && onActivePage(documentState, artboard))
        .map((artboard) => artboard.position);
      const minX = positions.length ? Math.min(...positions.map((p) => p.x)) : 0;
      const minY = positions.length ? Math.min(...positions.map((p) => p.y)) : 0;
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: getCanvasInsets().left + ARTBOARD_BASE_X - minX, y: ARTBOARD_BASE_Y - minY });
    }
    stage.batchDraw();
    syncDOM({ persist: false });
  }

  function getSinglePinnedId(documentState) {
    const pinned = Object.keys(documentState.artboards).find((id) => {
      const entry = documentState.artboards[id];
      return entry.pinned && !entry.archived && onActivePage(documentState, entry);
    });
    return pinned || null;
  }

  function attachCardInteractions(id) {
    const entry = cards.get(id);
    if (!entry || entry.dragBound) return;
    entry.dragBound = true;

    const selectAndCopy = (event) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
      } else {
        selectedIds.clear();
        selectedIds.add(id);
      }
      applySelection();
      copyIds([...selectedIds]);
    };

    entry.element.idBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      selectAndCopy(event);
    });

    entry.pinBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      documentStore.mutate((draft) => {
        const currentPinned = getSinglePinnedId(draft);
        Object.keys(draft.artboards).forEach((artId) => {
          draft.artboards[artId].pinned = false;
        });
        if (currentPinned !== id && !draft.artboards[id].archived) {
          draft.artboards[id].pinned = true;
        }
      });
    });

    entry.renameBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const currentDoc = documentStore.get();
      const artboard = currentDoc.artboards[id];
      if (!artboard) return;
      showRenameDialog(getDisplayTitle(artboard), (value) => {
        documentStore.mutate((draft) => {
          if (!draft.artboards[id]) return;
          draft.artboards[id].displayName = value;
        });
      });
    });

    const dragHandle = entry.element.handle;
    dragHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('.ff-card__pin, .ff-card__rename')) return;
      event.preventDefault();
      event.stopPropagation();

      const currentDoc = documentStore.get();
      const artboard = currentDoc.artboards[id];
      if (!artboard || artboard.archived) return;

      const startClient = { x: event.clientX, y: event.clientY };
      const pressedTitle = event.target.closest('.ff-card__title');
      const startPointer = clientToWorld(event.clientX, event.clientY);
      const startPosition = { ...artboard.position };

      stage.draggable(false);
      entry.element.classList.add('module-card--dragging');
      const pointerId = event.pointerId;

      const handleMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const pointer = clientToWorld(moveEvent.clientX, moveEvent.clientY);
        const dx = pointer.x - startPointer.x;
        const dy = pointer.y - startPointer.y;
        const nextX = Math.round(startPosition.x + dx);
        const nextY = Math.round(startPosition.y + dy);
        entry.element.style.left = `${nextX}px`;
        entry.element.style.top = `${nextY}px`;
      };

      const handleUp = (upEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleUp);

        stage.draggable(true);
        entry.element.classList.remove('module-card--dragging');

        const travel = Math.hypot(upEvent.clientX - startClient.x, upEvent.clientY - startClient.y);
        if (pressedTitle && travel < CLICK_TRAVEL_PX) {
          entry.element.style.left = `${startPosition.x}px`;
          entry.element.style.top = `${startPosition.y}px`;
          selectAndCopy(upEvent);
          return;
        }

        const pointer = clientToWorld(upEvent.clientX, upEvent.clientY);
        const dx = pointer.x - startPointer.x;
        const dy = pointer.y - startPointer.y;
        const snappedX = Math.round((startPosition.x + dx) / SNAP) * SNAP;
        const snappedY = Math.round((startPosition.y + dy) / SNAP) * SNAP;

        documentStore.mutate((draft) => {
          if (!draft.artboards[id]) return;
          draft.artboards[id].position = { x: snappedX, y: snappedY };
        });
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleUp);
    });
  }

  function groupOfId(id) {
    return artboardGroup(registry.find((item) => item.id === id));
  }

  function activeFocusGroup(documentState) {
    const group = documentState.ui.focusGroup;
    if (!group) return null;
    return registry.some((item) => artboardGroup(item) === group) ? group : null;
  }

  function renderProjectFrames(documentState) {
    const focusGroup = activeFocusGroup(documentState);
    const renderedIds = new Set();
    const renderedProjectIds = new Set();

    documentState.projects.forEach((project, projectIndex) => {
      const artboardIds = getProjectVisibleArtboardIds(documentState, project.id);
      
      const anchor = getProjectToggleAnchor(documentState, project.id, projectIndex);
      let frameComp = projectFrames.get(project.id);
      
      if (!frameComp) {
        frameComp = createProjectFrame(project, {
          onToggleCollapse: () => {
            documentStore.mutate((draft) => {
              const projectDraft = draft.projects.find((p) => p.id === project.id);
              if (projectDraft) projectDraft.collapsed = !projectDraft.collapsed;
            });
          }
        });
        projectFrames.set(project.id, frameComp);
      }

      frameComp.setTitle(project.name);
      frameComp.setCollapsed(project.collapsed);
      frameComp.element.style.left = `${anchor.x}px`;
      frameComp.element.style.top = `${anchor.y}px`;
      frameComp.element.style.display = 'none';
      
      let toggleBtn = world.querySelector(`.project-toggle-${project.id}`);
      if (!toggleBtn) {
        toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = `project-inline-toggle project-toggle-${project.id}`;
        toggleBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          documentStore.mutate((draft) => {
            const projectDraft = draft.projects.find((p) => p.id === project.id);
            if (projectDraft) projectDraft.collapsed = !projectDraft.collapsed;
          });
        });
        world.appendChild(toggleBtn);
      }
      toggleBtn.textContent = `${project.collapsed ? '[+]' : '[-]'} ${project.name}`;
      toggleBtn.style.left = `${anchor.x}px`;
      toggleBtn.style.top = `${anchor.y}px`;
      renderedProjectIds.add(project.id);

      artboardIds.forEach((id) => {
        const cardEntry = ensureCardEntry(id);
        if (!cardEntry) return;

        attachCardInteractions(id);

        const state = documentState.artboards[id];
        const title = getDisplayTitle(state);
        cardEntry.label.textContent = title;
        cardEntry.element.titleEl.textContent = title;

        const isPinned = state.pinned && !state.archived;
        cardEntry.pinBtn.classList.toggle('ff-card-pin--active', isPinned);
        cardEntry.pinBtn.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
        cardEntry.pinBtn.setAttribute('aria-label', isPinned ? `Unpin "${title}"` : `Pin "${title}"`);

        cardEntry.renameBtn.hidden = false;

        cardEntry.element.style.left = `${state.position.x}px`;
        cardEntry.element.style.top = `${state.position.y}px`;
        const hiddenByFocus = focusGroup !== null && groupOfId(id) !== focusGroup;
        cardEntry.element.style.display = project.collapsed || hiddenByFocus ? 'none' : '';
        
        if (!cardEntry.element.parentNode) {
          world.appendChild(cardEntry.element);
        }

        renderedIds.add(id);
      });
    });

    cards.forEach((entry, id) => {
      if (!renderedIds.has(id)) {
        entry.resizeObserver?.disconnect();
        entry.element.remove();
        cards.delete(id);
      }
    });

    projectFrames.forEach((frameComp, id) => {
      if (!renderedProjectIds.has(id)) {
        frameComp.element.remove();
        projectFrames.delete(id);
      }
    });
    world.querySelectorAll('.project-inline-toggle').forEach((toggle) => {
      const match = toggle.className.match(/project-toggle-([a-zA-Z0-9_-]+)/);
      if (match && !renderedProjectIds.has(match[1])) {
        toggle.remove();
      }
    });
  }

  function applyPinSidebar(documentState) {
    const pinnedId = getSinglePinnedId(documentState);
    if (!pinnedId) {
      pinSidebar.unpinAll();
      return;
    }
    const cardEntry = cards.get(pinnedId);
    const artboardState = documentState.artboards[pinnedId];
    if (!cardEntry || !artboardState) return;

    pinSidebar.pin(
      pinnedId,
      cardEntry.element.bodyEl,
      getDisplayTitle(artboardState),
      () => {
        documentStore.mutate((draft) => {
          if (draft.artboards[pinnedId]) draft.artboards[pinnedId].pinned = false;
        });
      }
    );
  }

  function animateCanvasTo(targetScale, targetX, targetY, duration = 400) {
    const startScale = stage.scaleX();
    const startX = stage.x();
    const startY = stage.y();
    const startTime = performance.now();

    function tick(now) {
      let t = Math.min((now - startTime) / duration, 1);
      t = 1 - Math.pow(1 - t, 3);

      const s = startScale + (targetScale - startScale) * t;
      const x = startX + (targetX - startX) * t;
      const y = startY + (targetY - startY) * t;

      stage.scale({ x: s, y: s });
      stage.position({ x, y });
      stage.batchDraw();
      syncDOM();

      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function navigateToCanvasNode(targetEl, artboardId = null) {
    fitClientRect(targetEl.getBoundingClientRect());
    if (artboardId) onSelectActiveArtboard?.(artboardId);
  }

  function fitGroup(group) {
    const rects = [...cards.values()]
      .filter((entry) => groupOfId(entry.id) === group && entry.element.style.display !== 'none')
      .map((entry) => entry.element.getBoundingClientRect());
    if (!rects.length) return;
    fitClientRect({
      maxScale: 1,
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      width: Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left)),
      height: Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top)),
    });
  }

  function fitClientRect(rect) {
    const worldRect = world.getBoundingClientRect();
    const scale = stage.scaleX();
    const worldX = (rect.left - worldRect.left) / scale;
    const worldY = (rect.top - worldRect.top) / scale;
    const worldW = rect.width / scale;
    const worldH = rect.height / scale;

    const leftWidth = documentStore.get().ui.leftSidebarOpen !== false ? leftSidebarWidth : 0;
    const rightWidth = pinSidebar.isActive() && documentStore.get().ui.pinPanelOpen !== false ? pinSidebar.getWidth() : 0;
    const vpW = window.innerWidth - leftWidth - rightWidth;
    const vpH = window.innerHeight;

    const availW = vpW * 0.8;
    const availH = vpH * 0.8;
    const fitScale = Math.min(availW / worldW, availH / worldH);
    const newScale = Math.max(MIN_SCALE, Math.min(rect.maxScale ?? MAX_SCALE, fitScale));

    const vpCenterX = leftWidth + vpW / 2;
    const vpCenterY = vpH / 2;
    const centerX = worldX + worldW / 2;
    const centerY = worldY + worldH / 2;

    animateCanvasTo(newScale, vpCenterX - centerX * newScale, vpCenterY - centerY * newScale);
  }

  function centerOn(id) {
    const entry = cards.get(id);
    if (!entry) return;
    navigateToCanvasNode(entry.element, id);
  }

  function applySelection() {
    cards.forEach((entry, id) => {
      entry.element.classList.toggle('ff-card--selected', selectedIds.has(id));
    });
  }

  function clearSelection() {
    selectedIds.clear();
    applySelection();
  }

  function copyIds(ids) {
    if (!ids.length) {
      showCopyToast('Selection cleared');
      return;
    }
    copyText(ids.join('\n'))
      .then(() => showCopyToast(ids.length === 1 ? `Copied ${ids[0]}` : `Copied ${ids.length} ids`))
      .catch((err) => showCopyToast(`Copy failed: ${err.message}`));
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectedIds.size) clearSelection();
  });

  function showCopyToast(message) {
    if (!copyToast) {
      copyToast = document.createElement('div');
      copyToast.className = 'canvas-copy-toast';
      document.body.appendChild(copyToast);
    }
    copyToast.textContent = message;
    copyToast.classList.add('canvas-copy-toast--visible');
    clearTimeout(showCopyToast._timer);
    showCopyToast._timer = setTimeout(() => {
      copyToast?.classList.remove('canvas-copy-toast--visible');
    }, 1300);
  }

  zoomUI = document.createElement('div');
  zoomUI.className = 'zoom-controls';

  const zoomOut = document.createElement('button');
  zoomOut.textContent = '−';
  zoomOut.addEventListener('click', (e) => {
    e.stopPropagation();
    const cur = stage.scaleX();
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cur / 1.3));
    animateCanvasTo(newScale, stage.x(), stage.y());
  });

  zoomLevel = document.createElement('span');
  zoomLevel.className = 'zoom-level';
  zoomLevel.textContent = '100%';

  const zoomIn = document.createElement('button');
  zoomIn.textContent = '+';
  zoomIn.addEventListener('click', (e) => {
    e.stopPropagation();
    const cur = stage.scaleX();
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cur * 1.3));
    animateCanvasTo(newScale, stage.x(), stage.y());
  });

  const zoomFit = document.createElement('button');
  zoomFit.textContent = '⊡';
  zoomFit.title = 'Reset';
  zoomFit.addEventListener('click', (e) => {
    e.stopPropagation();
    animateCanvasTo(1, 0, 0);
  });

  zoomUI.appendChild(zoomOut);
  zoomUI.appendChild(zoomLevel);
  zoomUI.appendChild(zoomIn);
  zoomUI.appendChild(zoomFit);
  document.body.appendChild(zoomUI);

  const hint = document.createElement('div');
  hint.className = 'canvas-hint';
  hint.textContent = 'Drag grid space to pan · Pinch/ctrl+scroll to zoom · ⊡ to reset';
  document.body.appendChild(hint);
  setTimeout(() => hint.classList.add('hidden'), 5000);

  window.addEventListener('resize', () => {
    applyCanvasLayout();
  });

  function render(nextDocument) {
    leftSidebarOpen = nextDocument.ui.leftSidebarOpen !== false;
    leftSidebarWidth = nextDocument.ui.leftSidebarWidth || 220;
    pinPanelOpen = nextDocument.ui.pinPanelOpen !== false;
    pinSidebarWidth = nextDocument.ui.pinPanelWidth || pinSidebar.getWidth();
    pinSidebarPinned = getSinglePinnedId(nextDocument) !== null;

    const sidebarEl = document.getElementById('sidebar');
    sidebarEl?.classList.toggle('artboard-sidebar--hidden', !leftSidebarOpen);

    showPage(nextDocument);
    renderProjectFrames(nextDocument);
    applyPinSidebar(nextDocument);
    applyCanvasLayout();
  }

  setTimeout(() => {
    applyCanvasLayout();
  }, 0);

  return {
    render,
    centerOn,
    fitGroup,
    navigateToCanvasNode,
    showCopyToast,
    copyIds,
    refreshArtboard,
    refreshArtboards(ids) {
      ids.forEach(refreshArtboard);
      pinSidebar.refreshAll();
    },
    onSidebarLayoutChange(width, pinned, meta) {
      pinSidebarWidth = width;
      if (typeof pinned === 'boolean') {
        pinSidebarPinned = pinned;
        if (!pinned) pinPanelOpen = true;
      }
      applyCanvasLayout();
    }
  };
}
