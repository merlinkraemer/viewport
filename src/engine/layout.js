import { artboardGroup, sortGroups } from './config.js';

export const LAYOUT_ORIGIN = { x: 48, y: 56 };
export const BAND_PADDING = 24;
const HEADER_HEIGHT = 44;
const QUESTION_HEIGHT = 26;
const CARD_GAP = 48;
const GROUP_GAP = 120;
const ROW_WIDTH = 2400;
const WIDE_WIDTH = 1200;
const COLUMN_WIDTH_RATIO = 3;
const DEFAULT_SIZE = { width: 320, height: 260 };

export function groupHeaderHeight(question) {
  return HEADER_HEIGHT + (question ? QUESTION_HEIGHT : 0);
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function padded(rect) {
  return {
    x: rect.x - CARD_GAP,
    y: rect.y - CARD_GAP,
    width: rect.width + CARD_GAP * 2,
    height: rect.height + CARD_GAP * 2,
  };
}

function compareEntries(a, b) {
  const orderA = Number.isFinite(a.entry.order) ? a.entry.order : Infinity;
  const orderB = Number.isFinite(b.entry.order) ? b.entry.order : Infinity;
  if (orderA !== orderB) return orderA - orderB;
  return a.index - b.index;
}

function groupQuestion(items) {
  const asked = items.find(({ entry }) => typeof entry.question === 'string' && entry.question.trim());
  return asked ? asked.entry.question.trim() : null;
}

function orderedGroups(items) {
  const sorted = items.slice().sort(compareEntries);
  return sortGroups(items.map(({ entry }) => entry))
    .map((group) => {
      const members = sorted.filter(({ entry }) => artboardGroup(entry) === group);
      return { group, question: groupQuestion(members), items: members };
    })
    .filter(({ items: members }) => members.length);
}

export function usesColumn(sizes) {
  if (!sizes.length) return false;
  const widths = sizes.map((size) => size.width);
  const widest = Math.max(...widths);
  return widest >= WIDE_WIDTH || widest > Math.min(...widths) * COLUMN_WIDTH_RATIO;
}

function layoutSet(doc, items) {
  const fixed = items
    .filter(({ id }) => doc.artboards[id].moved)
    .map(({ id }) => padded({ ...doc.artboards[id].position, ...(doc.artboards[id].size || DEFAULT_SIZE) }));
  const left = LAYOUT_ORIGIN.x;
  let y = LAYOUT_ORIGIN.y;

  orderedGroups(items).forEach(({ question, items: members }) => {
    const cards = members.filter(({ id }) => !doc.artboards[id].moved);
    if (!cards.length) return;
    y += groupHeaderHeight(question);
    const sizeOf = (id) => doc.artboards[id].size || DEFAULT_SIZE;
    const column = usesColumn(cards.map(({ id }) => sizeOf(id)));
    let x = left;
    let rowHeight = 0;

    const newRow = (minY = 0) => {
      y = Math.max(y + (rowHeight ? rowHeight + CARD_GAP : 0), minY);
      x = left;
      rowHeight = 0;
    };

    cards.forEach(({ id }) => {
      const size = sizeOf(id);
      if (x > left && (column || x + size.width > left + ROW_WIDTH)) newRow();

      for (let guard = 0; guard < 1000; guard += 1) {
        const rect = { x, y, ...size };
        const blocker = fixed.find((other) => intersects(rect, other));
        if (!blocker) break;
        x = blocker.x + blocker.width;
        if (x > left && x + size.width > left + ROW_WIDTH) newRow(blocker.y + blocker.height);
      }

      doc.artboards[id].position = { x, y };
      rowHeight = Math.max(rowHeight, size.height);
      x += size.width + CARD_GAP;
    });

    y += (rowHeight ? rowHeight : -CARD_GAP) + GROUP_GAP;
  });
}

function collectSets(doc, registry) {
  const sets = new Map();
  registry.forEach((entry, index) => {
    const artboard = doc.artboards[entry.id];
    if (!artboard || artboard.archived || artboard.orphaned) return;
    const key = `${artboard.projectId}\u0000${artboard.page ?? ''}`;
    if (!sets.has(key)) sets.set(key, []);
    sets.get(key).push({ id: entry.id, entry, index });
  });
  return sets;
}

export function layoutPages(doc, registry) {
  collectSets(doc, registry).forEach((items) => layoutSet(doc, items));
  return doc;
}

export function readingOrder(doc, registry) {
  const groups = [];
  collectSets(doc, registry).forEach((items) => {
    const page = doc.artboards[items[0].id].page;
    const projectId = doc.artboards[items[0].id].projectId;
    orderedGroups(items).forEach(({ group, question, items: members }) => {
      groups.push({ page, projectId, group, question, ids: members.map(({ id }) => id) });
    });
  });
  return groups;
}
