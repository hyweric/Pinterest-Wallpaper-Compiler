export const DEFAULT_PIN_IMPORT_LIMIT = 1_000;
export const MIN_PIN_IMPORT_LIMIT = 1;
export const MAX_PIN_IMPORT_LIMIT = 10_000;

export function normalizePinImportLimit(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.replace(/,/g, ""))
      : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_PIN_IMPORT_LIMIT;
  return Math.min(MAX_PIN_IMPORT_LIMIT, Math.max(MIN_PIN_IMPORT_LIMIT, Math.round(parsed)));
}

export function pinImportTarget(availableCount: number | undefined, limit: unknown, discoveredCount = 0): number {
  const normalizedLimit = normalizePinImportLimit(limit);
  const available = Number.isFinite(availableCount) && (availableCount ?? 0) > 0
    ? Math.round(availableCount as number)
    : Math.max(0, Math.round(discoveredCount));
  return Math.min(normalizedLimit, Math.max(available, Math.min(discoveredCount, normalizedLimit)));
}

export function pinLimitReached(
  availableCount: number | undefined,
  discoveredCount: number,
  limit: unknown,
  loaderStoppedAtLimit = false
): boolean {
  const normalizedLimit = normalizePinImportLimit(limit);
  return loaderStoppedAtLimit
    || discoveredCount > normalizedLimit
    || (discoveredCount >= normalizedLimit && Number.isFinite(availableCount) && (availableCount as number) > normalizedLimit);
}
