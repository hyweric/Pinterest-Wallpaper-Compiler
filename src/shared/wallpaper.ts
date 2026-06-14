import type {
  GeneratedCombination,
  TemplateLibrary,
  WallpaperInterval,
  WallpaperTemplate,
  WallpaperTarget
} from "./types.js";

export const appliedHistoryLimit = 40;

export function wallpaperIntervalToMs(
  interval: WallpaperInterval,
  customMinutes: number,
  customValue = customMinutes,
  customUnit: "seconds" | "minutes" | "hours" = "minutes"
) {
  const minute = 60_000;
  switch (interval) {
    case "5s": return 5_000;
    case "10s": return 10_000;
    case "30s": return 30_000;
    case "1m": return minute;
    case "5m": return 5 * minute;
    case "15m": return 15 * minute;
    case "30m": return 30 * minute;
    case "hourly": return 60 * minute;
    case "few-hours": return 3 * 60 * minute;
    case "daily": return 24 * 60 * minute;
    case "custom": {
      const value = Math.max(1, customValue || customMinutes || 1);
      if (customUnit === "seconds") return value * 1_000;
      if (customUnit === "hours") return value * 60 * minute;
      return value * minute;
    }
    default: return undefined;
  }
}

export function nextScheduledAt(
  interval: WallpaperInterval,
  customMinutes: number,
  from = new Date(),
  customValue = customMinutes,
  customUnit: "seconds" | "minutes" | "hours" = "minutes"
) {
  const ms = wallpaperIntervalToMs(interval, customMinutes, customValue, customUnit);
  return ms ? new Date(from.getTime() + ms).toISOString() : undefined;
}

export function generationStateAfterApplication<T>(current: T, candidate: T, applied: boolean) {
  return applied ? candidate : current;
}

export function appendAppliedHistory(
  history: GeneratedCombination[],
  entry: GeneratedCombination,
  limit = appliedHistoryLimit
) {
  return [entry, ...history.filter((item) => item.id !== entry.id)].slice(0, limit);
}

export function previousHistoryIndex(currentIndex: number, length: number) {
  if (length <= 1) return undefined;
  const next = currentIndex + 1;
  return next < length ? next : undefined;
}

export function nextHistoryIndex(currentIndex: number, length: number) {
  if (length <= 1 || currentIndex <= 0) return undefined;
  return Math.max(0, currentIndex - 1);
}

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export interface RotationPlan {
  templateId: string;
  nextLibrary: TemplateLibrary;
}

export function planTemplateRotation(library: TemplateLibrary, templates: WallpaperTemplate[]): RotationPlan | undefined {
  const enabled = templates.filter((template) => template.enabledForRotation);
  const configuredIds = library.rotationTemplateIds.filter((id) => enabled.some((template) => template.id === id));
  const ids = configuredIds.length ? configuredIds : enabled.map((template) => template.id);
  if (!ids.length) return undefined;

  if (library.rotationMode === "sequential") {
    let index = library.currentIndex % ids.length;
    if (ids.length > 1 && ids[index] === library.activeTemplateId) index = (index + 1) % ids.length;
    return {
      templateId: ids[index],
      nextLibrary: { ...library, currentIndex: (index + 1) % ids.length }
    };
  }

  if (library.rotationMode === "random") {
    const alternatives = ids.length > 1 ? ids.filter((id) => id !== library.activeTemplateId) : ids;
    const templateId = alternatives[Math.floor(Math.random() * alternatives.length)] ?? ids[0];
    return { templateId, nextLibrary: { ...library } };
  }

  let queue = library.shuffleQueue.filter((id) => ids.includes(id));
  if (!queue.length) queue = shuffled(ids);
  if (queue.length > 1 && queue[0] === library.activeTemplateId) {
    [queue[0], queue[1]] = [queue[1], queue[0]];
  }
  const [templateId, ...rest] = queue;
  return {
    templateId,
    nextLibrary: { ...library, shuffleQueue: rest }
  };
}

export interface MacOSDockTargetRow {
  pictureId: number;
  spaceId?: string;
  displayId?: string;
  currentPath?: string;
}

export interface MacOSVisibleDesktopRow {
  index: number;
  currentPath?: string;
}

export interface ClassifiedMacOSTarget {
  pictureId: number;
  targetType: "active-space" | "inactive-space";
  visible: boolean;
  visibleIndex?: number;
}

export function classifyMacOSDockRows(
  dockRows: MacOSDockTargetRow[],
  visibleRows: MacOSVisibleDesktopRow[]
): ClassifiedMacOSTarget[] {
  const unmatchedVisible = [...visibleRows];
  return dockRows.map((row) => {
    let matchedIndex = -1;
    if (row.currentPath) matchedIndex = unmatchedVisible.findIndex((item) => item.currentPath === row.currentPath);
    const matched = matchedIndex >= 0 ? unmatchedVisible.splice(matchedIndex, 1)[0] : undefined;
    return {
      pictureId: row.pictureId,
      targetType: matched ? "active-space" : "inactive-space",
      visible: Boolean(matched),
      visibleIndex: matched?.index
    };
  });
}

export function buildMacOSWallpaperTargets(
  dockRows: MacOSDockTargetRow[],
  visibleRows: MacOSVisibleDesktopRow[],
  fallbackLimitation?: string
): WallpaperTarget[] {
  if (dockRows.length) {
    const classified = classifyMacOSDockRows(dockRows, visibleRows);
    return dockRows.map((row, index) => {
      const classification = classified[index];
      const current = classification.visible;
      return {
        id: `picture-${row.pictureId}`,
        label: current ? `Current desktop${visibleRows.length > 1 ? ` ${classification.visibleIndex ?? index + 1}` : ""}` : `Desktop / Space ${index + 1}`,
        index: index + 1,
        displayId: row.displayId,
        spaceId: row.spaceId,
        current,
        visible: current,
        targetType: classification.targetType,
        reliable: true,
        limitation: "Inactive Mission Control Spaces are identified by stable Dock picture records; macOS does not expose friendly Space names.",
        currentPath: row.currentPath
      };
    });
  }

  if (visibleRows.length) {
    return visibleRows.map((row) => ({
      id: `desktop-${row.index}`,
      label: `Current desktop ${row.index}`,
      index: row.index,
      current: true,
      visible: true,
      targetType: "active-space",
      reliable: true,
      limitation: "Only currently visible desktops were exposed because the Dock wallpaper database was unavailable.",
      currentPath: row.currentPath
    }));
  }

  return [{
    id: "desktop-1",
    label: "Current desktop",
    index: 1,
    current: true,
    visible: true,
    targetType: "active-space",
    reliable: false,
    limitation: fallbackLimitation ?? "macOS did not expose desktop targets."
  }];
}

export interface FadeOverlayPlanItem {
  displayId?: string;
  filePath: string;
  current?: boolean;
  oldFilePath?: string;
}

export function planFadeOverlayAssignments(
  displayIds: string[],
  items: FadeOverlayPlanItem[],
  allDisplays = false
) {
  if (!displayIds.length || !items.length) return [] as Array<{ displayId: string; item: FadeOverlayPlanItem }>;
  const currentItems = items.filter((item) => item.current);
  const visibleItems = currentItems.length
    ? currentItems
    : [...new Map(items.map((item) => [item.displayId ?? item.filePath, item])).values()];
  return displayIds.map((displayId, index) => ({
    displayId,
    item: allDisplays || visibleItems.length === 1
      ? visibleItems[Math.min(index, visibleItems.length - 1)] ?? visibleItems[0]
      : visibleItems.find((item) => item.displayId && String(item.displayId) === String(displayId))
        ?? visibleItems[index]
        ?? visibleItems[0]
  }));
}
