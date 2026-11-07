import './phone.css';
import { isPhone, onPhoneChange } from './phone.js';

const menuIconHtml = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
`;

const commentIconHtml = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
`;

function button(className, label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

export function createPhoneUi({ onFitBoard, onComment, onCopyId, onRename, onClearSelection }) {
  const bar = document.createElement('header');
  bar.className = 'phone-bar';
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'phone-bar__menu';
  menuBtn.setAttribute('aria-label', 'Pages');
  menuBtn.innerHTML = menuIconHtml;
  const title = document.createElement('span');
  title.className = 'phone-bar__title';
  bar.append(menuBtn, title);

  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';

  const toolbar = document.createElement('div');
  toolbar.className = 'board-toolbar';
  const toolbarTitle = document.createElement('span');
  toolbarTitle.className = 'board-toolbar__title';
  const closeBtn = button('board-toolbar__close', '✕', () => onClearSelection());
  closeBtn.setAttribute('aria-label', 'Clear selection');
  const head = document.createElement('div');
  head.className = 'board-toolbar__head';
  head.append(toolbarTitle, closeBtn);
  const commentBtn = button('board-toolbar__btn', '', () => onComment(commentBtn));
  commentBtn.innerHTML = commentIconHtml;
  const commentLabel = document.createElement('span');
  commentBtn.append(commentLabel);
  const actions = document.createElement('div');
  actions.className = 'board-toolbar__actions';
  actions.append(
    commentBtn,
    button('board-toolbar__btn', 'Copy id', onCopyId),
    button('board-toolbar__btn', 'Rename', onRename),
    button('board-toolbar__btn', 'Fit', onFitBoard),
  );
  toolbar.append(head, actions);

  document.body.append(bar, backdrop, toolbar);

  function setDrawer(open) {
    document.body.classList.toggle('drawer-open', open && isPhone());
  }

  menuBtn.addEventListener('click', () => setDrawer(!document.body.classList.contains('drawer-open')));
  backdrop.addEventListener('click', () => setDrawer(false));
  onPhoneChange(() => setDrawer(false));

  return {
    openDrawer: () => setDrawer(true),
    closeDrawer: () => setDrawer(false),
    setTitle(text) {
      title.textContent = text;
    },
    showBoard(name, openComments, totalComments) {
      toolbarTitle.textContent = name;
      commentLabel.textContent = totalComments ? `Comment ${openComments}/${totalComments}` : 'Comment';
      toolbar.classList.add('board-toolbar--on');
      document.body.classList.add('has-selection');
    },
    hideBoard() {
      toolbar.classList.remove('board-toolbar--on');
      document.body.classList.remove('has-selection');
    },
  };
}
