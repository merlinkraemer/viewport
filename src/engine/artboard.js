import './artboard.css';
import { el } from './dom.js';

const pinIconHtml = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1z" />
  </svg>
`;

const commentIconHtml = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
`;

export function createArtboard(title, contentEl, { layer = 'primitive', id, file } = {}) {
  const dims = el('span', { class: 'ff-card__dims', text: '' });
  const orderEl = el('span', { class: 'ff-card__order', text: '' });
  orderEl.hidden = true;
  const titleEl = el('span', { class: 'ff-card__title', text: title });
  titleEl.title = 'Click to copy id, drag to move. Shift-click to add to the selection.';

  const renameBtn = el('button', { class: 'ff-card__rename', text: '✎', type: 'button' });
  renameBtn.setAttribute('aria-label', `Rename "${title}"`);
  renameBtn.hidden = true;

  const pinBtn = el('button', { class: 'ff-card__pin', type: 'button' });
  pinBtn.setAttribute('aria-label', `Pin "${title}"`);
  pinBtn.setAttribute('aria-pressed', 'false');
  pinBtn.innerHTML = pinIconHtml;

  const idBtn = el('button', { class: 'ff-card__id', type: 'button', text: id });
  idBtn.title = file
    ? `Click to copy id (${file}). Shift-click to add to the selection.`
    : 'Click to copy id. Shift-click to add to the selection.';

  const commentBtn = el('button', { class: 'ff-card__comments', type: 'button' });
  commentBtn.innerHTML = commentIconHtml;
  const commentCount = el('span', { class: 'ff-card__comments-count', text: '' });
  commentBtn.appendChild(commentCount);
  commentBtn.title = 'Comments';

  const titleRow = el('div', { class: 'ff-card__title-row' }, [
    orderEl,
    titleEl,
    renameBtn,
    pinBtn,
  ]);

  const header = el('div', { class: 'ff-card__header' }, [
    titleRow,
    el('div', { class: 'ff-card__meta' }, [commentBtn, idBtn, dims]),
  ]);
  const body = el('div', { class: 'ff-card__body' }, [contentEl]);
  const card = el('div', { class: 'ff-card', dataset: { layer } }, [header, body]);

  const update = () => {
    dims.textContent = `${Math.round(body.offsetWidth)} × ${Math.round(body.offsetHeight)}`;
  };
  requestAnimationFrame(update);
  new ResizeObserver(update).observe(body);

  card.handle = titleRow;
  card.titleEl = titleEl;
  card.renameBtn = renameBtn;
  card.pinBtn = pinBtn;
  card.idBtn = idBtn;
  card.commentBtn = commentBtn;
  card.setCommentCount = (open, total) => {
    commentCount.textContent = open ? String(open) : '';
    commentBtn.classList.toggle('ff-card__comments--open', open > 0);
    commentBtn.classList.toggle('ff-card__comments--any', total > 0);
    commentBtn.title = total ? `Comments: ${open} open of ${total}` : 'Add a comment';
  };
  card.setOrderNumber = (number) => {
    orderEl.textContent = String(number);
    orderEl.hidden = !number;
  };
  card.bodyEl = body;
  return card;
}
