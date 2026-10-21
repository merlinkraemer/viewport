import './review.css';

const commentIconHtml = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
`;

export function variationElements(root) {
  const labelled = [...root.querySelectorAll('[data-variant]')].filter((el) => el.dataset.variant);
  const outermost = labelled.filter((el) => !labelled.some((other) => other !== el && other.contains(el)));
  return outermost.length > 1 ? outermost : [];
}

export function variationKey(artboardId, el) {
  return `${artboardId}#${el.dataset.variant}`;
}

function button(className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

export function createVariantBar({ mount, comments, onOpenComments }) {
  const outline = document.createElement('div');
  outline.className = 'variant-outline';
  const bar = document.createElement('div');
  bar.className = 'variant-bar';
  const name = document.createElement('span');
  name.className = 'variant-bar__name';
  const commentBtn = button('variant-bar__btn', () => {
    if (!current) return;
    locked = true;
    onOpenComments(current.key, commentBtn);
  });
  commentBtn.innerHTML = commentIconHtml;
  const count = document.createElement('span');
  commentBtn.appendChild(count);
  bar.append(name, commentBtn);
  document.body.append(outline, bar);

  let current = null;
  let locked = false;

  function hit(target) {
    const body = target instanceof Element ? target.closest('.ff-card__body') : null;
    if (!body) return null;
    const el = variationElements(body).find((variant) => variant.contains(target));
    if (!el) return null;
    const artboardId = body.closest('[data-artboard-id]').dataset.artboardId;
    return { el, key: variationKey(artboardId, el) };
  }

  function refresh() {
    if (!current) return;
    name.textContent = current.el.dataset.variant;
    const open = comments.openCount(current.key);
    count.textContent = open ? String(open) : '';
    commentBtn.title = `Comment on ${current.key}`;
  }

  function position() {
    if (!current) return;
    if (!current.el.isConnected || !current.el.getClientRects().length) {
      if (!locked) show(null);
      return;
    }
    const rect = current.el.getBoundingClientRect();
    Object.assign(outline.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    bar.style.top = `${rect.top + 6}px`;
    bar.style.left = `${Math.max(rect.left + 6, rect.right - bar.offsetWidth - 6)}px`;
  }

  function show(next) {
    current = next;
    outline.classList.toggle('variant-outline--on', Boolean(next));
    bar.classList.toggle('variant-bar--on', Boolean(next));
    refresh();
    position();
  }

  mount.addEventListener('pointermove', (event) => {
    if (locked || event.buttons) return;
    const next = hit(event.target);
    if (next?.el !== current?.el) show(next);
  });
  mount.addEventListener('pointerleave', (event) => {
    if (!locked && !bar.contains(event.relatedTarget)) show(null);
  });
  bar.addEventListener('pointerleave', (event) => {
    if (!locked && !mount.contains(event.relatedTarget)) show(null);
  });

  return {
    refresh() {
      refresh();
      position();
    },
    reposition: position,
    unlock() {
      locked = false;
      position();
    },
  };
}
