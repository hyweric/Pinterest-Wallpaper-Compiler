import type { WallpaperProject } from "./types.js";

/**
 * Export sets work against a detached project copy. The live project is only
 * updated when the user explicitly opts into advancing its source state.
 */
export function projectAfterExportSet(
  liveProject: WallpaperProject,
  generatedProject: WallpaperProject,
  advanceLiveState: boolean
) {
  if (!advanceLiveState) return liveProject;

  const generatedLayers = new Map(generatedProject.layers.map((layer) => [layer.id, layer]));
  const generatedSources = new Map(generatedProject.sources.map((source) => [source.id, source]));

  return {
    ...liveProject,
    layers: liveProject.layers.map((layer) => {
      const generatedLayer = generatedLayers.get(layer.id);
      if (!generatedLayer) return layer;
      return {
        ...layer,
        sourceId: generatedLayer.sourceId,
        selectedImageId: generatedLayer.selectedImageId,
        generatedImageId: generatedLayer.generatedImageId,
        sourceState: { ...generatedLayer.sourceState }
      };
    }),
    sources: liveProject.sources.map((source) => {
      const generatedSource = generatedSources.get(source.id);
      if (!generatedSource?.selectionState) return source;
      return {
        ...source,
        selectionState: {
          shuffleQueue: [...generatedSource.selectionState.shuffleQueue],
          cycle: generatedSource.selectionState.cycle,
          lastImageByLayer: { ...generatedSource.selectionState.lastImageByLayer }
        }
      };
    })
  };
}
