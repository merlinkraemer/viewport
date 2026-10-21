function isTyping(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

const NEXT_KEYS = new Set(['ArrowRight', 'j', 'J']);
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'k', 'K']);
const COMMENT_KEYS = new Set(['c', 'C']);

export function createReview({ canvas, openComments, closeComments }) {
  const readout = document.createElement('div');
  readout.className = 'review-readout';
  const position = document.createElement('span');
  position.className = 'review-readout__position';
  const group = document.createElement('span');
  group.className = 'review-readout__group';
  const keys = document.createElement('span');
  keys.className = 'review-readout__keys';
  keys.textContent = '← → or J K to step · C to comment';
  readout.append(position, group, keys);
  document.body.appendChild(readout);

  function currentIndex(sequence) {
    return sequence.findIndex((step) => step.id === canvas.currentId());
  }

  function update() {
    const sequence = canvas.reviewSequence();
    const index = currentIndex(sequence);
    readout.hidden = !sequence.length;
    if (index === -1) {
      position.textContent = `${sequence.length} cards`;
      group.textContent = '';
      return;
    }
    const step = sequence[index];
    position.textContent = `${step.index + 1} / ${step.groupIds.length}`;
    group.textContent = `${step.label} · ${index + 1} of ${sequence.length} on this page`;
  }

  function move(delta) {
    const sequence = canvas.reviewSequence();
    if (!sequence.length) return;
    const index = currentIndex(sequence);
    const next = index === -1
      ? (delta > 0 ? 0 : sequence.length - 1)
      : Math.max(0, Math.min(sequence.length - 1, index + delta));
    closeComments();
    canvas.reviewCard(sequence[next]);
    update();
  }

  function comment() {
    const sequence = canvas.reviewSequence();
    if (!sequence.length) return;
    if (currentIndex(sequence) === -1) canvas.reviewCard(sequence[0]);
    update();
    openComments(canvas.currentId());
  }

  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    if (NEXT_KEYS.has(event.key)) move(1);
    else if (PREVIOUS_KEYS.has(event.key)) move(-1);
    else if (COMMENT_KEYS.has(event.key)) comment();
    else return;
    event.preventDefault();
  });

  return { update };
}
