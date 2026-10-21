import { artboardGroup } from './config.js';

export const LAYOUT_ORIGIN = { x: 48, y: 56 };
export const GROUP_HEADER_HEIGHT = 40;
const CARD_GAP = 48;
const GROUP_GAP = 96;
const ROW_WIDTH = 2400;
const WIDE_WIDTH = 1200;
const DEFAULT_SIZE = { width: 320, height: 260 };

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

export function pageGroups(entries) {
  return [...new Set(entries.map((entry) => artboardGroup(entry)))];
}

function layoutSet(doc, items) {
  const fixed = items
    .filter(({ id }) => doc.artboards[id].moved)
    .map(({ id }) => padded({ ...doc.artboards[id].position, ...(doc.artboards[id].size || DEFAULT_SIZE) }));
  const auto = items.filter(({ id }) => !doc.artboards[id].moved).sort(compareEntries);
  const groups = pageGroups(items.map(({ entry }) => entry));
  const withHeaders = groups.length > 1;
  const left = LAYOUT_ORIGIN.x;
  let y = LAYOUT_ORIGIN.y;

  groups.forEach((group) => {
    const cards = auto.filter(({ entry }) => artboardGroup(entry) === group);
    if (!cards.length) return;
    if (withHeaders) y += GROUP_HEADER_HEIGHT;
    let x = left;
    let rowHeight = 0;

    const newRow = (minY = 0) => {
      y = Math.max(y + (rowHeight ? rowHeight + CARD_GAP : 0), minY);
      x = left;
      rowHeight = 0;
    };

    cards.forEach(({ id }) => {
      const size = doc.artboards[id].size || DEFAULT_SIZE;
      const wide = size.width >= WIDE_WIDTH;
      if (x > left && (wide || x + size.width > left + ROW_WIDTH)) newRow();

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
      if (wide) newRow();
    });

    y += (rowHeight ? rowHeight : -CARD_GAP) + GROUP_GAP;
  });
}

export function layoutPages(doc, registry) {
  const sets = new Map();
  registry.forEach((entry, index) => {
    const artboard = doc.artboards[entry.id];
    if (!artboard || artboard.archived || artboard.orphaned) return;
    const key = `${artboard.projectId}\u0000${artboard.page ?? ''}`;
    if (!sets.has(key)) sets.set(key, []);
    sets.get(key).push({ id: entry.id, entry, index });
  });
  sets.forEach((items) => layoutSet(doc, items));
  return doc;
}
