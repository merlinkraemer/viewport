import { artboardGroup, sortGroups } from './config.js';

export const LAYOUT_ORIGIN = { x: 48, y: 56 };
export const BAND_PADDING = 24;
export const GROUP_HEADER_HEIGHT = 44;
const CARD_GAP = 48;
const GROUP_GAP = 120;
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

function orderedGroups(items) {
  const sorted = items.slice().sort(compareEntries);
  return sortGroups(items.map(({ entry }) => entry))
    .map((group) => {
      const members = sorted.filter(({ entry }) => artboardGroup(entry) === group);
      return { group, items: members };
    })
    .filter(({ items: members }) => members.length);
}

function layoutSet(doc, items) {
  const fixed = items
    .filter(({ id }) => doc.artboards[id].moved)
    .map(({ id }) => padded({ ...doc.artboards[id].position, ...(doc.artboards[id].size || DEFAULT_SIZE) }));
  const left = LAYOUT_ORIGIN.x;
  let y = LAYOUT_ORIGIN.y;

  orderedGroups(items).forEach(({ items: members }) => {
    const cards = members.filter(({ id }) => !doc.artboards[id].moved);
    if (!cards.length) return;
    y += GROUP_HEADER_HEIGHT;
    const sizeOf = (id) => doc.artboards[id].size || DEFAULT_SIZE;
    let x = left;
    let rowHeight = 0;

    cards.forEach(({ id }) => {
      const size = sizeOf(id);

      for (let guard = 0; guard < 1000; guard += 1) {
        const rect = { x, y, ...size };
        const blocker = fixed.find((other) => intersects(rect, other));
        if (!blocker) break;
        x = blocker.x + blocker.width;
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
    orderedGroups(items).forEach(({ group, items: members }) => {
      groups.push({ page, projectId, group, ids: members.map(({ id }) => id) });
    });
  });
  return groups;
}
