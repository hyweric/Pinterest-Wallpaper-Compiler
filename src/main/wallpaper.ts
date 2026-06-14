import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import type {
  NativeCommandResult,
  MacOSWallpaperDiagnosticReport,
  WallpaperApplyDiagnostics,
  WallpaperDisplayMode,
  WallpaperScope,
  WallpaperTarget,
  WallpaperTargetMode,
  WallpaperTargetResult
} from "../shared/types.js";
import {
  selectWallpaperTargets,
  wallpaperTargetModeLabel,
  wallpaperTargetModeNeedsInactiveSpaces
} from "../shared/wallpaper.js";
import {
  MacOSActiveSpaceWallpaperObserver,
  applyMacOSWallpapersAcrossSpaces,
  diagnoseMacOSWallpaperEnvironment,
  getMacOSReferencedWallpaperPaths
} from "./macos-spaces.js";

export interface WallpaperControllerOptions {
  displayMode?: WallpaperDisplayMode;
  monitorMode?: "primary" | "all" | "span";
  scope?: WallpaperScope;
  targetMode?: WallpaperTargetMode;
  monitorId?: string;
  targetId?: string;
  currentDisplayId?: string;
}

export interface WallpaperTargetDiscoveryOptions {
  currentDisplayId?: string;
}

export interface WallpaperBatchItem {
  targetId: string;
  targetLabel: string;
  filePath: string;
  fileSize?: number;
  displayId?: string;
}

export interface WallpaperController {
  setWallpaper(filePath: string, options?: WallpaperControllerOptions): Promise<WallpaperApplyDiagnostics>;
  setWallpapers?(items: WallpaperBatchItem[], options?: WallpaperControllerOptions): Promise<WallpaperTargetResult[]>;
  getTargets?(options?: WallpaperTargetDiscoveryOptions): Promise<WallpaperTarget[]>;
  getMacOSDiagnostic?(options?: WallpaperTargetDiscoveryOptions): Promise<MacOSWallpaperDiagnosticReport>;
  getReferencedWallpaperPaths?(options?: WallpaperTargetDiscoveryOptions): Promise<string[]>;
  stopSpaceObserver?(): void;
  dispose?(): void;
}

function runNativeCommand(method: string, command: string, args: string[], timeout = 8000): Promise<NativeCommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: NativeCommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = execFile(command, args, { timeout }, (error, stdout, stderr) => {
      const timedOut = Boolean(error && "killed" in error && error.killed);
      const exitCode = error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      const signal = error && "signal" in error && typeof error.signal === "string" ? error.signal : undefined;
      finish({
        method,
        command,
        args,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        exitCode,
        signal,
        timedOut,
        error: error instanceof Error ? error.message : undefined
      });
    });
    child.on("error", (error) => {
      finish({ method, command, args, stdout: "", stderr: "", exitCode: 1, timedOut: false, error: error.message });
    });
  });
}

function commandSucceeded(result: NativeCommandResult) {
  return !result.timedOut && result.exitCode === 0 && !result.error;
}

function normalizeWallpaperPath(value: string | undefined) {
  if (!value) return undefined;
  try {
    return realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

interface MacScreenInfo {
  displayId: string;
  name: string;
  index: number;
  primary: boolean;
  currentPath?: string;
  bounds: { x: number; y: number; width: number; height: number };
}

interface MacApplyResponse {
  displayId: string;
  requestedPath: string;
  reportedPath?: string;
  ok: boolean;
  error?: string;
}

const macScreenDiscoveryScript = String.raw`
ObjC.import('AppKit');
function unwrap(value) {
  try { return ObjC.unwrap(value); } catch (_) { return String(value || ''); }
}
function displayNumber(screen, fallback) {
  try {
    const value = screen.deviceDescription.objectForKey('NSScreenNumber');
    return String(unwrap(value));
  } catch (_) { return String(fallback); }
}
function run() {
  const workspace = $.NSWorkspace.sharedWorkspace;
  const screens = $.NSScreen.screens.js;
  const output = screens.map((screen, index) => {
    const frame = screen.frame;
    const imageURL = workspace.desktopImageURLForScreen(screen);
    return {
      displayId: displayNumber(screen, index + 1),
      name: unwrap(screen.localizedName) || ('Display ' + (index + 1)),
      index: index + 1,
      primary: index === 0,
      currentPath: imageURL ? unwrap(imageURL.path) : '',
      bounds: {
        x: Number(frame.origin.x),
        y: Number(frame.origin.y),
        width: Number(frame.size.width),
        height: Number(frame.size.height)
      }
    };
  });
  return JSON.stringify(output);
}`;

const macScreenApplyScript = String.raw`
ObjC.import('AppKit');
function unwrap(value) {
  try { return ObjC.unwrap(value); } catch (_) { return String(value || ''); }
}
function displayNumber(screen, fallback) {
  try {
    const value = screen.deviceDescription.objectForKey('NSScreenNumber');
    return String(unwrap(value));
  } catch (_) { return String(fallback); }
}
function run(argv) {
  const assignments = JSON.parse(argv[0] || '[]');
  const byDisplay = {};
  assignments.forEach((item) => { byDisplay[String(item.displayId)] = item.filePath; });
  const workspace = $.NSWorkspace.sharedWorkspace;
  const screens = $.NSScreen.screens.js;
  const output = [];
  screens.forEach((screen, index) => {
    const displayId = displayNumber(screen, index + 1);
    const requestedPath = byDisplay[displayId];
    if (!requestedPath) return;
    const url = $.NSURL.fileURLWithPath($(requestedPath));
    const error = Ref();
    const ok = workspace.setDesktopImageURLForScreenOptionsError(url, screen, $({}), error);
    const reportedURL = workspace.desktopImageURLForScreen(screen);
    output.push({
      displayId,
      requestedPath,
      reportedPath: reportedURL ? unwrap(reportedURL.path) : '',
      ok: Boolean(ok),
      error: !ok && error[0] ? unwrap(error[0].localizedDescription) : ''
    });
  });
  return JSON.stringify(output);
}`;

async function discoverMacScreens(nativeResults: NativeCommandResult[]) {
  const result = await runNativeCommand(
    "macos-appkit-list-visible-displays",
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", macScreenDiscoveryScript],
    8000
  );
  nativeResults.push(result);
  if (!commandSucceeded(result)) return [] as MacScreenInfo[];
  try {
    const parsed = JSON.parse(result.stdout.trim()) as MacScreenInfo[];
    return parsed.map((item, index) => ({
      ...item,
      index: item.index || index + 1,
      displayId: String(item.displayId),
      currentPath: normalizeWallpaperPath(item.currentPath),
      bounds: item.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
    }));
  } catch {
    return [] as MacScreenInfo[];
  }
}

async function applyMacScreens(
  assignments: Array<{ displayId: string; filePath: string }>,
  nativeResults: NativeCommandResult[]
) {
  const result = await runNativeCommand(
    "macos-appkit-apply-visible-displays",
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", macScreenApplyScript, JSON.stringify(assignments)],
    12000
  );
  nativeResults.push(result);
  if (!commandSucceeded(result)) return { result, responses: [] as MacApplyResponse[] };
  try {
    const responses = JSON.parse(result.stdout.trim()) as MacApplyResponse[];
    return {
      result,
      responses: responses.map((item) => ({
        ...item,
        displayId: String(item.displayId),
        requestedPath: normalizeWallpaperPath(item.requestedPath) ?? item.requestedPath,
        reportedPath: normalizeWallpaperPath(item.reportedPath)
      }))
    };
  } catch {
    return { result, responses: [] as MacApplyResponse[] };
  }
}

function successfulMacApplyCount(
  assignments: Array<{ displayId: string; filePath: string }>,
  responses: MacApplyResponse[]
) {
  const expected = new Map(assignments.map((item) => [item.displayId, normalizeWallpaperPath(item.filePath) ?? item.filePath]));
  return responses.filter((response) => response.ok && response.reportedPath === expected.get(response.displayId)).length;
}

async function applyMacScreensWithRetry(
  assignments: Array<{ displayId: string; filePath: string }>,
  nativeResults: NativeCommandResult[]
) {
  const first = await applyMacScreens(assignments, nativeResults);
  if (successfulMacApplyCount(assignments, first.responses) === assignments.length) return first;

  // WallpaperAgent occasionally drops back-to-back changes. Give it a full
  // second to catch up, then perform one bounded verification retry.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const second = await applyMacScreens(assignments, nativeResults);
  return successfulMacApplyCount(assignments, second.responses) >= successfulMacApplyCount(assignments, first.responses)
    ? second
    : first;
}

function targetFromScreen(screen: MacScreenInfo, currentDisplayId?: string): WallpaperTarget {
  const isCurrent = currentDisplayId ? String(currentDisplayId) === screen.displayId : screen.primary;
  return {
    id: `display-${screen.displayId}`,
    label: `${screen.name} (${Math.round(screen.bounds.width)}×${Math.round(screen.bounds.height)})`,
    index: screen.index,
    displayId: screen.displayId,
    displayName: screen.name,
    current: isCurrent,
    visible: true,
    primary: screen.primary,
    targetType: "physical-display",
    reliable: true,
    limitation: "This target identifies a physical display. Current-Space modes use AppKit; All Desktops modes additionally use the macOS wallpaper Store and an active-Space observer.",
    currentPath: screen.currentPath,
    bounds: screen.bounds
  };
}

function legacyTargetMode(options: WallpaperControllerOptions): WallpaperTargetMode {
  if (options.targetMode) return options.targetMode;
  if (options.scope === "current-desktop") return "current-desktop";
  if (options.monitorMode === "primary") return "current-monitor";
  return "all-visible-monitors";
}

function resultPermissionStatus(responses: MacApplyResponse[]): WallpaperApplyDiagnostics["permissionStatus"] {
  if (responses.length && responses.every((item) => item.ok && item.reportedPath === item.requestedPath)) return "verified";
  const errorText = responses.map((item) => item.error ?? "").join(" ").toLowerCase();
  if (errorText.includes("not authorized") || errorText.includes("permission") || errorText.includes("denied")) return "automation-denied";
  return "verification-failed";
}

export class MacOSWallpaperController implements WallpaperController {
  private readonly spaceObserver = new MacOSActiveSpaceWallpaperObserver();

  dispose() {
    this.spaceObserver.stop();
  }

  stopSpaceObserver() {
    this.spaceObserver.stop();
  }

  getMacOSDiagnostic(options: WallpaperTargetDiscoveryOptions = {}) {
    return diagnoseMacOSWallpaperEnvironment(options.currentDisplayId);
  }

  getReferencedWallpaperPaths(options: WallpaperTargetDiscoveryOptions = {}) {
    return getMacOSReferencedWallpaperPaths(options.currentDisplayId);
  }

  async getTargets(options: WallpaperTargetDiscoveryOptions = {}) {
    const nativeResults: NativeCommandResult[] = [];
    const screens = await discoverMacScreens(nativeResults);
    if (!screens.length) {
      const error = nativeResults.at(-1);
      return [{
        id: "display-unavailable",
        label: "Current display",
        index: 1,
        current: true,
        visible: true,
        targetType: "physical-display" as const,
        reliable: false,
        limitation: error?.timedOut
          ? "macOS timed out while listing physical displays."
          : error?.error || error?.stderr || "macOS did not expose any physical displays."
      }];
    }
    return screens.map((screen) => targetFromScreen(screen, options.currentDisplayId));
  }

  async setWallpaper(filePath: string, options: WallpaperControllerOptions = {}): Promise<WallpaperApplyDiagnostics> {
    const nativeResults: NativeCommandResult[] = [];
    const mode = legacyTargetMode(options);

    const screens = await discoverMacScreens(nativeResults);
    const targets = screens.map((screen) => targetFromScreen(screen, options.currentDisplayId));
    let selected: WallpaperTarget[];
    if (options.targetId) selected = targets.filter((target) => target.id === options.targetId || target.displayId === options.targetId);
    else selected = selectWallpaperTargets(targets, mode, options.monitorId);

    if (!selected.length) {
      return {
        renderedPath: filePath,
        nativeResults,
        verifiedPaths: [],
        permissionStatus: "verification-failed",
        changed: false,
        lastError: "The selected physical display is not currently connected or visible.",
        targetMode: mode,
        verificationResult: "unavailable",
        requestedTargetCount: 0,
        appliedTargetCount: 0
      };
    }

    const normalizedPath = normalizeWallpaperPath(filePath) ?? filePath;
    const assignments = selected.map((target) => ({ displayId: target.displayId!, filePath: normalizedPath }));
    let advancedError: string | undefined;
    let advancedImmediate = false;
    let allSpacesStatus: WallpaperApplyDiagnostics["macOSAllSpaces"];
    if (wallpaperTargetModeNeedsInactiveSpaces(mode)) {
      const allSpacesMode = mode as Extract<WallpaperTargetMode, "all-desktops-current-monitor" | "all-desktops-all-monitors">;
      const advanced = await applyMacOSWallpapersAcrossSpaces(assignments, allSpacesMode, options.displayMode, options.currentDisplayId);
      nativeResults.push(...advanced.commands);
      advancedImmediate = Boolean(advanced.summary?.ok);
      const observerStarted = this.spaceObserver.start(assignments, allSpacesMode, options.displayMode);
      if (advanced.summary) {
        advanced.summary.observerStarted = observerStarted;
        advanced.summary.observerFallback = !advanced.summary.ok && observerStarted;
        allSpacesStatus = advanced.summary;
      }
      if (!advancedImmediate) {
        advancedError = advanced.summary?.error
          || advanced.summary?.warning
          || advanced.command.error
          || advanced.command.stderr
          || `${wallpaperTargetModeLabel(mode)} could not be configured immediately.`;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    } else {
      this.spaceObserver.stop();
    }

    const { result, responses } = await applyMacScreensWithRetry(assignments, nativeResults);
    const responseByDisplay = new Map(responses.map((item) => [item.displayId, item]));
    const matched = selected.filter((target) => {
      const response = responseByDisplay.get(target.displayId!);
      return Boolean(response?.ok && response.reportedPath === normalizedPath);
    });
    const changed = matched.length === selected.length;
    const partial = (matched.length > 0 && !changed) || Boolean(advancedError);
    const firstResponse = selected.length === 1 ? responseByDisplay.get(selected[0].displayId!) : undefined;
    const lastError = !changed
      ? responses.find((item) => item.error)?.error
        || result.error
        || result.stderr
        || (matched.length > 0 ? `Wallpaper changed on ${matched.length} of ${selected.length} visible displays.` : "macOS did not confirm the wallpaper changed on the selected display target(s).")
      : undefined;

    return {
      renderedPath: normalizedPath,
      nativeResults,
      verifiedPaths: matched.map(() => normalizedPath),
      verificationMethod: wallpaperTargetModeNeedsInactiveSpaces(mode)
        ? advancedImmediate
          ? "Transactional macOS wallpaper Store update for inactive Spaces, active-Space observer, and NSWorkspace verification on each visible NSScreen"
          : "Active-Space observer fallback plus NSWorkspace verification on each visible NSScreen"
        : "NSWorkspace desktopImageURL(for:) on each visible NSScreen",
      permissionStatus: resultPermissionStatus(responses),
      changed,
      partial,
      lastError,
      targetId: selected.length === 1 ? selected[0].id : undefined,
      targetLabel: selected.length === 1 ? selected[0].label : wallpaperTargetModeLabel(mode),
      displayId: selected.length === 1 ? selected[0].displayId : undefined,
      displayName: selected.length === 1 ? selected[0].displayName : undefined,
      targetType: "physical-display",
      visible: true,
      requestedPath: normalizedPath,
      reportedPath: firstResponse?.reportedPath,
      verificationResult: changed ? "matched" : firstResponse?.reportedPath ? "mismatched" : "unavailable",
      targetMode: mode,
      requestedTargetCount: selected.length,
      appliedTargetCount: matched.length,
      macOSAllSpaces: allSpacesStatus,
      limitation: wallpaperTargetModeNeedsInactiveSpaces(mode)
        ? advancedError
          ? `${advancedError} Connected visible Spaces were applied now; other Spaces will be re-applied automatically when they become active while the app is running.`
          : allSpacesStatus ? `Immediate all-desktop strategy ${allSpacesStatus.strategy} verified ${allSpacesStatus.verifiedSpaceCount} of ${allSpacesStatus.targetSpaceCount} desktop records. The observer remains active for newly created or externally changed Spaces.` : "All-desktop status was unavailable."
        : undefined
    };
  }

  async setWallpapers(items: WallpaperBatchItem[], options: WallpaperControllerOptions = {}) {
    const nativeResults: NativeCommandResult[] = [];
    const mode = legacyTargetMode(options);

    const screens = await discoverMacScreens(nativeResults);
    const screenById = new Map(screens.map((screen) => [screen.displayId, screen]));
    const assignments = items.flatMap((item) => {
      const displayId = item.displayId ?? item.targetId.replace(/^display-/, "");
      return screenById.has(displayId) ? [{ displayId, filePath: normalizeWallpaperPath(item.filePath) ?? item.filePath }] : [];
    });
    let advancedError: string | undefined;
    let advancedImmediate = false;
    let allSpacesStatus: WallpaperApplyDiagnostics["macOSAllSpaces"];
    if (assignments.length && wallpaperTargetModeNeedsInactiveSpaces(mode)) {
      const allSpacesMode = mode as Extract<WallpaperTargetMode, "all-desktops-current-monitor" | "all-desktops-all-monitors">;
      const advanced = await applyMacOSWallpapersAcrossSpaces(assignments, allSpacesMode, options.displayMode, options.currentDisplayId);
      nativeResults.push(...advanced.commands);
      advancedImmediate = Boolean(advanced.summary?.ok);
      const observerStarted = this.spaceObserver.start(assignments, allSpacesMode, options.displayMode);
      if (advanced.summary) {
        advanced.summary.observerStarted = observerStarted;
        advanced.summary.observerFallback = !advanced.summary.ok && observerStarted;
        allSpacesStatus = advanced.summary;
      }
      if (!advancedImmediate) {
        advancedError = advanced.summary?.error || advanced.summary?.warning || advanced.command.error || advanced.command.stderr || `${wallpaperTargetModeLabel(mode)} could not be configured immediately.`;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    } else {
      this.spaceObserver.stop();
    }
    const { result, responses } = assignments.length
      ? await applyMacScreensWithRetry(assignments, nativeResults)
      : { result: { method: "macos-appkit-apply-visible-displays", command: "", args: [], stdout: "", stderr: "", exitCode: 1, timedOut: false, error: "No matching visible displays." } as NativeCommandResult, responses: [] as MacApplyResponse[] };
    const responseByDisplay = new Map(responses.map((item) => [item.displayId, item]));

    return items.map((item) => {
      const displayId = item.displayId ?? item.targetId.replace(/^display-/, "");
      const requestedPath = normalizeWallpaperPath(item.filePath) ?? item.filePath;
      const response = responseByDisplay.get(displayId);
      const ok = Boolean(response?.ok && response.reportedPath === requestedPath);
      const screen = screenById.get(displayId);
      const error = ok
        ? undefined
        : response?.error || result.error || result.stderr || advancedError || `Display ${item.targetLabel} is not currently connected or visible.`;
      const diagnostics: WallpaperApplyDiagnostics = {
        renderedPath: requestedPath,
        fileSize: item.fileSize,
        validImage: true,
        nativeResults: [...nativeResults],
        verifiedPaths: ok ? [requestedPath] : [],
        verificationMethod: wallpaperTargetModeNeedsInactiveSpaces(mode)
          ? advancedImmediate
            ? "Transactional macOS wallpaper Store update, active-Space observer, and NSWorkspace verification on the requested visible NSScreen"
            : "Active-Space observer fallback plus NSWorkspace verification on the requested visible NSScreen"
          : "NSWorkspace desktopImageURL(for:) on the requested visible NSScreen",
        permissionStatus: ok ? "verified" : resultPermissionStatus(response ? [response] : []),
        changed: ok,
        partial: Boolean(advancedError),
        lastError: error,
        targetId: item.targetId,
        targetLabel: item.targetLabel,
        displayId,
        displayName: screen?.name,
        targetType: "physical-display",
        visible: Boolean(screen),
        requestedPath,
        reportedPath: response?.reportedPath,
        verificationResult: ok ? "matched" : response?.reportedPath ? "mismatched" : "unavailable",
        targetMode: mode,
        requestedTargetCount: 1,
        appliedTargetCount: ok ? 1 : 0,
        macOSAllSpaces: allSpacesStatus,
        limitation: wallpaperTargetModeNeedsInactiveSpaces(mode)
          ? advancedError
            ? `${advancedError} This display's visible Space was applied now; other Spaces will be synchronized when activated while the app is running.`
            : allSpacesStatus ? `Immediate all-desktop strategy ${allSpacesStatus.strategy} verified ${allSpacesStatus.verifiedSpaceCount} of ${allSpacesStatus.targetSpaceCount} desktop records. The observer remains active for maintenance.` : "All-desktop status was unavailable."
          : undefined
      };
      return { targetId: item.targetId, targetLabel: item.targetLabel, filePath: item.filePath, fileSize: item.fileSize, diagnostics, ok, error };
    });
  }
}

function emptyDiagnostics(filePath: string, changed: boolean, result?: NativeCommandResult): WallpaperApplyDiagnostics {
  return {
    renderedPath: filePath,
    nativeResults: result ? [result] : [],
    verifiedPaths: changed ? [filePath] : [],
    permissionStatus: changed ? "verified" : "not-checked",
    changed,
    lastError: changed ? undefined : result?.error
  };
}

async function execFileAsyncResult(method: string, command: string, args: string[]) {
  const result = await runNativeCommand(method, command, args, 12000);
  if (!commandSucceeded(result)) {
    throw Object.assign(new Error(result.error || result.stderr || `${command} failed.`), { nativeResult: result });
  }
  return result;
}

function nativeResultFromError(error: unknown): NativeCommandResult | undefined {
  return error && typeof error === "object" && "nativeResult" in error ? error.nativeResult as NativeCommandResult : undefined;
}

function throwWithDiagnostics(error: unknown, filePath: string): never {
  const nativeResult = nativeResultFromError(error);
  const message = error instanceof Error ? error.message : "Unable to set wallpaper.";
  const wrapped = new Error(message) as Error & { diagnostics?: WallpaperApplyDiagnostics };
  wrapped.diagnostics = emptyDiagnostics(filePath, false, nativeResult);
  throw wrapped;
}

export class WindowsWallpaperController implements WallpaperController {
  async setWallpaper(filePath: string, options?: WallpaperControllerOptions) {
    const encodedPath = Buffer.from(filePath, "utf8").toString("base64");
    const { style, tile } = windowsStyle(options?.monitorMode === "span" ? "span" : options?.displayMode);
    const script = `
$wallpaperPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value '${style}'
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value '${tile}'
Add-Type @"
using System.Runtime.InteropServices;
public class Wallpaper {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
$ok = [Wallpaper]::SystemParametersInfo(20, 0, $wallpaperPath, 3)
if (-not $ok) { throw "Windows rejected the wallpaper change." }
`;
    try {
      const result = await execFileAsyncResult("windows-systemparametersinfo-apply", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
      return emptyDiagnostics(filePath, true, result);
    } catch (error) {
      throwWithDiagnostics(error, filePath);
    }
  }
}

function windowsStyle(mode: WallpaperDisplayMode | undefined) {
  switch (mode) {
    case "fit": return { style: "6", tile: "0" };
    case "stretch": return { style: "2", tile: "0" };
    case "tile": return { style: "0", tile: "1" };
    case "center": return { style: "0", tile: "0" };
    case "span": return { style: "22", tile: "0" };
    case "fill":
    default:
      return { style: "10", tile: "0" };
  }
}

export class UnsupportedWallpaperController implements WallpaperController {
  async setWallpaper(filePath: string): Promise<WallpaperApplyDiagnostics> {
    const diagnostics = emptyDiagnostics(filePath, false);
    diagnostics.lastError = "Setting the desktop wallpaper is not supported on this platform yet.";
    throw Object.assign(new Error(diagnostics.lastError), { diagnostics });
  }
}

export function createWallpaperController(): WallpaperController {
  if (process.platform === "darwin") return new MacOSWallpaperController();
  if (process.platform === "win32") return new WindowsWallpaperController();
  return new UnsupportedWallpaperController();
}
