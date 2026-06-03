/*
 * Deterministic auto-grid. Artboards are grouped into one column per layer
 * (taxonomy supplied by the host via engine config), stacked top-to-bottom in
 * each column. Saved positions (manual drags) override the computed slot.
 */
import { layerOrder } from './config.js';

const COL_X = 48; // first column x
const COL_GAP = 520; // horizontal gap between layer columns
const ROW_Y = 48; // first row y
const ROW_GAP = 360; // vertical gap between cards in a column

export function autoGrid(registry, savedPositions = {}) {
  const order = layerOrder();
  const counts = {}; // per-layer row counter
  return registry.map((entry) => {
    const colIndex = Math.max(0, order.indexOf(entry.layer));
    const rowIndex = counts[entry.layer] ?? 0;
    counts[entry.layer] = rowIndex + 1;
    const slot = {
      x: COL_X + colIndex * COL_GAP,
      y: ROW_Y + rowIndex * ROW_GAP,
    };
    return { ...entry, position: savedPositions[entry.id] || slot };
  });
}
