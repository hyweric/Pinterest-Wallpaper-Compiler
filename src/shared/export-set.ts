import type { WallpaperProject } from "./types.js";

/**
 * Export sets work against a detached project copy. The live project is only
 * replaced when the user explicitly opts into advancing its source state.
 */
export function projectAfterExportSet(
  liveProject: WallpaperProject,
  generatedProject: WallpaperProject,
  advanceLiveState: boolean
) {
  return advanceLiveState ? generatedProject : liveProject;
}
