import type { ImageSource, LocalImageRef, PlaceholderLayer, WallpaperProject } from "./types.js";
import { eligibleImages } from "./source-selection.js";

type PoolImage = { source: ImageSource; image: LocalImageRef };

function layerSourceIds(layer: PlaceholderLayer) {
  return layer.sourceState.sourceIds.length ? layer.sourceState.sourceIds : layer.sourceId ? [layer.sourceId] : [];
}

function collectPool(project: WallpaperProject, layer: PlaceholderLayer): PoolImage[] {
  const sourcesById = new Map(project.sources.map((source) => [source.id, source]));
  return layerSourceIds(layer).flatMap((sourceId) => {
    const source = sourcesById.get(sourceId);
    if (!source) return [];
    return eligibleImages(source).map((image) => ({ source, image }));
  });
}

function shuffleWith<T>(items: T[], random: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function compactRecentImageIds(currentIds: string[], chosenId: string, validIds: Set<string>) {
  const compacted = currentIds.filter((id) => validIds.has(id) && id !== chosenId);
  compacted.push(chosenId);
  const limit = Math.max(1, Math.min(validIds.size, 48));
  return compacted.slice(-limit);
}

export function advancePreviewProjectImages(project: WallpaperProject, random: () => number = Math.random): WallpaperProject {
  const usedThisPreview = new Set<string>();
  const layers = project.layers.map((layer) => {
    if (layer.hidden) return layer;
    const pool = collectPool(project, layer);
    if (!pool.length) return layer;

    const currentImageId = layer.generatedImageId ?? layer.selectedImageId;
    const validIds = new Set(pool.map((item) => item.image.id));
    const recentlyUsed = new Set(layer.sourceState.usedImageIds.filter((id) => validIds.has(id)));
    const sourceIds = layerSourceIds(layer);

    const candidatesWithoutRecent = pool.filter((item) => {
      const id = item.image.id;
      return !usedThisPreview.has(id)
        && (pool.length <= 1 || id !== currentImageId)
        && !recentlyUsed.has(id);
    });
    const candidatesAllowingRecent = pool.filter((item) => {
      const id = item.image.id;
      return !usedThisPreview.has(id) && (pool.length <= 1 || id !== currentImageId);
    });
    const candidatesAllowingCurrent = pool.filter((item) => !usedThisPreview.has(item.image.id));
    const candidates = candidatesWithoutRecent.length
      ? candidatesWithoutRecent
      : candidatesAllowingRecent.length
        ? candidatesAllowingRecent
        : candidatesAllowingCurrent.length
          ? candidatesAllowingCurrent
          : pool;
    const choice = shuffleWith(candidates, random)[0];
    if (!choice) return layer;

    usedThisPreview.add(choice.image.id);
    const nextQueue = shuffleWith(pool.map((item) => item.image.id).filter((id) => id !== choice.image.id), random);
    return {
      ...layer,
      sourceId: choice.source.id,
      selectedImageId: layer.sourceState.mode === "fixed" ? choice.image.id : layer.selectedImageId,
      generatedImageId: choice.image.id,
      cropMode: "cover" as const,
      sourceState: {
        ...layer.sourceState,
        sourceIds: sourceIds.length ? sourceIds : [choice.source.id],
        mode: layer.sourceState.mode === "fixed" ? "fixed" as const : "shuffle" as const,
        shuffleQueue: nextQueue,
        usedImageIds: compactRecentImageIds(layer.sourceState.usedImageIds, choice.image.id, validIds),
        preventDuplicates: pool.length > 1
      }
    };
  });
  return { ...project, layers };
}
