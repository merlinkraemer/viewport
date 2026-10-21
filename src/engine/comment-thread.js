import './comments.css';

const PANEL_WIDTH = 300;
const EDGE = 8;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatTime(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return `${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

function button(className, text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

function submitOnModEnter(textarea, submit) {
  textarea.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });
}

export function createCommentThread(store, { onOpen, onClose } = {}) {
  let panel = null;
  let titleEl = null;
  let listEl = null;
  let statusEl = null;
  let composer = null;
  let addBtn = null;
  let artboardId = null;
  let anchor = null;
  let editing = null;
  let errorText = '';

  async function run(task) {
    errorText = '';
    try {
      await task();
    } catch (err) {
      errorText = err.message;
    }
    render();
  }

  function sortedComments() {
    return [...store.list(artboardId)].sort((a, b) => (
      Number(Boolean(a.resolved)) - Number(Boolean(b.resolved)) || String(a.at).localeCompare(String(b.at))
    ));
  }

  function renderComment(comment) {
    const item = document.createElement('div');
    item.className = 'comment-item';
    item.classList.toggle('comment-item--resolved', Boolean(comment.resolved));
    item.dataset.commentId = comment.id;

    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    const time = document.createElement('span');
    time.textContent = formatTime(comment.at);
    meta.appendChild(time);
    if (comment.by) {
      const by = document.createElement('span');
      by.className = 'comment-by';
      by.textContent = comment.by;
      meta.appendChild(by);
    }
    const spacer = document.createElement('span');
    spacer.className = 'comment-spacer';
    meta.appendChild(spacer);

    if (editing?.id === comment.id) {
      const input = document.createElement('textarea');
      input.className = 'comment-input comment-edit';
      input.value = editing.text;
      input.addEventListener('input', () => {
        editing.text = input.value;
      });
      const save = () => {
        const text = editing.text.trim();
        if (!text) return;
        editing = null;
        run(() => store.update(artboardId, comment.id, { text }));
      };
      submitOnModEnter(input, save);
      meta.append(
        button('comment-action', 'Cancel', () => {
          editing = null;
          render();
        }),
        button('comment-action comment-action--primary', 'Save', save),
      );
      item.append(input, meta);
      requestAnimationFrame(() => input.focus());
      return item;
    }

    const text = document.createElement('div');
    text.className = 'comment-text';
    text.textContent = comment.text;
    meta.append(
      button('comment-action', 'Edit', () => {
        editing = { id: comment.id, text: comment.text };
        render();
      }),
      button('comment-action', comment.resolved ? 'Reopen' : 'Resolve', () => {
        run(() => store.update(artboardId, comment.id, { resolved: !comment.resolved }));
      }),
    );
    item.append(text, meta);
    return item;
  }

  function render() {
    if (!panel) return;
    const comments = sortedComments();
    const open = comments.filter((comment) => !comment.resolved).length;
    titleEl.textContent = `${artboardId} · ${open} open`;
    listEl.replaceChildren(...comments.map(renderComment));
    if (!comments.length) {
      const empty = document.createElement('div');
      empty.className = 'comment-empty';
      empty.textContent = 'No comments yet.';
      listEl.appendChild(empty);
    }
    const available = store.isAvailable();
    composer.disabled = !available;
    addBtn.disabled = !available;
    statusEl.textContent = errorText || (available ? '' : `Read only: ${store.error() || 'no comments server'}`);
    statusEl.hidden = !statusEl.textContent;
    position();
  }

  function position() {
    if (!panel || !anchor?.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(EDGE, rect.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - EDGE);
    let top = rect.bottom + 6;
    if (top + panel.offsetHeight > window.innerHeight - EDGE) {
      top = Math.max(EDGE, rect.top - panel.offsetHeight - 6);
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function onOutside(event) {
    if (panel && !panel.contains(event.target) && !anchor?.contains(event.target)) close();
  }

  function onKey(event) {
    if (event.key === 'Escape' && panel) close();
  }

  function close() {
    const wasOpen = Boolean(panel);
    panel?.remove();
    panel = null;
    artboardId = null;
    anchor = null;
    editing = null;
    errorText = '';
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey);
    if (wasOpen) onClose?.();
  }

  function build() {
    panel = document.createElement('div');
    panel.className = 'comment-thread';
    panel.style.width = `${PANEL_WIDTH}px`;

    const header = document.createElement('div');
    header.className = 'comment-thread-header';
    titleEl = document.createElement('span');
    titleEl.className = 'comment-thread-title';
    header.append(titleEl, button('comment-action', '✕', close));

    listEl = document.createElement('div');
    listEl.className = 'comment-list';

    composer = document.createElement('textarea');
    composer.className = 'comment-input';
    composer.placeholder = 'Add a comment… (⌘/Ctrl+Enter)';
    const add = () => {
      const text = composer.value.trim();
      if (!text) return;
      run(async () => {
        await store.add(artboardId, text);
        composer.value = '';
      });
    };
    submitOnModEnter(composer, add);
    addBtn = button('comment-action comment-action--primary', 'Comment', add);

    const footer = document.createElement('div');
    footer.className = 'comment-composer';
    statusEl = document.createElement('div');
    statusEl.className = 'comment-status';
    footer.append(composer, statusEl, addBtn);

    panel.append(header, listEl, footer);
    document.body.appendChild(panel);
  }

  function open(id, anchorEl) {
    if (panel && artboardId === id) {
      close();
      return;
    }
    close();
    artboardId = id;
    anchor = anchorEl;
    onOpen?.(id);
    build();
    render();
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => composer?.focus());
    store.load();
  }

  return {
    open,
    close,
    refresh: render,
    reposition: position,
  };
}
