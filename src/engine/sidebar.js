import {
  showConfirmDialog,
  showContextMenu,
  showProjectPickerDialog,
  showRenameDialog,
} from './sidebar-context-menu.js';

const copyIconHtml = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
`;

const pinIconHtml = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1z" />
  </svg>
`;

const noteIconHtml = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
`;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function createBuildLabel(build) {
  const label = document.createElement('span');
  label.className = 'sidebar-footer-text sidebar-build';
  if (!build) {
    label.textContent = 'dev server';
    return label;
  }
  const at = new Date(build.builtAt);
  const time = `${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  const sha = `${build.sha ?? 'no-git'}${build.dirty ? '+' : ''}`;
  label.textContent = `build ${sha} · ${time} · ${build.hash}`;
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

export function createSidebar(options) {
  const sidebar = document.createElement('aside');
  sidebar.className = 'artboard-sidebar';

  const content = document.createElement('div');
  content.className = 'sidebar-content';
  sidebar.appendChild(content);

  const scroll = document.createElement('div');
  scroll.className = 'sidebar-scroll';
  content.appendChild(scroll);

  const stickyBottom = document.createElement('div');
  stickyBottom.className = 'sidebar-sticky-bottom';
  content.appendChild(stickyBottom);

  const footer = document.createElement('div');
  footer.className = 'sidebar-footer';
  footer.appendChild(createBuildLabel(options.build));
  sidebar.appendChild(footer);

  let model = null;
  let activeArtboardId = null;
  let archiveCollapsed = true;
  let openCommentsCollapsed = false;

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'sidebar-resize';
  resizeHandle.setAttribute('aria-hidden', 'true');
  sidebar.appendChild(resizeHandle);

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
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
    sidebarWidth = next;
    applyWidth();
    options.onWidthChange?.(sidebarWidth);
  });

  function endResize(e) {
    if (!resizing) return;
    resizing = false;
    if (resizeHandle.hasPointerCapture(e.pointerId)) {
      resizeHandle.releasePointerCapture(e.pointerId);
    }
    document.body.classList.remove('sidebar-resizing');
  }

  resizeHandle.addEventListener('pointerup', endResize);
  resizeHandle.addEventListener('pointercancel', endResize);

  function setActiveStyles() {
    sidebar.querySelectorAll('.sidebar-item--artboard').forEach((item) => {
      item.classList.toggle('sidebar-item--active', item.dataset.id === activeArtboardId);
    });
  }

  function createSectionHeaderButton(title, collapsed, onToggle, extraText = '') {
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'sidebar-section-header sidebar-section-header-btn';
    header.innerHTML = `
      <span class="sidebar-section-chevron">${collapsed ? '▸' : '▾'}</span>
      <span class="sidebar-section-title">${title}</span>
      ${extraText ? `<span class="sidebar-section-count-inline">${extraText}</span>` : ''}
    `;
    header.addEventListener('click', onToggle);
    return header;
  }

  function createSubfolderHeader(title, label, collapsed, count, { onToggle, onFocus, focused }) {
    const header = document.createElement('div');
    header.className = 'sidebar-subfolder-header';
    header.classList.toggle('sidebar-subfolder-header--focused', focused);
    header.dataset.group = title;

    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'sidebar-subfolder-chevron';
    chevron.textContent = collapsed ? '▸' : '▾';
    chevron.title = collapsed ? 'Expand' : 'Collapse';
    chevron.addEventListener('click', onToggle);

    const titleBtn = document.createElement('button');
    titleBtn.type = 'button';
    titleBtn.className = 'sidebar-subfolder-title';
    titleBtn.textContent = label;
    titleBtn.title = focused ? 'Show all groups' : `Show only ${label}`;
    titleBtn.addEventListener('click', onFocus);

    const countEl = document.createElement('span');
    countEl.className = 'sidebar-subfolder-count';
    countEl.textContent = String(count);

    header.append(chevron, titleBtn, countEl);
    return header;
  }

  function createArtboardRow(artboard, index, project) {
    const row = document.createElement('div');
    row.className = 'sidebar-item sidebar-item--artboard';
    row.dataset.id = artboard.id;
    row.dataset.projectId = project.id;

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'sidebar-item-body';

    const labelWrap = document.createElement('span');
    labelWrap.className = 'sidebar-item-label-wrap';

    const label = document.createElement('span');
    label.className = 'sidebar-item-label';
    label.textContent = getRowLabel(artboard);
    if (artboard.orderNumber) {
      const number = document.createElement('span');
      number.className = 'sidebar-item-number';
      number.textContent = String(artboard.orderNumber);
      body.prepend(number);
    }
    labelWrap.appendChild(label);
    body.appendChild(labelWrap);
    body.title = `${getDisplayName(artboard)}\n${artboard.id}`;

    body.addEventListener('click', () => options.onNavigateArtboard?.(artboard.id));

    const actions = document.createElement('div');
    actions.className = 'sidebar-item-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'sidebar-item-action';
    copyBtn.innerHTML = copyIconHtml;
    copyBtn.title = `Copy ${artboard.id} (shift-click: with name and file)`;
    copyBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      options.onCopyArtboard?.(artboard.id, { extended: event.shiftKey || event.altKey });
    });
    actions.appendChild(copyBtn);

    const noteBtn = document.createElement('button');
    noteBtn.type = 'button';
    noteBtn.className = 'sidebar-item-action';
    noteBtn.innerHTML = noteIconHtml;
    noteBtn.classList.toggle('sidebar-item-action--active', artboard.commentCount > 0);
    noteBtn.title = artboard.commentCount > 0 ? `Comments (${artboard.commentCount} open)` : 'Comments';
    noteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      options.onOpenComments?.(artboard.id);
    });
    actions.appendChild(noteBtn);

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'sidebar-item-action';
    pinBtn.innerHTML = pinIconHtml;
    pinBtn.classList.toggle('sidebar-item-action--active', artboard.pinned);
    pinBtn.title = artboard.pinned ? 'Unpin' : 'Pin';
    pinBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      options.onTogglePin?.(artboard.id);
    });
    actions.appendChild(pinBtn);

    row.appendChild(body);
    row.appendChild(actions);

    row.addEventListener('contextmenu', (event) => {
      showContextMenu(event, [
        {
          label: 'Edit name',
          onSelect: () => showRenameDialog(getDisplayName(artboard), (value) => options.onRenameArtboard?.(artboard.id, value)),
        },
        {
          label: artboard.pinned ? 'Unpin' : 'Pin',
          onSelect: () => options.onTogglePin?.(artboard.id),
        },
        {
          label: 'Comments...',
          onSelect: () => options.onOpenComments?.(artboard.id),
        },
        {
          label: 'Move to project...',
          onSelect: () => showProjectPickerDialog({
            projects: model.projects,
            currentProjectId: artboard.projectId,
            onSelect: (nextProjectId) => options.onMoveArtboardProject?.(artboard.id, nextProjectId),
          }),
        },
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
      ]);
    });

    return row;
  }

  function createPageRow(page, count, open) {
    const row = document.createElement('div');
    row.className = 'sidebar-tree-page';
    row.classList.toggle('sidebar-tree-page--active', page.id === model.activePage);
    row.dataset.page = page.id;

    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'sidebar-subfolder-chevron';
    chevron.textContent = open ? '▾' : '▸';
    chevron.title = open ? 'Collapse' : 'Expand';
    chevron.addEventListener('click', () => options.onToggleNode?.(pageNodeKey(page.id)));

    const label = document.createElement('a');
    label.className = 'sidebar-tree-page-label';
    label.href = `#${page.id}`;
    label.title = page.label;
    label.textContent = page.label;
    label.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      options.onSelectPage?.(page.id);
    });

    const countEl = document.createElement('span');
    countEl.className = 'sidebar-page-count';
    countEl.textContent = String(count);

    row.append(chevron, label, countEl);
    return row;
  }

  function groupArtboards(artboards) {
    const groups = new Map();
    artboards.forEach((artboard) => {
      if (!groups.has(artboard.group)) groups.set(artboard.group, []);
      groups.get(artboard.group).push(artboard);
    });
    const rank = (name) => {
      const index = model.groupOrder.indexOf(name);
      return index === -1 ? model.groupOrder.length : index;
    };
    return [...groups.entries()]
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([name, rows]) => ({ name, artboards: rows }));
  }

  function appendArtboardList(container, artboards, project) {
    const list = document.createElement('div');
    list.className = 'sidebar-subfolder-list';
    artboards.forEach((artboard, index) => {
      list.appendChild(createArtboardRow(artboard, index, project));
    });
    container.appendChild(list);
  }

  function appendPageChildren(container, page, artboards, project, expanded) {
    const groups = groupArtboards(artboards);
    if (groups.length < 2) {
      appendArtboardList(container, artboards, project);
      return;
    }
    groups.forEach((group) => {
      const key = groupNodeKey(page, group.name);
      const open = expanded.has(key);
      const header = createSubfolderHeader(group.name, group.artboards[0].groupLabel, !open, group.artboards.length, {
        focused: model.focusGroup === group.name,
        onToggle: () => options.onToggleNode?.(key),
        onFocus: () => options.onFocusGroup?.(group.name, { page, nodeKey: key }),
      });
      header.dataset.page = page ?? '';
      container.appendChild(header);
      if (open) appendArtboardList(container, group.artboards, project);
    });
  }

  function buildProjectsSection() {
    const section = document.createElement('section');
    section.className = 'sidebar-section sidebar-section--projects';
    const expanded = new Set(model.ui?.expanded || []);

    model.projects.forEach((project) => {
      const projectWrap = document.createElement('div');
      projectWrap.className = 'sidebar-project';
      projectWrap.dataset.projectId = project.id;

      const projectHeader = document.createElement('button');
      projectHeader.type = 'button';
      projectHeader.className = 'sidebar-project-header sidebar-project-header-btn';
      projectHeader.addEventListener('click', () => {
        options.onSelectActiveProject?.(project.id);
        options.onToggleProjectCollapse?.(project.id);
      });

      const chevron = document.createElement('span');
      chevron.className = 'sidebar-project-chevron';
      chevron.textContent = project.collapsed ? '▸' : '▾';
      projectHeader.appendChild(chevron);

      const title = document.createElement('span');
      title.className = 'sidebar-project-title';
      title.textContent = project.name;
      title.classList.toggle('sidebar-project-title--active', model.activeProjectId === project.id);
      projectHeader.appendChild(title);

      projectWrap.appendChild(projectHeader);

      const list = document.createElement('div');
      list.className = 'sidebar-project-list';
      list.classList.toggle('sidebar-project-list--collapsed', project.collapsed);
      projectWrap.appendChild(list);

      const projectArtboards = model.artboardsByProject[project.id] || [];

      if (!project.collapsed) {
        if (model.focusGroup) {
          const showAll = document.createElement('button');
          showAll.type = 'button';
          showAll.className = 'sidebar-show-all';
          const focusedRow = projectArtboards.find((artboard) => artboard.group === model.focusGroup);
          showAll.textContent = `Showing ${focusedRow?.groupLabel ?? model.focusGroup} · show all`;
          showAll.addEventListener('click', () => options.onFocusGroup?.(model.focusGroup, { page: model.activePage }));
          list.appendChild(showAll);
        }

        if (model.pages.length < 2) {
          appendPageChildren(list, model.pages[0]?.id ?? null, projectArtboards, project, expanded);
        } else {
          const byPage = new Map();
          projectArtboards.forEach((artboard) => {
            if (!byPage.has(artboard.page)) byPage.set(artboard.page, []);
            byPage.get(artboard.page).push(artboard);
          });
          model.pages.forEach((page) => {
            const artboards = byPage.get(page.id);
            if (!artboards) return;
            const open = expanded.has(pageNodeKey(page.id));
            list.appendChild(createPageRow(page, artboards.length, open));
            if (!open) return;
            const children = document.createElement('div');
            children.className = 'sidebar-tree-children';
            appendPageChildren(children, page.id, artboards, project, expanded);
            list.appendChild(children);
          });
        }
      }

      section.appendChild(projectWrap);
    });

    return section;
  }

  function buildOpenCommentsSection() {
    const section = document.createElement('section');
    section.className = 'sidebar-section sidebar-section--open-comments';
    section.appendChild(createSectionHeaderButton('Open comments', openCommentsCollapsed, () => {
      openCommentsCollapsed = !openCommentsCollapsed;
      render(model);
    }, String(model.openComments.length)));

    const list = document.createElement('div');
    list.className = 'sidebar-open-comments';
    list.hidden = openCommentsCollapsed;
    section.appendChild(list);

    if (!model.openComments.length) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-open-comments-empty';
      empty.textContent = 'None on this page';
      list.appendChild(empty);
    }

    model.openComments.forEach((row) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sidebar-open-comment';
      item.dataset.id = row.id;
      item.title = `${row.id}\n${row.text}`;

      const where = document.createElement('span');
      where.className = 'sidebar-open-comment-where';
      where.textContent = `${row.groupLabel} ${row.number} · ${row.title}${row.count > 1 ? ` (${row.count})` : ''}`;
      const text = document.createElement('span');
      text.className = 'sidebar-open-comment-text';
      text.textContent = row.text;
      item.append(where, text);
      item.addEventListener('click', () => options.onOpenComments?.(row.id));
      list.appendChild(item);
    });

    return section;
  }

  function buildArchiveSection() {
    const section = document.createElement('section');
    section.className = 'sidebar-section sidebar-section--archive';

    const header = createSectionHeaderButton('Archive', archiveCollapsed, () => {
      archiveCollapsed = !archiveCollapsed;
      render(model);
    }, String(model.archivedArtboards.length));
    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'sidebar-archive-list';
    list.classList.toggle('sidebar-archive-list--collapsed', archiveCollapsed);
    section.appendChild(list);

    model.archivedArtboards.forEach((artboard) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sidebar-item sidebar-item--archived';
      item.textContent = `${getDisplayName(artboard)} (${artboard.id})`;
      item.addEventListener('click', () => options.onRestoreArtboard?.(artboard.id));
      item.addEventListener('contextmenu', (event) => {
        showContextMenu(event, [
          {
            label: 'Edit name',
            onSelect: () => showRenameDialog(getDisplayName(artboard), (value) => options.onRenameArtboard?.(artboard.id, value)),
          },
          {
            label: 'Restore',
            onSelect: () => options.onRestoreArtboard?.(artboard.id),
          },
        ]);
      });
      list.appendChild(item);
    });

    return section;
  }

  function render(nextModel) {
    model = nextModel;
    if (model.ui?.leftSidebarWidth) {
      sidebarWidth = model.ui.leftSidebarWidth;
      applyWidth();
    }
    scroll.innerHTML = '';
    stickyBottom.innerHTML = '';

    scroll.appendChild(buildProjectsSection());
    stickyBottom.appendChild(buildOpenCommentsSection());
    stickyBottom.appendChild(buildArchiveSection());
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
