import type { ImageSource, LocalImageRef, WallpaperProject } from "./types.js";

function eligibleImages(source: ImageSource): LocalImageRef[] {
  if (source.mediaPolicy === "images-and-video-thumbnails") return source.images;
  return source.images.filter((image) => image.mediaType !== "video");
}

export function selectImagesForGeneration(
  project: WallpaperProject,
  random: () => number = Math.random
): { project: WallpaperProject; assignments: Record<string, string> } {
  const sources = project.sources.map((source) => ({
    ...source,
    selectionState: {
      shuffleQueue: [...(source.selectionState?.shuffleQueue ?? [])],
      cycle: source.selectionState?.cycle ?? 0,
      lastImageByLayer: { ...(source.selectionState?.lastImageByLayer ?? {}) }
    }
  }));
  const sourceById = new Map<string, ImageSource>(sources.map((source) => [source.id, source]));
  const usedThisGeneration = new Set<string>();
  const assignments: Record<string, string> = {};

  const shuffleWith = <T,>(items: T[]) => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
  };

  const drawFromSource = (source: ImageSource, layerId: string, allowReuse: boolean) => {
    const images = eligibleImages(source);
    if (!images.length) return undefined;
    const validIds = new Set(images.map((image) => image.id));
    const state = source.selectionState!;
    let queue = state.shuffleQueue.filter((id) => validIds.has(id));
    if (!queue.length) {
      queue = shuffleWith(images.map((image) => image.id));
      const previous = state.lastImageByLayer[layerId];
      if (queue.length > 1 && previous && queue[0] === previous) [queue[0], queue[1]] = [queue[1], queue[0]];
      state.cycle += 1;
    }
    let index = queue.findIndex((id) => !usedThisGeneration.has(id));
    if (index < 0 && allowReuse) index = 0;
    if (index < 0) {
      state.shuffleQueue = queue;
      return undefined;
    }
    const imageId = queue[index];
    queue.splice(index, 1);
    state.shuffleQueue = queue;
    state.lastImageByLayer[layerId] = imageId;
    return images.find((image) => image.id === imageId);
  };

  const layers = project.layers.map((layer) => {
    if (layer.hidden) return layer;
    const sourceIds = layer.sourceState.sourceIds.length ? layer.sourceState.sourceIds : layer.sourceId ? [layer.sourceId] : [];
    const availableSources = sourceIds.map((id) => sourceById.get(id)).filter(Boolean) as ImageSource[];
    if (!availableSources.length) return layer;

    if (layer.sourceState.mode === "fixed") {
      const all = availableSources.flatMap(eligibleImages);
      const fixed = all.find((image) => image.id === layer.selectedImageId) ?? all[0];
      if (!fixed) return layer;
      assignments[layer.id] = fixed.id;
      usedThisGeneration.add(fixed.id);
      const owner = availableSources.find((source) => source.images.some((image) => image.id === fixed.id));
      return { ...layer, sourceId: owner?.id ?? layer.sourceId, generatedImageId: fixed.id };
    }

    if (layer.sourceState.mode === "shuffle" || layer.sourceState.mode === "random") {
      const orderedSources = shuffleWith(availableSources);
      let chosen: LocalImageRef | undefined;
      let owner: ImageSource | undefined;
      for (const source of orderedSources) {
        chosen = drawFromSource(source, layer.id, false);
        if (chosen) { owner = source; break; }
      }
      if (!chosen) {
        for (const source of orderedSources) {
          chosen = drawFromSource(source, layer.id, true);
          if (chosen) { owner = source; break; }
        }
      }
      if (!chosen || !owner) return layer;
      assignments[layer.id] = chosen.id;
      usedThisGeneration.add(chosen.id);
      return { ...layer, sourceId: owner.id, generatedImageId: chosen.id };
    }

    const pool = availableSources.flatMap((source) => eligibleImages(source).map((image) => ({ image, source })));
    if (!pool.length) return layer;
    let choice = pool[0];
    const state = { ...layer.sourceState };
    if (state.mode === "sequential") {
      const index = state.currentIndex % pool.length;
      choice = pool[index];
      state.currentIndex = (index + 1) % pool.length;
    } else if (state.mode === "newest" || state.mode === "oldest") {
      choice = [...pool].sort((a, b) => {
        const at = Date.parse(a.image.modifiedAt ?? "1970-01-01");
        const bt = Date.parse(b.image.modifiedAt ?? "1970-01-01");
        return state.mode === "newest" ? bt - at : at - bt;
      })[0];
    }
    assignments[layer.id] = choice.image.id;
    usedThisGeneration.add(choice.image.id);
    return { ...layer, sourceId: choice.source.id, generatedImageId: choice.image.id, sourceState: state };
  });

  return { project: { ...project, sources, layers }, assignments };
}
