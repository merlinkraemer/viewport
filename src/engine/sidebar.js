import {
  showConfirmDialog,
  showContextMenu,
  showProjectPickerDialog,
  showRenameDialog,
} from './sidebar-context-menu.js';

const ARCHIVE_NODE_KEY = 'archive';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function createBuildLabel(build) {
  const label = document.createElement('span');
  label.className = 'sidebar-build';
  if (!build) {
    label.textContent = 'dev';
    return label;
  }
  const at = new Date(build.builtAt);
  const time = `${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  const sha = `${build.sha ?? 'no-git'}${build.dirty ? '+' : ''}`;
  label.textContent = `${sha} · ${time} · ${build.hash}`;
  label.title = `Built ${build.builtAt}. "+" means uncommitted changes. Compare the hash with build.json.`;
  label.dataset.buildHash = build.hash;
  return label;
}

export function pageNodeKey(page) {
  return `page:${page}`;
}

export function groupNodeKey(page, group) {
  return `group:${page ?? ''}:${group}`;
}

function getDisplayName(artboard) {
  return artboard.displayName || artboard.sourceTitle;
}

function getRowLabel(artboard) {
  return artboard.displayName || artboard.shortTitle || artboard.sourceTitle;
}

function createRow(kind, level, label) {
  const row = document.createElement('div');
  row.className = `sidebar-row sidebar-row--${kind}`;
  row.style.setProperty('--level', String(level));
  const labelEl = document.createElement('span');
  labelEl.className = 'sidebar-row__label';
  labelEl.textContent = label;
  labelEl.title = label;
  row.labelEl = labelEl;
  return row;
}

function createChevron(open, onToggle) {
  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = 'sidebar-row__chevron';
  chevron.textContent = open ? '▾' : '▸';
  chevron.setAttribute('aria-label', open ? 'Collapse' : 'Expand');
  chevron.setAttribute('aria-expanded', String(open));
  chevron.addEventListener('click', (event) => {
    event.stopPropagation();
    onToggle();
  });
  return chevron;
}

export function createSidebar(options) {
  const sidebar = document.createElement('aside');
  sidebar.className = 'artboard-sidebar';

  const scroll = document.createElement('nav');
  scroll.className = 'sidebar-scroll';
  sidebar.appendChild(scroll);

  const footer = document.createElement('div');
  footer.className = 'sidebar-footer';
  footer.append(createBuildLabel(options.build));
  sidebar.appendChild(footer);

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'sidebar-resize';
  resizeHandle.setAttribute('aria-hidden', 'true');
  sidebar.appendChild(resizeHandle);

  let model = null;
  let activeArtboardId = null;
  let sidebarWidth = 220;
  const MIN_WIDTH = 160;
  const MAX_WIDTH = 600;
  let resizing = false;

  function applyWidth() {
    sidebar.style.width = `${sidebarWidth}px`;
    document.documentElement.style.setProperty('--ff-sidebar-w', `${sidebarWidth}px`);
  }

  resizeHandle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resizing = true;
    resizeHandle.setPointerCapture(e.pointerId);
    document.body.classList.add('sidebar-resizing');
  });

  resizeHandle.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    sidebarWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
    applyWidth();
    options.onWidthChange?.(sidebarWidth);
  });

  function endResize(e) {
    if (!resizing) return;
    resizing = false;
    if (resizeHandle.hasPointerCapture(e.pointerId)) resizeHandle.releasePointerCapture(e.pointerId);
    document.body.classList.remove('sidebar-resizing');
  }

  resizeHandle.addEventListener('pointerup', endResize);
  resizeHandle.addEventListener('pointercancel', endResize);

  function setActiveStyles() {
    scroll.querySelectorAll('.sidebar-row--artboard').forEach((row) => {
      row.classList.toggle('sidebar-row--active', row.dataset.id === activeArtboardId);
    });
  }

  function artboardMenu(artboard) {
    return [
      {
        label: 'Edit name',
        onSelect: () => showRenameDialog(getDisplayName(artboard), (value) => options.onRenameArtboard?.(artboard.id, value)),
      },
      { label: artboard.pinned ? 'Unpin' : 'Pin', onSelect: () => options.onTogglePin?.(artboard.id) },
      { label: 'Comments...', onSelect: () => options.onOpenComments?.(artboard.id) },
      { label: 'Copy id', onSelect: () => options.onCopyArtboard?.(artboard.id) },
      ...(model.projects.length > 1 ? [{
        label: 'Move to project...',
        onSelect: () => showProjectPickerDialog({
          projects: model.projects,
          currentProjectId: artboard.projectId,
          onSelect: (nextProjectId) => options.onMoveArtboardProject?.(artboard.id, nextProjectId),
        }),
      }] : []),
      { type: 'divider' },
      {
        label: 'Archive',
        muted: true,
        onSelect: () => showConfirmDialog({
          title: 'Archive artboard',
          message: `Archive "${getDisplayName(artboard)}"?`,
          confirmLabel: 'Archive',
          onConfirm: () => options.onArchiveArtboard?.(artboard.id),
        }),
      },
    ];
  }

  function createArtboardRow(artboard, level) {
    const row = createRow('artboard', level, getRowLabel(artboard));
    row.dataset.id = artboard.id;
    row.title = `${getDisplayName(artboard)}\n${artboard.id}`;
    const num = document.createElement('span');
    num.className = 'sidebar-row__num';
    num.textContent = artboard.number ? String(artboard.number) : '';
    row.append(num, row.labelEl);
    row.addEventListener('click', () => options.onNavigateArtboard?.(artboard.id));
    row.addEventListener('contextmenu', (event) => showContextMenu(event, artboardMenu(artboard)));
    return row;
  }

  function createPageRow(page, open) {
    const row = createRow('page', 0, page.label);
    row.dataset.page = page.id;
    row.classList.toggle('sidebar-row--current', page.id === model.activePage);
    const link = document.createElement('a');
    link.className = 'sidebar-row__label';
    link.href = `#${page.id}`;
    link.textContent = page.label;
    link.title = page.label;
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
    });
    row.append(createChevron(open, () => options.onToggleNode?.(pageNodeKey(page.id))), link);
    row.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      options.onSelectPage?.(page.id);
    });
    return row;
  }

  function createGroupRow(page, group, level, open, nodeKey) {
    const row = createRow('group', level, group.label);
    row.dataset.group = group.name;
    row.dataset.page = page ?? '';
    const focused = model.focusGroup === group.name;
    row.classList.toggle('sidebar-row--active', focused);
    row.title = focused ? 'Show all groups' : `Show only ${group.label}`;
    row.append(createChevron(open, () => options.onToggleNode?.(nodeKey)), row.labelEl);
    row.addEventListener('click', () => options.onFocusGroup?.(group.name, { page, nodeKey }));
    return row;
  }

  function groupArtboards(artboards) {
    const groups = new Map();
    artboards.forEach((artboard) => {
      if (!groups.has(artboard.group)) groups.set(artboard.group, { name: artboard.group, label: artboard.groupLabel, artboards: [] });
      groups.get(artboard.group).artboards.push(artboard);
    });
    const rank = (name) => {
      const index = model.groupOrder.indexOf(name);
      return index === -1 ? model.groupOrder.length : index;
    };
    return [...groups.values()].sort((a, b) => rank(a.name) - rank(b.name));
  }

  function appendChildren(container, page, artboards, level, expanded) {
    const groups = groupArtboards(artboards);
    if (groups.length < 2) {
      artboards.forEach((artboard) => container.appendChild(createArtboardRow(artboard, level)));
      return;
    }
    groups.forEach((group) => {
      const key = groupNodeKey(page, group.name);
      const open = expanded.has(key);
      container.appendChild(createGroupRow(page, group, level, open, key));
      if (open) group.artboards.forEach((artboard) => container.appendChild(createArtboardRow(artboard, level + 1)));
    });
  }

  function appendArchive(container, expanded) {
    if (!model.archivedArtboards.length) return;
    const open = expanded.has(ARCHIVE_NODE_KEY);
    const row = createRow('archive', 0, 'Archived');
    row.append(createChevron(open, () => options.onToggleNode?.(ARCHIVE_NODE_KEY)), row.labelEl);
    row.addEventListener('click', () => options.onToggleNode?.(ARCHIVE_NODE_KEY));
    container.appendChild(row);
    if (!open) return;
    model.archivedArtboards.forEach((artboard) => {
      const item = createRow('artboard', 1, getDisplayName(artboard));
      item.classList.add('sidebar-row--archived');
      item.title = `Restore ${artboard.id}`;
      item.append(item.labelEl);
      item.addEventListener('click', () => options.onRestoreArtboard?.(artboard.id));
      container.appendChild(item);
    });
  }

  function buildTree() {
    const tree = document.createDocumentFragment();
    const expanded = new Set(model.ui?.expanded || []);
    const multiProject = model.projects.length > 1;
    let rows = 0;

    model.projects.forEach((project) => {
      const artboards = model.artboardsByProject[project.id] || [];
      if (!artboards.length) return;
      rows += artboards.length;
      const level = multiProject ? 1 : 0;
      if (multiProject) {
        const header = createRow('page', 0, project.name);
        header.append(header.labelEl);
        tree.appendChild(header);
      }

      if (model.pages.length < 2) {
        appendChildren(tree, model.pages[0]?.id ?? null, artboards, level, expanded);
        return;
      }
      model.pages.forEach((page) => {
        const pageArtboards = artboards.filter((artboard) => artboard.page === page.id);
        if (!pageArtboards.length) return;
        const open = expanded.has(pageNodeKey(page.id));
        tree.appendChild(createPageRow(page, open));
        if (!open) return;
        const children = document.createElement('div');
        children.className = 'sidebar-children';
        appendChildren(children, page.id, pageArtboards, level + 1, expanded);
        tree.appendChild(children);
      });
    });

    if (!rows) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-empty';
      empty.textContent = 'No artboards.';
      tree.appendChild(empty);
    }
    appendArchive(tree, expanded);
    return tree;
  }

  function render(nextModel) {
    model = nextModel;
    if (model.ui?.leftSidebarWidth) {
      sidebarWidth = model.ui.leftSidebarWidth;
      applyWidth();
    }
    const scrollTop = scroll.scrollTop;
    scroll.replaceChildren(buildTree());
    scroll.scrollTop = scrollTop;
    setActiveStyles();
  }

  function setActiveArtboard(id) {
    activeArtboardId = id;
    setActiveStyles();
  }

  return {
    element: sidebar,
    render,
    setActiveArtboard,
  };
}
