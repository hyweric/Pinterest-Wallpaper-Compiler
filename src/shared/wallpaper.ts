import type {
  GeneratedCombination,
  TemplateLibrary,
  WallpaperInterval,
  WallpaperTemplate
} from "./types.js";

export const appliedHistoryLimit = 40;

export function wallpaperIntervalToMs(interval: WallpaperInterval, customMinutes: number) {
  const minute = 60_000;
  switch (interval) {
    case "1m": return minute;
    case "5m": return 5 * minute;
    case "15m": return 15 * minute;
    case "30m": return 30 * minute;
    case "hourly": return 60 * minute;
    case "few-hours": return 3 * 60 * minute;
    case "daily": return 24 * 60 * minute;
    case "custom": return Math.max(1, customMinutes) * minute;
    default: return undefined;
  }
}

export function nextScheduledAt(interval: WallpaperInterval, customMinutes: number, from = new Date()) {
  const ms = wallpaperIntervalToMs(interval, customMinutes);
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
