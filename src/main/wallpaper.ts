import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NativeCommandResult, WallpaperApplyDiagnostics, WallpaperDisplayMode, WallpaperScope, WallpaperTarget, WallpaperTargetResult } from "../shared/types.js";
import { buildMacOSWallpaperTargets, classifyMacOSDockRows } from "../shared/wallpaper.js";

export interface WallpaperControllerOptions {
  displayMode?: WallpaperDisplayMode;
  monitorMode?: "primary" | "all" | "span";
  scope?: WallpaperScope;
  targetId?: string;
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

function dockPictureIdFromTargetId(targetId?: string) {
  const match = targetId?.match(/^picture-(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function dockWallpaperDatabasePath() {
  return path.join(os.homedir(), "Library/Application Support/Dock/desktoppicture.db");
}

async function applyMacOSWallpaperLegacy(
  filePath: string,
  nativeResults: NativeCommandResult[],
  scope: WallpaperScope
) {
  const isCurrentOnly = scope === "current-desktop";
  const args = isCurrentOnly
    ? [
        "-e",
        "on run argv",
        "-e",
        "set imagePath to item 1 of argv",
        "-e",
        'tell application "Finder" to set desktop picture to POSIX file imagePath',
        "-e",
        'return "ok:" & imagePath',
        "-e",
        "end run",
        filePath
      ]
    : [
        "-e",
        "on run argv",
        "-e",
        "set imagePath to item 1 of argv",
        "-e",
        'tell application "System Events"',
        "-e",
        "repeat with desktopItem in every desktop",
        "-e",
        "set picture of desktopItem to POSIX file imagePath",
        "-e",
        "end repeat",
        "-e",
        "end tell",
        "-e",
        'return "ok:" & imagePath',
        "-e",
        "end run",
        filePath
      ];
  const result = await runNativeCommand(
    isCurrentOnly ? "macos-legacy-current-desktop-apply" : "macos-legacy-all-desktops-apply",
    "/usr/bin/osascript",
    args,
    12000
  );
  nativeResults.push(result);
  return result;
}


async function applyVisibleScreensWithAppKit(
  filePath: string,
  nativeResults: NativeCommandResult[],
  allScreens: boolean
) {
  const script = String.raw`
ObjC.import('AppKit');
function run(argv) {
  const imagePath = argv[0];
  const allScreens = argv[1] === 'all';
  const workspace = $.NSWorkspace.sharedWorkspace;
  const url = $.NSURL.fileURLWithPath($(imagePath));
  const screens = $.NSScreen.screens.js;
  const targets = allScreens ? screens : screens.slice(0, 1);
  const output = [];
  targets.forEach((screen, index) => {
    const error = Ref();
    const ok = workspace.setDesktopImageURLForScreenOptionsError(url, screen, $({}), error);
    output.push((ok ? 'ok' : 'failed') + ':' + (index + 1));
    if (!ok && error[0]) output.push(ObjC.unwrap(error[0].localizedDescription));
  });
  return output.join('\\n');
}`;
  const result = await runNativeCommand(
    allScreens ? "macos-appkit-all-visible-screens" : "macos-appkit-current-screen",
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", script, filePath, allScreens ? "all" : "current"],
    8000
  );
  nativeResults.push(result);
  return result;
}


async function applyVisibleScreensBatchWithAppKit(
  filePaths: string[],
  nativeResults: NativeCommandResult[]
) {
  if (!filePaths.length) return undefined;
  const script = String.raw`
ObjC.import('AppKit');
function run(argv) {
  const workspace = $.NSWorkspace.sharedWorkspace;
  const screens = $.NSScreen.screens.js;
  const output = [];
  screens.forEach((screen, index) => {
    const imagePath = argv[Math.min(index, argv.length - 1)];
    if (!imagePath) return;
    const url = $.NSURL.fileURLWithPath($(imagePath));
    const error = Ref();
    const ok = workspace.setDesktopImageURLForScreenOptionsError(url, screen, $({}), error);
    output.push((ok ? 'ok' : 'failed') + ':' + (index + 1) + ':' + imagePath);
    if (!ok && error[0]) output.push(ObjC.unwrap(error[0].localizedDescription));
  });
  return output.join('\n');
}`;
  const result = await runNativeCommand(
    "macos-appkit-visible-screen-batch",
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", script, ...filePaths],
    10000
  );
  nativeResults.push(result);
  return result;
}

async function readVisibleDesktopPaths(nativeResults: NativeCommandResult[]) {
  const read = await runNativeCommand("macos-visible-desktop-paths", "/usr/bin/osascript", [
    "-e",
    'tell application "System Events" to get picture of every desktop'
  ], 5000);
  nativeResults.push(read);
  if (!commandSucceeded(read)) return [] as string[];
  return read.stdout.split(",").map(normalizeWallpaperPath).filter(Boolean);
}

type DockPictureRow = {
  pictureId: number;
  spaceId?: string;
  displayId?: string;
  currentPath?: string;
};

type MacOSVerification = {
  verifiedPaths: string[];
  verificationMethod?: string;
  permissionStatus: WallpaperApplyDiagnostics["permissionStatus"];
  changed: boolean;
  reportedPath?: string;
};

async function readDockPictureRows(nativeResults: NativeCommandResult[] = []) {
  const sql = [
    "select p.ROWID, coalesce(s.space_uuid,''), coalesce(di.display_uuid,''), coalesce(d.value,'')",
    "from pictures p",
    "left join spaces s on s.ROWID = p.space_id",
    "left join displays di on di.ROWID = p.display_id",
    "left join preferences pr on pr.picture_id = p.ROWID and pr.key = 1",
    "left join data d on d.ROWID = pr.data_id",
    "where coalesce(s.space_uuid,'') <> '' or coalesce(di.display_uuid,'') <> ''",
    "order by p.ROWID desc",
    "limit 120;"
  ].join("\n");
  const read = await runNativeCommand("macos-dock-targets-read", "/usr/bin/sqlite3", ["-separator", "\t", dockWallpaperDatabasePath(), sql], 5000);
  nativeResults.push(read);
  if (!commandSucceeded(read)) return [];
  const unique = new Map<string, DockPictureRow>();
  for (const row of read.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const [rawId, rawSpaceId = "", rawDisplayId = "", rawPath = ""] = row.split("\t");
    const pictureId = Number(rawId);
    if (!Number.isFinite(pictureId)) continue;
    const spaceId = rawSpaceId || undefined;
    const displayId = rawDisplayId || undefined;
    const key = `${spaceId ?? "no-space"}:${displayId ?? "no-display"}`;
    if (unique.has(key)) continue;
    // Keep the target even when its previous wallpaper file was cleaned up.
    // Dropping rows with missing files made inactive Mission Control Spaces
    // disappear from the target list, so they could never be updated again.
    const currentPath = rawPath ? normalizeWallpaperPath(rawPath) : undefined;
    unique.set(key, {
      pictureId,
      spaceId,
      displayId,
      currentPath
    });
  }
  return [...unique.values()].sort((a, b) => a.pictureId - b.pictureId);
}

function dockAssignmentsSql(assignments: Array<{ pictureId: number; filePath: string }>) {
  const statements = ["begin immediate;"];
  for (const assignment of assignments) {
    const escapedPath = escapeSql(assignment.filePath);
    statements.push(
      `insert or ignore into data(value) values ('${escapedPath}');`,
      `update preferences set data_id = (select ROWID from data where value = '${escapedPath}' order by ROWID desc limit 1) where picture_id = ${assignment.pictureId} and key = 1;`,
      `insert into preferences(picture_id,key,data_id) select ${assignment.pictureId}, 1, (select ROWID from data where value = '${escapedPath}' order by ROWID desc limit 1) where not exists (select 1 from preferences where picture_id = ${assignment.pictureId} and key = 1);`
    );
  }
  statements.push("commit;");
  return statements.join("\n");
}

async function applyDockAssignments(
  assignments: Array<{ pictureId: number; filePath: string }>,
  nativeResults: NativeCommandResult[],
  method = "macos-dock-database-batch-apply"
) {
  if (!assignments.length) return undefined;
  const apply = await runNativeCommand(method, "/usr/bin/sqlite3", [dockWallpaperDatabasePath(), dockAssignmentsSql(assignments)], 8000);
  nativeResults.push(apply);
  if (commandSucceeded(apply)) {
    // Restore the known-good refresh path used before the inactive-Space
    // regression: commit every assignment in one transaction, then restart Dock
    // once for the whole batch. Without this refresh, macOS leaves inactive
    // Mission Control thumbnails stale until the user enters each Space.
    const refresh = await runNativeCommand("macos-dock-refresh", "/usr/bin/killall", ["Dock"], 5000);
    nativeResults.push(refresh);
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return apply;
}

async function verifyMacOSWallpaper(
  filePath: string,
  nativeResults: NativeCommandResult[],
  options: { targetIndex?: number; dockPictureId?: number; requireEveryDesktop?: boolean } = {}
): Promise<MacOSVerification> {
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
    const sql = [
      "select value from data where value in (",
      `'${escapeSql(filePath)}',`,
      `'${escapeSql(targetPath)}',`,
      `'${escapeSql(filePath.replace(os.homedir(), "~"))}',`,
      `'${escapeSql(targetPath.replace(os.homedir(), "~"))}'`,
      ") limit 10;"
    ].join("");
    const databaseRead = await runNativeCommand("macos-dock-database-read", "/usr/bin/sqlite3", [dockWallpaperDatabasePath(), sql], 5000);
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

  let dockReportedPath: string | undefined;
  if (options.dockPictureId) {
    const sql = [
      "select coalesce(d.value,'')",
      "from pictures p",
      "left join preferences pr on pr.picture_id = p.ROWID and pr.key = 1",
      "left join data d on d.ROWID = pr.data_id",
      `where p.ROWID = ${options.dockPictureId}`,
      "limit 1;"
    ].join(" ");
    const dockTargetRead = await runNativeCommand("macos-dock-target-read", "/usr/bin/sqlite3", [dockWallpaperDatabasePath(), sql], 5000);
    nativeResults.push(dockTargetRead);
    if (commandSucceeded(dockTargetRead)) {
      dockReportedPath = dockTargetRead.stdout.trim() ? normalizeWallpaperPath(dockTargetRead.stdout) : undefined;
      if (dockReportedPath) verifiedPaths.push(dockReportedPath);
      if (dockReportedPath === targetPath) {
        verificationMethod = "Dock wallpaper database target";
        permissionStatus = "verified";
      }
    }
  }

  const indexedPath = options.targetIndex ? verifiedPaths[options.targetIndex - 1] : undefined;
  const changed = options.requireEveryDesktop
    ? verifiedPaths.length > 0 && verifiedPaths.every((item) => item === targetPath)
    : options.dockPictureId
      ? dockReportedPath === targetPath
    : options.targetIndex
      ? indexedPath === targetPath
      : verifiedPaths.includes(targetPath);

  return {
    verifiedPaths,
    verificationMethod,
    permissionStatus,
    changed,
    reportedPath: options.dockPictureId ? dockReportedPath : indexedPath ?? (verifiedPaths.includes(targetPath) ? targetPath : verifiedPaths[0])
  };
}

export class MacOSWallpaperController implements WallpaperController {
  async getTargets() {
    const nativeResults: NativeCommandResult[] = [];
    const dockRows = await readDockPictureRows(nativeResults);
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

    const visibleRows = commandSucceeded(read)
      ? read.stdout
          .split(", ")
          .flatMap((entry) => entry.split(/\r?\n/))
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((row, fallbackIndex) => {
            const [rawIndex, rawPath = ""] = row.split("\t");
            return {
              index: Number(rawIndex) || fallbackIndex + 1,
              currentPath: rawPath ? normalizeWallpaperPath(rawPath) : undefined
            };
          })
      : [];

    return buildMacOSWallpaperTargets(
      dockRows,
      visibleRows,
      read.timedOut
        ? "macOS Automation timed out while listing desktops."
        : read.error || read.stderr || "macOS did not expose desktop targets."
    );
  }

  async setWallpapers(items: WallpaperBatchItem[], options: WallpaperControllerOptions = {}) {
    const nativeResults: NativeCommandResult[] = [];
    const dockItems = items
      .map((item) => ({ item, pictureId: dockPictureIdFromTargetId(item.targetId) }))
      .filter((entry): entry is { item: WallpaperBatchItem; pictureId: number } => Boolean(entry.pictureId));
    const fallbackItems = items.filter((item) => !dockPictureIdFromTargetId(item.targetId));
    const results: WallpaperTargetResult[] = [];
    const previousRows = dockItems.length ? await readDockPictureRows(nativeResults) : [];
    const previousById = new Map(previousRows.map((row) => [row.pictureId, row.currentPath]));
    const rowById = new Map(previousRows.map((row) => [row.pictureId, row]));
    const visibleBeforeApply = dockItems.length ? await readVisibleDesktopPaths(nativeResults) : [];
    const classifications = classifyMacOSDockRows(
      previousRows,
      visibleBeforeApply.map((currentPath, index) => ({ index: index + 1, currentPath }))
    );
    const classificationById = new Map(classifications.map((item) => [item.pictureId, item]));

    if (dockItems.length) {
      const apply = await applyDockAssignments(
        dockItems.map(({ item, pictureId }) => ({ pictureId, filePath: item.filePath })),
        nativeResults
      );
      // Refresh the currently visible screen(s) through AppKit so the active
      // desktop changes without restarting Dock or showing a black frame.
      const visibleDockItems = dockItems
        .filter(({ pictureId }) => classificationById.get(pictureId)?.visible)
        .sort((a, b) => (classificationById.get(a.pictureId)?.visibleIndex ?? 999) - (classificationById.get(b.pictureId)?.visibleIndex ?? 999));
      if (visibleDockItems.length) {
        await applyVisibleScreensBatchWithAppKit(visibleDockItems.map(({ item }) => item.filePath), nativeResults);
      }
      for (const { item, pictureId } of dockItems) {
        const itemResults = [...nativeResults];
        const verification = commandSucceeded(apply ?? { method: "", command: "", args: [], stdout: "", stderr: "", exitCode: 1, timedOut: false })
          ? await verifyMacOSWallpaper(item.filePath, itemResults, { dockPictureId: pictureId })
          : { verifiedPaths: [] as string[], verificationMethod: undefined, permissionStatus: "not-checked" as const, changed: false };
        const row = rowById.get(pictureId);
        const classification = classificationById.get(pictureId);
        const visuallyVerifiable = Boolean(classification?.visible);
        const assignmentRecorded = commandSucceeded(apply ?? { method: "", command: "", args: [], stdout: "", stderr: "", exitCode: 1, timedOut: false });
        const accepted = verification.changed || (!visuallyVerifiable && assignmentRecorded);
        const diagnostics: WallpaperApplyDiagnostics = {
          renderedPath: item.filePath,
          fileSize: item.fileSize,
          validImage: true,
          nativeResults: itemResults,
          verifiedPaths: verification.verifiedPaths,
          verificationMethod: visuallyVerifiable
            ? verification.verificationMethod
            : accepted ? "Dock assignment recorded; inactive Space will be visually confirmed when activated" : verification.verificationMethod,
          permissionStatus: visuallyVerifiable && verification.changed
            ? "verified"
            : accepted ? "not-checked" : verification.permissionStatus === "not-checked" && visuallyVerifiable ? "verification-failed" : verification.permissionStatus,
          changed: accepted,
          lastError: accepted ? undefined : apply?.error || apply?.stderr || "macOS Dock database did not accept the requested wallpaper for this Space.",
          targetId: item.targetId,
          targetLabel: item.targetLabel,
          targetIndex: pictureId,
          displayId: row?.displayId,
          spaceId: row?.spaceId,
          targetType: classification?.targetType ?? "inactive-space",
          visible: classification?.visible ?? false,
          requestedPath: item.filePath,
          reportedPath: verification.reportedPath,
          verificationResult: visuallyVerifiable
            ? verification.changed ? "matched" : verification.reportedPath ? "mismatched" : "unavailable"
            : "unavailable"
        };
        results.push({
          targetId: item.targetId,
          targetLabel: item.targetLabel,
          filePath: item.filePath,
          fileSize: item.fileSize,
          diagnostics,
          ok: diagnostics.changed,
          error: diagnostics.lastError
        });
      }
    }

    const dockResults = results.filter((result) => Boolean(dockPictureIdFromTargetId(result.targetId)));
    const dockBatchFailed = dockResults.some((result) => !result.ok);
    if (dockBatchFailed) {
      const rollbackItems = dockItems.map(({ pictureId }) => ({
        pictureId,
        filePath: previousById.get(pictureId)
      })).filter((item): item is { pictureId: number; filePath: string } => Boolean(item.filePath));
      if (rollbackItems.length) {
        await applyDockAssignments(rollbackItems, nativeResults, "macos-dock-database-rollback");
        const visibleRollbackItems = rollbackItems
          .filter(({ pictureId }) => classificationById.get(pictureId)?.visible)
          .sort((a, b) => (classificationById.get(a.pictureId)?.visibleIndex ?? 999) - (classificationById.get(b.pictureId)?.visibleIndex ?? 999));
        if (visibleRollbackItems.length) {
          await applyVisibleScreensBatchWithAppKit(visibleRollbackItems.map((item) => item.filePath), nativeResults);
        }
      }
      for (const result of dockResults) {
        if (result.ok) {
          result.ok = false;
          result.error = "Wallpaper batch was rolled back because another desktop target failed.";
          result.diagnostics.changed = false;
          result.diagnostics.lastError = result.error;
          result.diagnostics.verificationResult = "unavailable";
        }
      }
    }

    for (const item of fallbackItems) {
      try {
        const diagnostics = await this.setWallpaper(item.filePath, { ...options, scope: "different-per-desktop", targetId: item.targetId });
        diagnostics.fileSize = item.fileSize;
        diagnostics.validImage = true;
        diagnostics.targetLabel = item.targetLabel;
        results.push({
          targetId: item.targetId,
          targetLabel: item.targetLabel,
          filePath: item.filePath,
          fileSize: item.fileSize,
          diagnostics,
          ok: diagnostics.changed,
          error: diagnostics.lastError
        });
      } catch (error) {
        const diagnostics = error && typeof error === "object" && "diagnostics" in error
          ? error.diagnostics as WallpaperApplyDiagnostics
          : { nativeResults: [], verifiedPaths: [], changed: false, lastError: error instanceof Error ? error.message : "Unable to set wallpaper target." };
        results.push({
          targetId: item.targetId,
          targetLabel: item.targetLabel,
          filePath: item.filePath,
          fileSize: item.fileSize,
          diagnostics,
          ok: false,
          error: diagnostics.lastError
        });
      }
    }

    return items.map((item) => results.find((result) => result.targetId === item.targetId)!).filter(Boolean);
  }

  async setWallpaper(filePath: string, options: WallpaperControllerOptions = {}): Promise<WallpaperApplyDiagnostics> {
    const nativeResults: NativeCommandResult[] = [];
    const scope = options.scope ?? "same-all-desktops";

    // Normal Generate and Apply previously worked through this direct
    // AppleScript path. Restore it as the primary path for non-targeted
    // applies. The newer AppKit/Dock verification can report a false negative
    // even after macOS has accepted the wallpaper, which made the renderer
    // treat a real apply as a failure.
    if (!options.targetId && scope !== "different-per-desktop") {
      const legacyApply = await applyMacOSWallpaperLegacy(filePath, nativeResults, scope);
      if (commandSucceeded(legacyApply) && legacyApply.stdout.trim().startsWith("ok:")) {
        // Keep inactive Mission Control Space records in sync on a best-effort
        // basis, but never turn a successful visible apply into a failure just
        // because the private Dock database is unavailable or unverifiable.
        if (scope === "same-all-desktops") {
          const rows = await readDockPictureRows(nativeResults);
          if (rows.length) {
            const databaseApply = await runNativeCommand(
              "macos-dock-database-all-best-effort",
              "/usr/bin/sqlite3",
              [dockWallpaperDatabasePath(), dockAssignmentsSql(rows.map((row) => ({ pictureId: row.pictureId, filePath })))],
              8000
            );
            nativeResults.push(databaseApply);
          }
        }
        return {
          renderedPath: filePath,
          nativeResults,
          verifiedPaths: [normalizeWallpaperPath(filePath)],
          verificationMethod: scope === "current-desktop"
            ? "Finder direct apply"
            : "System Events direct apply",
          permissionStatus: "verified",
          changed: true,
          targetLabel: scope === "current-desktop" ? "Current desktop" : "All desktops",
          requestedPath: filePath,
          reportedPath: normalizeWallpaperPath(filePath),
          verificationResult: "matched"
        };
      }
      // Continue into the newer fallback path so AppKit can still work when
      // Automation permission for System Events/Finder has not been granted.
    }
    const targetIndex = targetIndexFromId(options.targetId);
    const dockPictureId = dockPictureIdFromTargetId(options.targetId);
    const dockTargets = dockPictureId ? await readDockPictureRows(nativeResults) : [];
    const dockTarget = dockTargets.find((target) => target.pictureId === dockPictureId);
    const scriptLines = dockPictureId
      ? []
      : scope === "current-desktop"
      ? [
          'tell application "Finder" to set desktop picture to imageFile'
        ]
      : targetIndex && !dockPictureId
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
    const appKitApply = !dockPictureId
      ? await applyVisibleScreensWithAppKit(filePath, nativeResults, scope === "same-all-desktops")
      : undefined;
    let dockAllAssignmentRecorded = false;
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

    let applyResult = appKitApply && commandSucceeded(appKitApply) ? appKitApply : systemEventsApply;
    if (!dockPictureId && scope === "same-all-desktops") {
      const rows = await readDockPictureRows(nativeResults);
      if (rows.length) {
        const ids = rows.map((row) => row.pictureId).filter(Number.isFinite).join(",");
        const sql = [
          "insert or ignore into data(value) values",
          `('${escapeSql(filePath)}');`,
          "update preferences set data_id = (select ROWID from data where value =",
          `'${escapeSql(filePath)}' order by ROWID desc limit 1)`,
          `where picture_id in (${ids}) and key = 1;`,
          "insert into preferences(picture_id,key,data_id)",
          `select p.ROWID, 1, (select ROWID from data where value = '${escapeSql(filePath)}' order by ROWID desc limit 1)`,
          "from pictures p",
          `where p.ROWID in (${ids})`,
          "and not exists (select 1 from preferences pr where pr.picture_id = p.ROWID and pr.key = 1);"
        ].join(" ");
        const dockAllApply = await runNativeCommand("macos-dock-database-all-apply", "/usr/bin/sqlite3", [dockWallpaperDatabasePath(), sql], 5000);
        nativeResults.push(dockAllApply);
        if (commandSucceeded(dockAllApply)) {
          applyResult = dockAllApply;
          dockAllAssignmentRecorded = true;
          const refresh = await runNativeCommand("macos-dock-refresh-all", "/usr/bin/killall", ["Dock"], 5000);
          nativeResults.push(refresh);
          await new Promise((resolve) => setTimeout(resolve, 900));
          // Reassert visible displays after Dock relaunches so the active screen
          // does not remain blank or show an older cached image.
          await applyVisibleScreensWithAppKit(filePath, nativeResults, true);
        }
      }
    }
    if (dockPictureId) {
      const sql = [
        "insert or ignore into data(value) values",
        `('${escapeSql(filePath)}');`,
        "update preferences set data_id = (select ROWID from data where value =",
        `'${escapeSql(filePath)}' order by ROWID desc limit 1)`,
        `where picture_id = ${dockPictureId} and key = 1;`,
        "insert into preferences(picture_id,key,data_id)",
        `select ${dockPictureId}, 1, (select ROWID from data where value = '${escapeSql(filePath)}' order by ROWID desc limit 1)`,
        `where not exists (select 1 from preferences where picture_id = ${dockPictureId} and key = 1);`
      ].join(" ");
      const dockApply = await runNativeCommand("macos-dock-database-target-apply", "/usr/bin/sqlite3", [dockWallpaperDatabasePath(), sql], 5000);
      nativeResults.push(dockApply);
      applyResult = dockApply;
      if (commandSucceeded(dockApply)) {
        const refresh = await runNativeCommand("macos-dock-refresh-target", "/usr/bin/killall", ["Dock"], 5000);
        nativeResults.push(refresh);
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    }
    let verification: MacOSVerification = commandSucceeded(applyResult)
      ? await verifyMacOSWallpaper(filePath, nativeResults, {
          targetIndex,
          dockPictureId,
          requireEveryDesktop: scope === "same-all-desktops" && !targetIndex
        })
      : { verifiedPaths: [] as string[], verificationMethod: undefined, permissionStatus: "not-checked" as const, changed: false };

    if (!verification.changed && !dockPictureId) {
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
          dockPictureId,
          requireEveryDesktop: scope === "same-all-desktops" && !targetIndex
        });
      }
    }

    const { verifiedPaths, verificationMethod, permissionStatus } = verification;
    const visibleApplySucceeded = Boolean(appKitApply && commandSucceeded(appKitApply));
    const acceptedDockAll = scope === "same-all-desktops" && dockAllAssignmentRecorded && visibleApplySucceeded;
    const changed = verification.changed || acceptedDockAll;
    const lastError = !commandSucceeded(applyResult)
      ? applyResult.error || applyResult.stderr || "macOS native wallpaper command failed."
      : changed
        ? undefined
        : "macOS did not report the rendered file as the active desktop picture.";

    const finalPermissionStatus: WallpaperApplyDiagnostics["permissionStatus"] = verification.changed
      ? "verified"
      : acceptedDockAll
        ? "not-checked"
        : permissionStatus === "not-checked"
          ? "verification-failed"
          : permissionStatus;
    const verificationResult: WallpaperApplyDiagnostics["verificationResult"] = verification.changed
      ? "matched"
      : acceptedDockAll
        ? "unavailable"
        : verification.reportedPath
          ? "mismatched"
          : "unavailable";

    return {
      renderedPath: filePath,
      nativeResults,
      verifiedPaths,
      verificationMethod: acceptedDockAll && !verification.changed
        ? "Visible displays applied with AppKit; inactive Space assignments recorded in Dock database"
        : verificationMethod,
      permissionStatus: finalPermissionStatus,
      changed,
      lastError,
      targetId: options.targetId,
      targetLabel: targetIndex ? `Desktop ${targetIndex}` : dockPictureId ? `Desktop target ${dockPictureId}` : scope === "current-desktop" ? "Current desktop" : "All desktops",
      targetIndex: targetIndex ?? dockTarget?.pictureId,
      displayId: dockTarget?.displayId,
      spaceId: dockTarget?.spaceId,
      requestedPath: filePath,
      reportedPath: verification.reportedPath,
      verificationResult
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
