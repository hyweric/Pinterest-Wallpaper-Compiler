import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NativeCommandResult, WallpaperApplyDiagnostics, WallpaperDisplayMode, WallpaperScope, WallpaperTarget } from "../shared/types.js";

export interface WallpaperControllerOptions {
  displayMode?: WallpaperDisplayMode;
  monitorMode?: "primary" | "all" | "span";
  scope?: WallpaperScope;
  targetId?: string;
}

export interface WallpaperController {
  setWallpaper(filePath: string, options?: WallpaperControllerOptions): Promise<WallpaperApplyDiagnostics>;
  getTargets?(): Promise<WallpaperTarget[]>;
}

function runNativeCommand(method: string, command: string, args: string[], timeout = 8000): Promise<NativeCommandResult> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout }, (error, stdout, stderr) => {
      const timedOut = Boolean(error && "killed" in error && error.killed);
      const exitCode = error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      const signal = error && "signal" in error && typeof error.signal === "string" ? error.signal : undefined;
      resolve({
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
      resolve({
        method,
        command,
        args,
        stdout: "",
        stderr: "",
        exitCode: 1,
        timedOut: false,
        error: error.message
      });
    });
  });
}

function commandSucceeded(result: NativeCommandResult) {
  return !result.timedOut && result.exitCode === 0 && !result.error;
}

function escapeSql(value: string) {
  return value.replace(/'/g, "''");
}

function normalizeWallpaperPath(value: string) {
  const trimmed = value.trim();
  const expanded = trimmed.startsWith("~/") ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
  try {
    return realpathSync.native(expanded);
  } catch {
    return expanded;
  }
}

function targetIndexFromId(targetId?: string) {
  const match = targetId?.match(/^desktop-(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

async function verifyMacOSWallpaper(
  filePath: string,
  nativeResults: NativeCommandResult[],
  options: { targetIndex?: number; requireEveryDesktop?: boolean } = {}
) {
  const targetPath = normalizeWallpaperPath(filePath);
  const verifiedPaths: string[] = [];
  let verificationMethod: string | undefined;
  let permissionStatus: WallpaperApplyDiagnostics["permissionStatus"] = "not-checked";

  const systemEventsRead = await runNativeCommand("macos-system-events-read", "/usr/bin/osascript", [
    "-e",
    'tell application "System Events" to get picture of every desktop'
  ], 5000);
  nativeResults.push(systemEventsRead);
  if (commandSucceeded(systemEventsRead)) {
    verifiedPaths.push(...systemEventsRead.stdout.split(",").map(normalizeWallpaperPath).filter(Boolean));
    verificationMethod = "System Events";
    permissionStatus = "verified";
  } else if (systemEventsRead.timedOut) {
    permissionStatus = "automation-timeout";
  } else if (/not authorized|not allowed|permission|denied/i.test(`${systemEventsRead.stderr}\n${systemEventsRead.error ?? ""}`)) {
    permissionStatus = "automation-denied";
  }

  if (!verifiedPaths.includes(targetPath)) {
    const databasePath = path.join(os.homedir(), "Library/Application Support/Dock/desktoppicture.db");
    const sql = [
      "select value from data where value in (",
      `'${escapeSql(filePath)}',`,
      `'${escapeSql(targetPath)}',`,
      `'${escapeSql(filePath.replace(os.homedir(), "~"))}',`,
      `'${escapeSql(targetPath.replace(os.homedir(), "~"))}'`,
      ") limit 10;"
    ].join("");
    const databaseRead = await runNativeCommand("macos-dock-database-read", "/usr/bin/sqlite3", [databasePath, sql], 5000);
    nativeResults.push(databaseRead);
    if (commandSucceeded(databaseRead)) {
      const paths = databaseRead.stdout.split(/\r?\n/).map(normalizeWallpaperPath).filter(Boolean);
      verifiedPaths.push(...paths);
        if (paths.includes(targetPath)) {
        verificationMethod = "Dock wallpaper database";
        permissionStatus = "verified";
      }
    }
  }

  const indexedPath = options.targetIndex ? verifiedPaths[options.targetIndex - 1] : undefined;
  const changed = options.requireEveryDesktop
    ? verifiedPaths.length > 0 && verifiedPaths.every((item) => item === targetPath)
    : options.targetIndex
      ? indexedPath === targetPath
      : verifiedPaths.includes(targetPath);

  return {
    verifiedPaths,
    verificationMethod,
    permissionStatus,
    changed
  };
}

export class MacOSWallpaperController implements WallpaperController {
  async getTargets() {
    const nativeResults: NativeCommandResult[] = [];
    const read = await runNativeCommand("macos-system-events-targets", "/usr/bin/osascript", [
      "-e",
      'tell application "System Events"',
      "-e",
      "set output to {}",
      "-e",
      "set desktopItems to every desktop",
      "-e",
      "repeat with i from 1 to count desktopItems",
      "-e",
      "set desktopItem to item i of desktopItems",
      "-e",
      "set end of output to ((i as text) & tab & (picture of desktopItem as text))",
      "-e",
      "end repeat",
      "-e",
      "end tell",
      "-e",
      "return output"
    ], 5000);
    nativeResults.push(read);
    if (!commandSucceeded(read)) {
      return [{
        id: "desktop-1",
        label: "Current desktop",
        index: 1,
        current: true,
        reliable: false,
        limitation: read.timedOut ? "macOS Automation timed out while listing desktops." : read.error || read.stderr || "macOS did not expose desktop targets."
      }] satisfies WallpaperTarget[];
    }
    const rows = read.stdout.split(", ").flatMap((entry) => entry.split(/\r?\n/)).map((entry) => entry.trim()).filter(Boolean);
    const targets = rows.map((row, fallbackIndex) => {
      const [rawIndex, rawPath = ""] = row.split("\t");
      const index = Number(rawIndex) || fallbackIndex + 1;
      return {
        id: `desktop-${index}`,
        label: `Desktop ${index}`,
        index,
        current: index === 1,
        reliable: true,
        limitation: "macOS exposes Spaces as desktop indexes; stable Space names are not available to this app.",
        currentPath: rawPath ? normalizeWallpaperPath(rawPath) : undefined
      } satisfies WallpaperTarget;
    });
    return targets.length ? targets : [{
      id: "desktop-1",
      label: "Current desktop",
      index: 1,
      current: true,
      reliable: false,
      limitation: "macOS returned no desktop targets."
    }];
  }

  async setWallpaper(filePath: string, options: WallpaperControllerOptions = {}) {
    const nativeResults: NativeCommandResult[] = [];
    const scope = options.scope ?? "same-all-desktops";
    const targetIndex = targetIndexFromId(options.targetId);
    const scriptLines = scope === "current-desktop"
      ? [
          'tell application "Finder" to set desktop picture to imageFile'
        ]
      : targetIndex
        ? [
            'tell application "System Events"',
            "set desktopItems to every desktop",
            `if (count desktopItems) < ${targetIndex} then error "Desktop target ${targetIndex} is unavailable."`,
            `set picture of item ${targetIndex} of desktopItems to imageFile`,
            "end tell"
          ]
        : [
            'tell application "System Events"',
            "repeat with desktopItem in every desktop",
            "set picture of desktopItem to imageFile",
            "end repeat",
            "end tell"
          ];
    const systemEventsApply = await runNativeCommand("macos-system-events-apply", "/usr/bin/osascript", [
      "-e",
      "on run argv",
      "-e",
      "set imagePath to item 1 of argv",
      "-e",
      "set imageFile to POSIX file imagePath",
      ...scriptLines.flatMap((line) => ["-e", line]),
      "-e",
      'return "applied-system-events:" & imagePath',
      "-e",
      "end run",
      filePath
    ]);
    nativeResults.push(systemEventsApply);

    let applyResult = systemEventsApply;
    let verification = commandSucceeded(systemEventsApply)
      ? await verifyMacOSWallpaper(filePath, nativeResults, {
          targetIndex,
          requireEveryDesktop: scope === "same-all-desktops" && !targetIndex
        })
      : { verifiedPaths: [] as string[], verificationMethod: undefined, permissionStatus: "not-checked" as const, changed: false };

    if (!verification.changed) {
      const finderApply = await runNativeCommand("macos-finder-apply", "/usr/bin/osascript", [
        "-e",
        "on run argv",
        "-e",
        "set imagePath to item 1 of argv",
        "-e",
        'tell application "Finder" to set desktop picture to POSIX file imagePath',
        "-e",
        'return "applied-finder:" & imagePath',
        "-e",
        "end run",
        filePath
      ]);
      nativeResults.push(finderApply);
      applyResult = finderApply;
      if (commandSucceeded(finderApply)) {
        verification = await verifyMacOSWallpaper(filePath, nativeResults, {
          targetIndex,
          requireEveryDesktop: scope === "same-all-desktops" && !targetIndex
        });
      }
    }

    const { verifiedPaths, verificationMethod, permissionStatus, changed } = verification;
    const lastError = !commandSucceeded(applyResult)
      ? applyResult.error || applyResult.stderr || "macOS native wallpaper command failed."
      : changed
        ? undefined
        : "macOS did not report the rendered file as the active desktop picture.";

    const finalPermissionStatus: WallpaperApplyDiagnostics["permissionStatus"] = changed
      ? "verified"
      : permissionStatus === "not-checked"
        ? "verification-failed"
        : permissionStatus;

    return {
      renderedPath: filePath,
      nativeResults,
      verifiedPaths,
      verificationMethod,
      permissionStatus: finalPermissionStatus,
      changed,
      lastError,
      targetId: options.targetId,
      targetLabel: targetIndex ? `Desktop ${targetIndex}` : scope === "current-desktop" ? "Current desktop" : "All desktops"
    };
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
    throw Object.assign(new Error("Setting the desktop wallpaper is not supported on this platform yet."), { diagnostics });
  }
}

export function createWallpaperController(): WallpaperController {
  if (process.platform === "darwin") return new MacOSWallpaperController();
  if (process.platform === "win32") return new WindowsWallpaperController();
  return new UnsupportedWallpaperController();
}
