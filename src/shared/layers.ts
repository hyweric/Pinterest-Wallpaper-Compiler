import type { PlaceholderLayer } from "./types";

export type LayerOrderAction = "front" | "back" | "forward" | "backward";

export function uniqueExistingLayerIds(layers: PlaceholderLayer[], ids: string[]) {
  const valid = new Set(layers.map((layer) => layer.id));
  return [...new Set(ids)].filter((id) => valid.has(id));
}

export function reorderLayerBlock(
  layers: PlaceholderLayer[],
  selectedIds: string[],
  action: LayerOrderAction
): PlaceholderLayer[] {
  const ids = new Set(uniqueExistingLayerIds(layers, selectedIds));
  if (ids.size === 0) return layers;

  if (action === "front") {
    return [...layers.filter((layer) => !ids.has(layer.id)), ...layers.filter((layer) => ids.has(layer.id))];
  }
  if (action === "back") {
    return [...layers.filter((layer) => ids.has(layer.id)), ...layers.filter((layer) => !ids.has(layer.id))];
  }

  const next = [...layers];
  if (action === "forward") {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (ids.has(next[index].id) && !ids.has(next[index + 1].id)) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
    }
  } else {
    for (let index = 1; index < next.length; index += 1) {
      if (ids.has(next[index].id) && !ids.has(next[index - 1].id)) {
        [next[index], next[index - 1]] = [next[index - 1], next[index]];
      }
    }
  }
  return next;
}

/**
 * Moves a selected block relative to a target layer. `beforeInPanel` refers to
 * the top-to-bottom Layers panel, which is the reverse of canvas render order.
 */
export function moveLayerBlockToTarget(
  layers: PlaceholderLayer[],
  selectedIds: string[],
  targetId: string,
  beforeInPanel: boolean
): PlaceholderLayer[] {
  const ids = new Set(uniqueExistingLayerIds(layers, selectedIds));
  if (ids.size === 0 || ids.has(targetId)) return layers;
  const moving = layers.filter((layer) => ids.has(layer.id));
  const remaining = layers.filter((layer) => !ids.has(layer.id));
  const targetIndex = remaining.findIndex((layer) => layer.id === targetId);
  if (targetIndex < 0) return layers;

  // The panel is reversed: above the target means after it in render order.
  const insertIndex = beforeInPanel ? targetIndex + 1 : targetIndex;
  return [...remaining.slice(0, insertIndex), ...moving, ...remaining.slice(insertIndex)];
}

export function layerSelectionRange(layers: PlaceholderLayer[], anchorId: string, targetId: string) {
  const panelOrder = [...layers].reverse();
  const anchorIndex = panelOrder.findIndex((layer) => layer.id === anchorId);
  const targetIndex = panelOrder.findIndex((layer) => layer.id === targetId);
  if (anchorIndex < 0 || targetIndex < 0) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return panelOrder.slice(start, end + 1).map((layer) => layer.id);
}

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layersIntersectingRect(layers: PlaceholderLayer[], rect: SelectionRect) {
  return layers
    .filter((layer) => !layer.hidden && !layer.locked)
    .filter((layer) => layer.x < rect.x + rect.width
      && layer.x + layer.width > rect.x
      && layer.y < rect.y + rect.height
      && layer.y + layer.height > rect.y)
    .map((layer) => layer.id);
}
