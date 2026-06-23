import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  MacOSAllSpacesApplyStatus,
  MacOSLegacyWallpaperDatabaseDiagnostic,
  MacOSWallpaperDiagnosticReport,
  MacOSWallpaperDisplayDiagnostic,
  MacOSWallpaperFileReferenceDiagnostic,
  MacOSWallpaperStoreDiagnostic,
  MacOSWallpaperStrategy,
  NativeCommandResult,
  WallpaperAllSpacesRefreshMode,
  WallpaperDisplayMode,
  WallpaperTargetMode
} from "../shared/types.js";

export interface MacOSSpaceAssignment {
  displayId: string;
  filePath: string;
}

export interface MacOSSpacesApplySummary extends MacOSAllSpacesApplyStatus {
  ok: boolean;
  mode: WallpaperTargetMode;
  diagnostic: MacOSWallpaperDiagnosticReport;
}

export interface MacOSSpacesApplyResult {
  command: NativeCommandResult;
  commands: NativeCommandResult[];
  summary?: MacOSSpacesApplySummary;
}

function runNativeCommand(method: string, command: string, args: string[], timeout = 20_000): Promise<NativeCommandResult> {
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

export interface StableAssetSlotUpdate {
  displayId: string;
  displayUUID: string;
  sourcePath: string;
  targetPath: string;
  spaceUUID?: string;
  shared: boolean;
  kind: "space" | "display" | "global";
}

export interface StableAssetSlotPlan {
  ok: boolean;
  updates: StableAssetSlotUpdate[];
  targetSpaceCount: number;
  targetSharedSpaceCount: number;
  targetDisplayCount: number;
  errors: string[];
}

function pathInside(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function uniqueByTarget(updates: StableAssetSlotUpdate[]) {
  const result: StableAssetSlotUpdate[] = [];
  const seen = new Set<string>();
  for (const update of updates) {
    const key = path.resolve(update.targetPath);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(update);
  }
  return result;
}

export function planStableAssetSlotUpdates(
  diagnostic: MacOSWallpaperDiagnosticReport,
  assignments: MacOSSpaceAssignment[],
  mode: Extract<WallpaperTargetMode, "all-desktops-current-monitor" | "all-desktops-all-monitors">,
  vaultRoot = path.join(os.homedir(), "Pictures", "Pin Paper", "Wallpaper Vault")
): StableAssetSlotPlan {
  const errors: string[] = [];
  const updates: StableAssetSlotUpdate[] = [];
  const sharedSpaces = new Set(diagnostic.sharedSpaceUUIDs);
  const displayById = new Map(diagnostic.displays.map((display) => [display.displayId, display]));

  for (const assignment of assignments) {
    const sourcePath = path.resolve(assignment.filePath);
    if (!pathInside(vaultRoot, sourcePath)) {
      errors.push(`Generated wallpaper is outside the permanent Wallpaper Vault: ${sourcePath}`);
      continue;
    }
    const display = displayById.get(assignment.displayId);
    const displayUUID = display?.displayUUID?.toUpperCase();
    if (!display || !displayUUID) {
      errors.push(`Display ${assignment.displayId} does not have a stable UUID mapping.`);
      continue;
    }

    for (const spaceUUID of display.spaceUUIDs) {
      const targetPath = diagnostic.store.spaceDisplayPaths?.[spaceUUID]?.[displayUUID];
      if (!targetPath) {
        errors.push(`Space ${spaceUUID} on display ${displayUUID} has no wallpaper file slot.`);
        continue;
      }
      const resolvedTarget = path.resolve(targetPath);
      if (!pathInside(vaultRoot, resolvedTarget)) {
        errors.push(`Space ${spaceUUID} points outside the Wallpaper Vault and will not be overwritten: ${resolvedTarget}`);
        continue;
      }
      updates.push({
        displayId: assignment.displayId,
        displayUUID,
        sourcePath,
        targetPath: resolvedTarget,
        spaceUUID,
        shared: sharedSpaces.has(spaceUUID),
        kind: "space"
      });
    }

    const displayPath = diagnostic.store.displayPaths?.[displayUUID];
    if (displayPath) {
      const resolvedDisplayPath = path.resolve(displayPath);
      if (pathInside(vaultRoot, resolvedDisplayPath)) {
        updates.push({
          displayId: assignment.displayId,
          displayUUID,
          sourcePath,
          targetPath: resolvedDisplayPath,
          shared: false,
          kind: "display"
        });
      }
    }
  }

  const sourcePaths = [...new Set(assignments.map((assignment) => path.resolve(assignment.filePath)))];
  if (mode === "all-desktops-all-monitors" && sourcePaths.length === 1) {
    for (const reference of diagnostic.store.references) {
      if (!reference.source.startsWith("SystemDefault.") && !reference.source.startsWith("AllSpacesAndDisplays.")) continue;
      const targetPath = path.resolve(reference.path);
      if (!pathInside(vaultRoot, targetPath)) continue;
      updates.push({
        displayId: assignments[0]?.displayId ?? "global",
        displayUUID: diagnostic.displays[0]?.displayUUID?.toUpperCase() ?? "GLOBAL",
        sourcePath: sourcePaths[0],
        targetPath,
        shared: true,
        kind: "global"
      });
    }
  }

  const spaceUpdates = updates.filter((update) => update.kind === "space");
  const userSpaceKeys = new Set(spaceUpdates.filter((update) => !update.shared).map((update) => `${update.displayUUID}:${update.spaceUUID}`));
  const sharedSpaceKeys = new Set(spaceUpdates.filter((update) => update.shared).map((update) => `${update.displayUUID}:${update.spaceUUID}`));
  const displayKeys = new Set(updates.filter((update) => update.kind === "display").map((update) => update.displayUUID));

  if (!spaceUpdates.length) errors.push("No existing app-owned wallpaper slots were found for the selected Mission Control desktops.");

  return {
    ok: errors.length === 0 && userSpaceKeys.size > 0,
    updates,
    targetSpaceCount: userSpaceKeys.size,
    targetSharedSpaceCount: sharedSpaceKeys.size,
    targetDisplayCount: displayKeys.size || assignments.length,
    errors
  };
}

async function fileHash(filePath: string) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

interface StableAssetSlotApplyResult {
  ok: boolean;
  plan: StableAssetSlotPlan;
  commands: NativeCommandResult[];
  verifiedSpaceCount: number;
  verifiedSharedSpaceCount: number;
  verifiedDisplayCount: number;
  verifiedSlotCount: number;
  slotPaths: string[];
  rollbackPerformed: boolean;
  durationMs: number;
  error?: string;
}

async function applyStableAssetSlots(
  diagnostic: MacOSWallpaperDiagnosticReport,
  assignments: MacOSSpaceAssignment[],
  mode: Extract<WallpaperTargetMode, "all-desktops-current-monitor" | "all-desktops-all-monitors">
): Promise<StableAssetSlotApplyResult> {
  const startedAt = Date.now();
  const plan = planStableAssetSlotUpdates(diagnostic, assignments, mode);
  const commands: NativeCommandResult[] = [];
  if (!plan.ok) {
    return {
      ok: false,
      plan,
      commands,
      verifiedSpaceCount: 0,
      verifiedSharedSpaceCount: 0,
      verifiedDisplayCount: 0,
      verifiedSlotCount: 0,
      slotPaths: [],
      rollbackPerformed: false,
      durationMs: Date.now() - startedAt,
      error: plan.errors.join(" ")
    };
  }

  const uniqueUpdates = uniqueByTarget(plan.updates);
  const backupDirectory = await mkdtemp(path.join(os.tmpdir(), "pwc-wallpaper-slots-"));
  const backups = new Map<string, { backupPath?: string; existed: boolean }>();
  let rollbackPerformed = false;

  try {
    for (const [index, update] of uniqueUpdates.entries()) {
      await access(update.sourcePath, constants.R_OK);
      let existed = true;
      try { await stat(update.targetPath); } catch { existed = false; }
      const backupPath = existed ? path.join(backupDirectory, `${index}.backup`) : undefined;
      if (backupPath) await copyFile(update.targetPath, backupPath);
      backups.set(update.targetPath, { backupPath, existed });
      if (path.resolve(update.sourcePath) !== path.resolve(update.targetPath)) {
        await copyFile(update.sourcePath, update.targetPath);
      }
      const now = new Date();
      await utimes(update.targetPath, now, now);
    }

    const touch = await runNativeCommand(
      "macos-stable-wallpaper-slot-touch",
      "/usr/bin/touch",
      uniqueUpdates.map((update) => update.targetPath),
      10_000
    );
    commands.push(touch);

    await new Promise((resolve) => setTimeout(resolve, 450));
    const sourceHashes = new Map<string, string>();
    for (const update of uniqueUpdates) {
      if (!sourceHashes.has(update.sourcePath)) sourceHashes.set(update.sourcePath, await fileHash(update.sourcePath));
    }
    const verifiedTargets = new Set<string>();
    for (const update of uniqueUpdates) {
      const expected = sourceHashes.get(update.sourcePath);
      if (expected && await fileHash(update.targetPath) === expected) verifiedTargets.add(path.resolve(update.targetPath));
    }

    const verifiedRecords = plan.updates.filter((update) => verifiedTargets.has(path.resolve(update.targetPath)));
    const verifiedUserSpaces = new Set(verifiedRecords.filter((update) => update.kind === "space" && !update.shared).map((update) => `${update.displayUUID}:${update.spaceUUID}`));
    const verifiedSharedSpaces = new Set(verifiedRecords.filter((update) => update.kind === "space" && update.shared).map((update) => `${update.displayUUID}:${update.spaceUUID}`));
    const verifiedDisplays = new Set(verifiedRecords.filter((update) => update.kind === "display").map((update) => update.displayUUID));
    const ok = verifiedUserSpaces.size === plan.targetSpaceCount
      && verifiedSharedSpaces.size === plan.targetSharedSpaceCount
      && (verifiedDisplays.size === plan.targetDisplayCount || plan.targetDisplayCount === assignments.length && verifiedDisplays.size === 0);

    return {
      ok,
      plan,
      commands,
      verifiedSpaceCount: verifiedUserSpaces.size,
      verifiedSharedSpaceCount: verifiedSharedSpaces.size,
      verifiedDisplayCount: verifiedDisplays.size || assignments.length,
      verifiedSlotCount: verifiedTargets.size,
      slotPaths: [...verifiedTargets],
      rollbackPerformed,
      durationMs: Date.now() - startedAt,
      error: ok ? undefined : "One or more existing wallpaper asset slots did not match the newly rendered image after the in-place update."
    };
  } catch (error) {
    for (const [targetPath, backup] of backups) {
      try {
        if (backup.existed && backup.backupPath) await copyFile(backup.backupPath, targetPath);
        else if (!backup.existed) await rm(targetPath, { force: true });
      } catch {
        // Best-effort rollback; preserve the original error below.
      }
    }
    rollbackPerformed = backups.size > 0;
    return {
      ok: false,
      plan,
      commands,
      verifiedSpaceCount: 0,
      verifiedSharedSpaceCount: 0,
      verifiedDisplayCount: 0,
      verifiedSlotCount: 0,
      slotPaths: [],
      rollbackPerformed,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await rm(backupDirectory, { recursive: true, force: true });
  }
}

function displayStyle(mode: WallpaperDisplayMode | undefined) {
  switch (mode) {
    case "fit": return "fit";
    case "stretch": return "stretch";
    case "tile": return "tile";
    case "center": return "center";
    case "span":
    case "fill":
    default:
      return "fill";
  }
}

export function chooseMacOSWallpaperStrategy(input: {
  platform: string;
  macOSMajorVersion?: number;
  storeCompatible: boolean;
  storeWritable: boolean;
  legacyCompatible: boolean;
  legacyWritable: boolean;
  legacyTargetRecordCount: number;
}): MacOSWallpaperStrategy {
  if (input.platform !== "darwin") return "unsupported";
  const modern = input.storeCompatible && input.storeWritable;

  // The application never writes the legacy Dock database. That path requires
  // a Dock restart to become visible, which can flash black and interrupt
  // Mission Control. A compatible modern Store is the only immediate
  // inactive-Space strategy; otherwise the caller falls back to visible
  // monitors or the active-Space observer without restarting macOS processes.
  if (modern) return "modern-store";
  return "observer-only";
}

const macOSWallpaperDiagnosticScript = String.raw`
ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
try {
  ObjC.bindFunction('CGSMainConnectionID', ['uint32', []]);
  ObjC.bindFunction('CGSCopyManagedDisplaySpaces', ['id', ['uint32']]);
} catch (_) {}
function text(value) { try { return ObjC.unwrap(value); } catch (_) { return String(value || ''); } }
function key(value) { return $(String(value)); }
function get(dict, name) { try { return dict ? dict.objectForKey(key(name)) : null; } catch (_) { return null; } }
function keys(dict) { try { return dict.allKeys.js.map(text); } catch (_) { return []; } }
function array(value) { try { return value ? value.js : []; } catch (_) { return []; } }
function displayNumber(screen, fallback) {
  try { return String(text(screen.deviceDescription.objectForKey('NSScreenNumber'))); }
  catch (_) { return String(fallback); }
}
function validUUID(value) { return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(String(value || '')); }
function uuidForDisplay(screen, displayId) {
  const candidates = [];
  try { candidates.push(text(screen.valueForKey('_UUIDString'))); } catch (_) {}
  try { candidates.push(text(screen.valueForKey('UUIDString'))); } catch (_) {}
  try { candidates.push(text(screen.deviceDescription.objectForKey('NSScreenUUID'))); } catch (_) {}
  try {
    const uuid = $.CGDisplayCreateUUIDFromDisplayID(Number(displayId));
    if (uuid) {
      const raw = $.CFUUIDCreateString(null, uuid);
      try { candidates.push(text(ObjC.castRefToObject(raw))); } catch (_) {}
      try { candidates.push(text(raw)); } catch (_) {}
    }
  } catch (_) {}
  const match = candidates.map((value) => String(value || '').toUpperCase()).find(validUUID);
  return match || '';
}
function uuidForDisplayId(displayId) {
  try {
    const screen = $.NSScreen.screens.js.find((candidate, index) => displayNumber(candidate, index + 1) === String(displayId));
    return uuidForDisplay(screen, displayId);
  } catch (_) { return ''; }
}
function managedDisplaySpaces(mainUUID) {
  try {
    if (!$.CGSMainConnectionID || !$.CGSCopyManagedDisplaySpaces) return [];
    const raw = ObjC.deepUnwrap($.CGSCopyManagedDisplaySpaces($.CGSMainConnectionID())) || [];
    return (Array.isArray(raw) ? raw : []).map((entry) => {
      let displayUUID = String(entry['Display Identifier'] || entry.DisplayID || '');
      if (displayUUID === 'Main') displayUUID = mainUUID;
      const spaces = Array.isArray(entry.Spaces) ? entry.Spaces : [];
      const current = entry['Current Space'] || entry.CurrentSpace || {};
      return {
        displayUUID: displayUUID.toUpperCase(),
        currentSpaceUUID: String(current.uuid || current.UUID || ''),
        spaces: spaces.map((space) => String(space.uuid || space.UUID || '')).filter(Boolean)
      };
    }).filter((entry) => entry.displayUUID);
  } catch (_) { return []; }
}
function decodeConfiguration(data) {
  try {
    if (!data) return null;
    const format = Ref();
    const error = Ref();
    return $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(
      data, $.NSPropertyListMutableContainersAndLeaves, format, error
    );
  } catch (_) { return null; }
}
function normalizeReference(value) {
  const raw = String(value || '');
  if (!raw) return '';
  try {
    if (/^file:/i.test(raw)) {
      const url = $.NSURL.URLWithString(key(raw));
      return url ? text(url.path) : raw;
    }
  } catch (_) {}
  return raw.startsWith('/') ? raw : '';
}
function referencesFromDesktop(desktop, source) {
  const output = [];
  const content = get(desktop, 'Content');
  const choices = array(get(content, 'Choices'));
  choices.forEach((choice, choiceIndex) => {
    array(get(choice, 'Files')).forEach((file, fileIndex) => {
      ['relative', 'url', 'path'].forEach((field) => {
        const ref = normalizeReference(text(get(file, field)));
        if (ref) output.push({ source: source + '.Content.Choices.' + choiceIndex + '.Files.' + fileIndex + '.' + field, path: ref });
      });
    });
    const decoded = decodeConfiguration(get(choice, 'Configuration'));
    if (decoded) {
      const url = get(decoded, 'url');
      const module = get(decoded, 'module');
      const candidates = [
        get(url, 'relative'), get(url, 'absolute'), get(decoded, 'relative'), get(decoded, 'path'),
        get(module, 'relative'), get(module, 'absolute')
      ];
      candidates.forEach((candidate, index) => {
        const ref = normalizeReference(text(candidate));
        if (ref) output.push({ source: source + '.Configuration.' + index, path: ref });
      });
    }
  });
  return output;
}
function collectStore(plist, manager) {
  const refs = [];
  let desktopRecordCount = 0;
  const displayKeys = [];
  const displayPaths = {};
  const spaceDisplayUUIDs = {};
  const spaceDisplayPaths = {};
  function addDesktop(desktop, source) {
    if (!desktop) return [];
    desktopRecordCount += 1;
    const found = referencesFromDesktop(desktop, source);
    found.forEach((item) => refs.push(item));
    return found;
  }
  ['AllSpacesAndDisplays', 'SystemDefault'].forEach((sectionName) => {
    const section = get(plist, sectionName);
    addDesktop(get(section, 'Desktop'), sectionName + '.Desktop');
  });
  const displays = get(plist, 'Displays');
  keys(displays).forEach((displayKey) => {
    displayKeys.push(displayKey.toUpperCase());
    const found = addDesktop(get(get(displays, displayKey), 'Desktop'), 'Displays.' + displayKey + '.Desktop');
    displayPaths[displayKey.toUpperCase()] = found.length ? found[0].path : '';
  });
  const spaces = get(plist, 'Spaces');
  keys(spaces).forEach((spaceKey) => {
    const space = get(spaces, spaceKey);
    addDesktop(get(get(space, 'Default'), 'Desktop'), 'Spaces.' + spaceKey + '.Default.Desktop');
    const spaceDisplays = get(space, 'Displays');
    const mappedKeys = keys(spaceDisplays).map((value) => value.toUpperCase());
    spaceDisplayUUIDs[spaceKey] = mappedKeys;
    spaceDisplayPaths[spaceKey] = {};
    keys(spaceDisplays).forEach((displayKey) => {
      const found = addDesktop(get(get(spaceDisplays, displayKey), 'Desktop'), 'Spaces.' + spaceKey + '.Displays.' + displayKey + '.Desktop');
      spaceDisplayPaths[spaceKey][displayKey.toUpperCase()] = found.length ? found[0].path : '';
    });
  });
  const unique = {};
  refs.forEach((ref) => {
    const token = ref.source + '|' + ref.path;
    if (unique[token]) return;
    unique[token] = true;
    ref.exists = Boolean(manager.fileExistsAtPath(key(ref.path)));
    ref.readable = Boolean(manager.isReadableFileAtPath(key(ref.path)));
  });
  return {
    references: refs.filter((ref) => unique[ref.source + '|' + ref.path]),
    desktopRecordCount,
    displayKeys,
    displayPaths,
    spaceDisplayUUIDs,
    spaceDisplayPaths
  };
}
function run() {
  const manager = $.NSFileManager.defaultManager;
  const home = text($.NSHomeDirectory());
  const indexPath = home + '/Library/Application Support/com.apple.wallpaper/Store/Index.plist';
  const screens = $.NSScreen.screens.js;
  const screenRows = screens.map((screen, index) => {
    const frame = screen.frame;
    const displayId = displayNumber(screen, index + 1);
    return {
      displayId,
      displayUUID: uuidForDisplay(screen, displayId),
      name: text(screen.localizedName) || ('Display ' + (index + 1)),
      primary: index === 0,
      bounds: { x: Number(frame.origin.x), y: Number(frame.origin.y), width: Number(frame.size.width), height: Number(frame.size.height) },
      currentPath: (() => { const url = $.NSWorkspace.sharedWorkspace.desktopImageURLForScreen(screen); return url ? text(url.path) : ''; })()
    };
  });
  const mainScreen = $.NSScreen.mainScreen;
  const mainId = mainScreen ? displayNumber(mainScreen, 1) : '';
  const mainUUID = (screenRows.find((row) => row.displayId === mainId) || {}).displayUUID || uuidForDisplayId(mainId);
  const tree = managedDisplaySpaces(mainUUID);
  const displays = screenRows.map((row) => {
    const managed = tree.find((entry) => entry.displayUUID === row.displayUUID) || { currentSpaceUUID: '', spaces: [] };
    return Object.assign({}, row, { currentSpaceUUID: managed.currentSpaceUUID, spaceUUIDs: managed.spaces });
  });
  const store = {
    path: indexPath,
    exists: Boolean(manager.fileExistsAtPath(key(indexPath))),
    readable: Boolean(manager.isReadableFileAtPath(key(indexPath))),
    writable: Boolean(manager.isWritableFileAtPath(key(indexPath))),
    schema: 'missing', compatible: false, topLevelKeys: [], displayRecordCount: 0, spaceRecordCount: 0, desktopRecordCount: 0, displayKeys: [], spaceDisplayUUIDs: {}, references: []
  };
  if (store.exists && store.readable) {
    try {
      const data = $.NSData.dataWithContentsOfFile(key(indexPath));
      const format = Ref();
      const error = Ref();
      const plist = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, $.NSPropertyListMutableContainersAndLeaves, format, error);
      if (!plist) throw new Error(error[0] ? text(error[0].localizedDescription) : 'Invalid property list.');
      store.topLevelKeys = keys(plist);
      store.displayRecordCount = keys(get(plist, 'Displays')).length;
      store.spaceRecordCount = keys(get(plist, 'Spaces')).length;
      const collected = collectStore(plist, manager);
      store.desktopRecordCount = collected.desktopRecordCount;
      store.displayKeys = collected.displayKeys;
      store.spaceDisplayUUIDs = collected.spaceDisplayUUIDs;
      store.displayPaths = collected.displayPaths;
      store.spaceDisplayPaths = collected.spaceDisplayPaths;
      store.references = collected.references;
      store.compatible = store.topLevelKeys.includes('Spaces') && (store.topLevelKeys.includes('AllSpacesAndDisplays') || store.topLevelKeys.includes('SystemDefault') || store.topLevelKeys.includes('Displays'));
      store.schema = store.compatible ? 'modern-index-v1' : 'unknown';
    } catch (error) {
      store.schema = 'corrupt';
      store.error = error instanceof Error ? error.message : String(error);
    }
  }
  const inferredDisplays = screenRows.map((row) => {
    let displayUUID = String(row.displayUUID || '').toUpperCase();
    if (!validUUID(displayUUID)) {
      const direct = (store.displayKeys || []).filter((candidate) => store.displayPaths && store.displayPaths[candidate] === row.currentPath);
      const active = [];
      Object.keys(store.spaceDisplayPaths || {}).forEach((spaceUUID) => {
        const byDisplay = store.spaceDisplayPaths[spaceUUID] || {};
        Object.keys(byDisplay).forEach((candidate) => { if (byDisplay[candidate] === row.currentPath) active.push(candidate); });
      });
      const matches = Array.from(new Set(direct.concat(active))).filter(validUUID);
      if (matches.length === 1) displayUUID = matches[0];
    }
    const managed = tree.find((entry) => entry.displayUUID === displayUUID) || { currentSpaceUUID: '', spaces: [] };
    const storedSpaces = Object.keys(store.spaceDisplayUUIDs || {}).filter((spaceUUID) => (store.spaceDisplayUUIDs[spaceUUID] || []).includes(displayUUID));
    const currentByPath = storedSpaces.find((spaceUUID) => {
      const byDisplay = (store.spaceDisplayPaths || {})[spaceUUID] || {};
      return byDisplay[displayUUID] === row.currentPath;
    }) || '';
    return Object.assign({}, row, {
      displayUUID,
      currentSpaceUUID: managed.currentSpaceUUID || currentByPath,
      spaceUUIDs: Array.from(new Set((managed.spaces || []).concat(storedSpaces)))
    });
  });
  return JSON.stringify({ displays: inferredDisplays, tree, store });
}`;

interface DiagnosticJXAResult {
  displays: MacOSWallpaperDisplayDiagnostic[];
  tree: Array<{ displayUUID: string; currentSpaceUUID?: string; spaces: string[] }>;
  store: MacOSWallpaperStoreDiagnostic;
}

async function fileReference(pathValue: string, source: string): Promise<MacOSWallpaperFileReferenceDiagnostic> {
  let exists = false;
  let readable = false;
  try {
    await access(pathValue, constants.F_OK);
    exists = true;
    await access(pathValue, constants.R_OK);
    readable = true;
  } catch {
    // Keep explicit false flags in diagnostics.
  }
  return { source, path: pathValue, exists, readable };
}

async function inspectLegacyWallpaperDatabase(): Promise<MacOSLegacyWallpaperDatabaseDiagnostic> {
  const databasePath = path.join(os.homedir(), "Library/Application Support/Dock/desktoppicture.db");
  const result: MacOSLegacyWallpaperDatabaseDiagnostic = {
    path: databasePath,
    exists: false,
    readable: false,
    writable: false,
    compatible: false,
    tables: [],
    pictureRecordCount: 0,
    targetRecordCount: 0,
    references: []
  };
  try {
    await access(databasePath, constants.F_OK);
    result.exists = true;
    await access(databasePath, constants.R_OK);
    result.readable = true;
    await access(databasePath, constants.W_OK);
    result.writable = true;
  } catch (error) {
    if (result.exists) result.error = error instanceof Error ? error.message : String(error);
    return result;
  }

  const tablesCommand = await runNativeCommand(
    "macos-wallpaper-dock-schema",
    "/usr/bin/sqlite3",
    [databasePath, "select name from sqlite_master where type='table' order by name;"],
    5_000
  );
  if (!commandSucceeded(tablesCommand)) {
    result.error = tablesCommand.error || tablesCommand.stderr || "Unable to inspect the legacy wallpaper database.";
    return result;
  }
  result.tables = tablesCommand.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const required = ["data", "displays", "pictures", "preferences", "spaces"];
  result.compatible = required.every((table) => result.tables.includes(table));
  if (!result.compatible) {
    result.error = "The legacy wallpaper database does not have the expected tables.";
    return result;
  }

  const rowsCommand = await runNativeCommand(
    "macos-wallpaper-dock-records",
    "/usr/bin/sqlite3",
    ["-separator", "\t", databasePath, [
      "select p.ROWID, coalesce(s.space_uuid,''), coalesce(di.display_uuid,''), coalesce(d.value,'')",
      "from pictures p",
      "left join spaces s on s.ROWID = p.space_id",
      "left join displays di on di.ROWID = p.display_id",
      "left join preferences pr on pr.picture_id = p.ROWID and pr.key = 1",
      "left join data d on d.ROWID = pr.data_id",
      "order by p.ROWID;"
    ].join(" ")],
    5_000
  );
  if (!commandSucceeded(rowsCommand)) {
    result.error = rowsCommand.error || rowsCommand.stderr || "Unable to inspect legacy wallpaper records.";
    result.compatible = false;
    return result;
  }
  const rows = rowsCommand.stdout.split(/\r?\n/).filter(Boolean).map((row) => row.split("\t"));
  result.pictureRecordCount = rows.length;
  result.targetRecordCount = rows.filter(([, spaceId, displayId]) => Boolean(spaceId || displayId)).length;
  const uniquePaths = [...new Set(rows.map(([, , , filePath]) => filePath).filter(Boolean))];
  result.references = await Promise.all(uniquePaths.map((filePath) => fileReference(filePath, "legacy Dock wallpaper database")));
  return result;
}

function parseBooleanDefaults(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (["0", "false", "no"].includes(normalized)) return true;
  if (["1", "true", "yes"].includes(normalized)) return false;
  return undefined;
}

export function classifyMacOSStoreSpaces(spaceDisplayUUIDs: Record<string, string[]>) {
  const desktopSpaceUUIDs: string[] = [];
  const sharedSpaceUUIDs: string[] = [];
  for (const [spaceUUID, rawDisplayUUIDs] of Object.entries(spaceDisplayUUIDs)) {
    const displayUUIDs = [...new Set(rawDisplayUUIDs.map((value) => value.toUpperCase()).filter(Boolean))];
    if (displayUUIDs.length === 1) desktopSpaceUUIDs.push(spaceUUID);
    else if (displayUUIDs.length > 1) sharedSpaceUUIDs.push(spaceUUID);
  }
  return { desktopSpaceUUIDs, sharedSpaceUUIDs };
}

export async function diagnoseMacOSWallpaperEnvironment(activeDisplayId?: string): Promise<MacOSWallpaperDiagnosticReport> {
  const emptyStore: MacOSWallpaperStoreDiagnostic = {
    path: path.join(os.homedir(), "Library/Application Support/com.apple.wallpaper/Store/Index.plist"),
    exists: false,
    readable: false,
    writable: false,
    schema: "missing",
    compatible: false,
    topLevelKeys: [],
    displayRecordCount: 0,
    spaceRecordCount: 0,
    desktopRecordCount: 0,
    displayKeys: [],
    spaceDisplayUUIDs: {},
    references: []
  };
  const emptyLegacy: MacOSLegacyWallpaperDatabaseDiagnostic = {
    path: path.join(os.homedir(), "Library/Application Support/Dock/desktoppicture.db"),
    exists: false,
    readable: false,
    writable: false,
    compatible: false,
    tables: [],
    pictureRecordCount: 0,
    targetRecordCount: 0,
    references: []
  };
  if (process.platform !== "darwin") {
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      activeDisplayId,
      activeSpaceUUIDs: [],
      displays: [],
      totalSpaceCount: 0,
      sharedSpaceCount: 0,
      sharedSpaceUUIDs: [],
      wallpaperAgentRunning: false,
      dockRunning: false,
      store: emptyStore,
      legacyDatabase: emptyLegacy,
      recommendedStrategy: "unsupported",
      warnings: [],
      errors: ["macOS wallpaper diagnostics are available only on macOS."]
    };
  }

  const warnings: string[] = [];
  const errors: string[] = [];
  const [jxa, version, build, separateSpaces, agent, dock, legacyDatabase] = await Promise.all([
    runNativeCommand("macos-wallpaper-diagnostic", "/usr/bin/osascript", ["-l", "JavaScript", "-e", macOSWallpaperDiagnosticScript], 15_000),
    runNativeCommand("macos-version", "/usr/bin/sw_vers", ["-productVersion"], 3_000),
    runNativeCommand("macos-build", "/usr/bin/sw_vers", ["-buildVersion"], 3_000),
    runNativeCommand("macos-separate-spaces", "/usr/bin/defaults", ["read", "com.apple.spaces", "spans-displays"], 3_000),
    runNativeCommand("macos-wallpaper-agent-status", "/usr/bin/pgrep", ["-x", "WallpaperAgent"], 3_000),
    runNativeCommand("macos-dock-status", "/usr/bin/pgrep", ["-x", "Dock"], 3_000),
    inspectLegacyWallpaperDatabase()
  ]);

  let native: DiagnosticJXAResult = { displays: [], tree: [], store: emptyStore };
  if (commandSucceeded(jxa)) {
    try {
      native = JSON.parse(jxa.stdout.trim()) as DiagnosticJXAResult;
    } catch (error) {
      errors.push(`Wallpaper diagnostic response could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    errors.push(jxa.error || jxa.stderr || "macOS wallpaper diagnostic command failed.");
  }

  const macOSVersion = commandSucceeded(version) ? version.stdout.trim() : undefined;
  const macOSMajorVersion = macOSVersion ? Number(macOSVersion.split(".")[0]) : undefined;
  const recommendedStrategy = chooseMacOSWallpaperStrategy({
    platform: process.platform,
    macOSMajorVersion,
    storeCompatible: native.store.compatible,
    storeWritable: native.store.writable,
    legacyCompatible: legacyDatabase.compatible,
    legacyWritable: legacyDatabase.writable,
    legacyTargetRecordCount: legacyDatabase.targetRecordCount
  });

  if (native.store.references.some((reference) => !reference.exists || !reference.readable)) {
    warnings.push("One or more modern wallpaper Store records point to a missing or unreadable file. The next successful all-desktop apply will repair every targeted record to the permanent wallpaper vault.");
  }
  if (recommendedStrategy === "legacy-dock" && legacyDatabase.references.some((reference) => !reference.exists || !reference.readable)) {
    warnings.push("One or more active legacy desktop records point to a missing or unreadable file. Those records can produce black desktops after Dock reloads.");
  }
  if (recommendedStrategy === "observer-only") {
    warnings.push("No compatible writable modern wallpaper Store was detected; only currently visible monitor targets can be changed safely.");
  }
  if ((macOSMajorVersion ?? 0) >= 14 && legacyDatabase.compatible) {
    warnings.push("The legacy Dock wallpaper database was detected but is ignored on macOS 14 and later because it may contain stale historical rows.");
  }
  const invalidDisplayMappings = native.displays.filter((display) => !display.displayUUID || !/^[0-9A-F-]{36}$/i.test(display.displayUUID) || display.spaceUUIDs.length === 0);
  if (invalidDisplayMappings.length) {
    warnings.push(`${invalidDisplayMappings.length} display mapping${invalidDisplayMappings.length === 1 ? " is" : "s are"} incomplete. Current-monitor all-desktop targeting will fall back unless the Store can infer the missing mapping.`);
  }

  const classifiedSpaces = classifyMacOSStoreSpaces(native.store.spaceDisplayUUIDs ?? {});
  const mappedDesktopSpaces = new Set(classifiedSpaces.desktopSpaceUUIDs);
  for (const display of native.displays) {
    for (const spaceUUID of display.spaceUUIDs) {
      const owners = native.store.spaceDisplayUUIDs?.[spaceUUID] ?? [];
      if (owners.length <= 1) mappedDesktopSpaces.add(spaceUUID);
    }
  }
  const activeSpaceUUIDs = native.displays.map((display) => display.currentSpaceUUID).filter((value): value is string => Boolean(value));

  return {
    ok: errors.length === 0,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    macOSVersion,
    macOSBuild: commandSucceeded(build) ? build.stdout.trim() : undefined,
    displaysHaveSeparateSpaces: commandSucceeded(separateSpaces) ? parseBooleanDefaults(separateSpaces.stdout) : undefined,
    activeDisplayId,
    activeSpaceUUIDs,
    displays: native.displays,
    totalSpaceCount: mappedDesktopSpaces.size || Math.max(0, native.store.spaceRecordCount - classifiedSpaces.sharedSpaceUUIDs.length),
    sharedSpaceCount: classifiedSpaces.sharedSpaceUUIDs.length,
    sharedSpaceUUIDs: classifiedSpaces.sharedSpaceUUIDs,
    wallpaperAgentRunning: commandSucceeded(agent),
    dockRunning: commandSucceeded(dock),
    store: native.store,
    legacyDatabase,
    recommendedStrategy,
    warnings,
    errors
  };
}

const macOSModernStoreApplyScript = String.raw`
ObjC.import('Foundation');
ObjC.import('AppKit');
function text(value) { try { return ObjC.unwrap(value); } catch (_) { return String(value || ''); } }
function key(value) { return $(String(value)); }
function get(dict, name) { try { return dict ? dict.objectForKey(key(name)) : null; } catch (_) { return null; } }
function set(dict, name, value) { dict.setObjectForKey(value, key(name)); }
function keys(dict) { try { return dict.allKeys.js.map(text); } catch (_) { return []; } }
function array(value) { try { return value ? value.js : []; } catch (_) { return []; } }
function mutableDict(value) { try { return value ? value.mutableCopy : $.NSMutableDictionary.dictionary; } catch (_) { return $.NSMutableDictionary.dictionary; } }
function mutableArray(value) { try { return value ? value.mutableCopy : $.NSMutableArray.array; } catch (_) { return $.NSMutableArray.array; } }
function validUUID(value) { return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(String(value || '')); }
function readMutablePlist(indexPath) {
  const data = $.NSData.dataWithContentsOfFile(key(indexPath));
  if (!data) throw new Error('Wallpaper settings file could not be read.');
  const format = Ref(); const error = Ref();
  const plist = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, $.NSPropertyListMutableContainersAndLeaves, format, error);
  if (!plist) throw new Error(error[0] ? text(error[0].localizedDescription) : 'Wallpaper settings property list is invalid.');
  return plist;
}
function deepMutableCopy(value) {
  if (!value) return null;
  const error = Ref();
  const data = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(value, $.NSPropertyListBinaryFormat_v1_0, 0, error);
  if (!data) throw new Error(error[0] ? text(error[0].localizedDescription) : 'Wallpaper record could not be copied.');
  const format = Ref(); const decodeError = Ref();
  const copy = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, $.NSPropertyListMutableContainersAndLeaves, format, decodeError);
  if (!copy) throw new Error(decodeError[0] ? text(decodeError[0].localizedDescription) : 'Wallpaper record copy could not be decoded.');
  return copy;
}
function normalizeReference(value) {
  const raw = String(value || '');
  if (!raw) return '';
  try { if (/^file:/i.test(raw)) { const url = $.NSURL.URLWithString(key(raw)); return url ? text(url.path) : raw; } } catch (_) {}
  return raw.startsWith('/') ? raw : '';
}
function desktopReferencesPath(desktop, expectedPath) {
  if (!desktop) return false;
  const expected = text($.NSURL.fileURLWithPath(key(expectedPath)).path);
  const content = get(desktop, 'Content');
  for (const choice of array(get(content, 'Choices'))) {
    for (const file of array(get(choice, 'Files'))) {
      const ref = normalizeReference(text(get(file, 'relative')) || text(get(file, 'url')) || text(get(file, 'path')));
      if (ref === expected) return true;
    }
  }
  return false;
}
function patchDesktopPath(desktopValue, filePath) {
  const desktop = deepMutableCopy(desktopValue);
  if (!desktop) throw new Error('A valid active wallpaper Desktop record was not available.');
  const content = mutableDict(get(desktop, 'Content'));
  const choices = mutableArray(get(content, 'Choices'));
  if (Number(choices.count) < 1) throw new Error('The active wallpaper record has no image choice to clone.');
  const choice = mutableDict(choices.objectAtIndex(0));
  const files = mutableArray(get(choice, 'Files'));
  const file = Number(files.count) > 0 ? mutableDict(files.objectAtIndex(0)) : $.NSMutableDictionary.dictionary;
  set(file, 'relative', key(text($.NSURL.fileURLWithPath(key(filePath)).absoluteString)));
  if (Number(files.count) > 0) files.replaceObjectAtIndexWithObject(0, file); else files.addObject(file);
  set(choice, 'Files', files);
  choices.replaceObjectAtIndexWithObject(0, choice);
  set(content, 'Choices', choices);
  set(desktop, 'Content', content);
  if (get(desktop, 'LastSet')) set(desktop, 'LastSet', $.NSDate.date);
  if (get(desktop, 'LastUse')) set(desktop, 'LastUse', $.NSDate.date);
  return desktop;
}
function patchSectionPath(sectionValue, filePath) {
  const section = deepMutableCopy(sectionValue) || $.NSMutableDictionary.dictionary;
  const desktop = get(section, 'Desktop');
  if (!desktop) throw new Error('A valid active wallpaper section was not available.');
  set(section, 'Desktop', patchDesktopPath(desktop, filePath));
  return section;
}
function setExistingSectionDesktop(container, sectionKey, desktop) {
  const section = mutableDict(get(container, sectionKey));
  set(section, 'Desktop', desktop);
  set(container, sectionKey, section);
}
function validateImage(filePath) {
  const manager = $.NSFileManager.defaultManager;
  if (!manager.fileExistsAtPath(key(filePath)) || !manager.isReadableFileAtPath(key(filePath))) throw new Error('Generated wallpaper is missing or unreadable: ' + filePath);
  const attrs = manager.attributesOfItemAtPathError(key(filePath), null);
  const size = attrs ? Number(text(attrs.objectForKey($.NSFileSize))) : 0;
  if (!size) throw new Error('Generated wallpaper is empty: ' + filePath);
  const image = $.NSImage.alloc.initWithContentsOfFile(key(filePath));
  if (!image || Number(image.size.width) <= 0 || Number(image.size.height) <= 0) throw new Error('Generated wallpaper cannot be decoded by macOS: ' + filePath);
}
function copyReplacing(source, destination) {
  const manager = $.NSFileManager.defaultManager;
  if (manager.fileExistsAtPath(key(destination))) manager.removeItemAtPathError(key(destination), null);
  const error = Ref();
  if (!manager.copyItemAtPathToPathError(key(source), key(destination), error)) throw new Error(error[0] ? text(error[0].localizedDescription) : 'Unable to copy wallpaper settings.');
}
function runTask(command, args) {
  try { const task = $.NSTask.alloc.init; task.launchPath = command; task.arguments = args; task.launch; task.waitUntilExit; return Number(task.terminationStatus); }
  catch (_) { return -1; }
}
function runTaskCapture(command, args) {
  try {
    const task = $.NSTask.alloc.init;
    const stdoutPipe = $.NSPipe.pipe;
    const stderrPipe = $.NSPipe.pipe;
    task.launchPath = command;
    task.arguments = args;
    task.standardOutput = stdoutPipe;
    task.standardError = stderrPipe;
    task.launch;
    task.waitUntilExit;
    const stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile;
    const stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile;
    return {
      status: Number(task.terminationStatus),
      stdout: text($.NSString.alloc.initWithDataEncoding(stdoutData, $.NSUTF8StringEncoding)),
      stderr: text($.NSString.alloc.initWithDataEncoding(stderrData, $.NSUTF8StringEncoding))
    };
  } catch (error) {
    return { status: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
  }
}
function writePlist(plist, indexPath) {
  const tempPath = indexPath + '.pwc-writing-' + text($.NSUUID.UUID.UUIDString);
  const error = Ref();
  const data = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(plist, $.NSPropertyListBinaryFormat_v1_0, 0, error);
  if (!data) throw new Error(error[0] ? text(error[0].localizedDescription) : 'Wallpaper settings could not be serialized.');
  if (!data.writeToFileAtomically(key(tempPath), true)) throw new Error('Wallpaper settings temporary file could not be written.');
  readMutablePlist(tempPath);
  if (runTask('/bin/mv', ['-f', tempPath, indexPath]) !== 0) throw new Error('Wallpaper settings could not be committed atomically.');
  readMutablePlist(indexPath);
}
function ownerDisplayUUIDs(space) { return keys(get(space, 'Displays')).map((value) => value.toUpperCase()).filter(validUUID); }
function findKeyCaseInsensitive(dict, wanted) { return keys(dict).find((candidate) => candidate.toUpperCase() === String(wanted || '').toUpperCase()); }
function sourceCandidates(plist, assignment) {
  const candidates = [];
  function add(section) {
    if (section && get(section, 'Desktop') && !candidates.includes(section)) candidates.push(section);
  }
  const spaces = get(plist, 'Spaces');
  const activeSpace = assignment.currentSpaceUUID ? get(spaces, assignment.currentSpaceUUID) : null;
  if (activeSpace) {
    const activeDisplays = get(activeSpace, 'Displays');
    const activeDisplayKey = findKeyCaseInsensitive(activeDisplays, assignment.displayUUID);
    if (activeDisplayKey) add(get(activeDisplays, activeDisplayKey));
    add(get(activeSpace, 'Default'));
  }
  const displays = get(plist, 'Displays');
  const displayKey = findKeyCaseInsensitive(displays, assignment.displayUUID);
  if (displayKey) add(get(displays, displayKey));
  for (const spaceUUID of keys(spaces)) {
    const space = get(spaces, spaceUUID);
    const spaceDisplays = get(space, 'Displays');
    const candidateKey = findKeyCaseInsensitive(spaceDisplays, assignment.displayUUID);
    if (candidateKey) add(get(spaceDisplays, candidateKey));
  }
  add(get(plist, 'AllSpacesAndDisplays'));
  add(get(plist, 'SystemDefault'));
  return candidates;
}
function findSourceSection(plist, assignment) {
  const candidates = sourceCandidates(plist, assignment);
  return candidates.find((section) => desktopReferencesPath(get(section, 'Desktop'), assignment.filePath)) || candidates[0] || null;
}
function applyVisibleFallbackBaseline(plist, assignments) {
  const sources = {};
  assignments.forEach((assignment) => {
    const source = findSourceSection(plist, assignment);
    if (!source) throw new Error('No wallpaper record was available for visible fallback on display ' + assignment.displayUUID + '.');
    sources[assignment.displayUUID] = source;
  });

  const displays = mutableDict(get(plist, 'Displays'));
  assignments.forEach((assignment) => {
    const displayKey = findKeyCaseInsensitive(displays, assignment.displayUUID) || assignment.displayUUID;
    set(displays, displayKey, patchExistingSection(get(displays, displayKey), sources[assignment.displayUUID], assignment.filePath));
  });
  set(plist, 'Displays', displays);

  const spaces = mutableDict(get(plist, 'Spaces'));
  assignments.forEach((assignment) => {
    if (!validUUID(assignment.currentSpaceUUID)) return;
    const originalSpace = get(spaces, assignment.currentSpaceUUID);
    if (!originalSpace) return;
    const space = mutableDict(originalSpace);
    const owners = ownerDisplayUUIDs(originalSpace);
    const spaceDisplays = mutableDict(get(space, 'Displays'));
    const displayKey = findKeyCaseInsensitive(spaceDisplays, assignment.displayUUID) || assignment.displayUUID;
    set(spaceDisplays, displayKey, patchExistingSection(get(spaceDisplays, displayKey), sources[assignment.displayUUID], assignment.filePath));
    set(space, 'Displays', spaceDisplays);
    if (owners.length === 1 && owners[0] === assignment.displayUUID) {
      set(space, 'Default', patchExistingSection(get(space, 'Default'), sources[assignment.displayUUID], assignment.filePath));
    }
    set(spaces, assignment.currentSpaceUUID, space);
  });
  set(plist, 'Spaces', spaces);
}
function targetInventory(plist, assignments, mode) {
  const spaces = get(plist, 'Spaces');
  const selected = {};
  assignments.forEach((assignment) => { selected[assignment.displayUUID] = true; });
  const userSpaces = [];
  const sharedSpaces = [];
  keys(spaces).forEach((spaceUUID) => {
    const owners = ownerDisplayUUIDs(get(spaces, spaceUUID));
    const selectedOwners = owners.filter((owner) => selected[owner]);
    if (!selectedOwners.length) return;
    if (owners.length > 1) sharedSpaces.push(spaceUUID); else userSpaces.push(spaceUUID);
  });
  if (mode !== 'all-desktops-all-monitors') {
    const requested = {};
    assignments.forEach((assignment) => (assignment.spaceUUIDs || []).forEach((spaceUUID) => { requested[spaceUUID] = true; }));
    return { userSpaces: userSpaces.filter((spaceUUID) => requested[spaceUUID]), sharedSpaces: sharedSpaces.filter((spaceUUID) => requested[spaceUUID]) };
  }
  return { userSpaces, sharedSpaces };
}
function assignmentsForSpace(plist, assignments, spaceUUID) {
  const space = get(get(plist, 'Spaces'), spaceUUID);
  const owners = ownerDisplayUUIDs(space);
  return assignments.filter((assignment) => owners.includes(assignment.displayUUID));
}
function verifyUserSpaces(plist, assignments, userSpaces, sharedSpaces) {
  const spaces = get(plist, 'Spaces');
  let verifiedSpaces = 0;
  let verifiedShared = 0;
  function verify(spaceUUID, shared) {
    const space = get(spaces, spaceUUID);
    const mapped = assignmentsForSpace(plist, assignments, spaceUUID);
    if (!space || !mapped.length) return false;
    const spaceDisplays = get(space, 'Displays');
    const displayMatches = mapped.every((assignment) => {
      const displayKey = findKeyCaseInsensitive(spaceDisplays, assignment.displayUUID);
      return Boolean(displayKey && desktopReferencesPath(get(get(spaceDisplays, displayKey), 'Desktop'), assignment.filePath));
    });
    if (!displayMatches) return false;
    if (!shared) {
      const defaultSection = get(space, 'Default');
      if (!defaultSection || !desktopReferencesPath(get(defaultSection, 'Desktop'), mapped[0].filePath)) return false;
    }
    return true;
  }
  userSpaces.forEach((spaceUUID) => { if (verify(spaceUUID, false)) verifiedSpaces += 1; });
  sharedSpaces.forEach((spaceUUID) => { if (verify(spaceUUID, true)) verifiedShared += 1; });
  return { verifiedSpaces, verifiedShared };
}
function verifyDisplays(plist, assignments) {
  const displays = get(plist, 'Displays');
  return assignments.filter((assignment) => {
    const displayKey = findKeyCaseInsensitive(displays, assignment.displayUUID);
    return Boolean(displayKey && desktopReferencesPath(get(get(displays, displayKey), 'Desktop'), assignment.filePath));
  }).length;
}
function applyCloneApproach(plist, assignments, inventory, sameEverywhere) {
  const sources = {};
  assignments.forEach((assignment) => {
    const source = findSourceSection(plist, assignment);
    if (!source) throw new Error('The active AppKit wallpaper record for display ' + assignment.displayUUID + ' was not found.');
    sources[assignment.displayUUID] = source;
  });
  const displays = mutableDict(get(plist, 'Displays'));
  assignments.forEach((assignment) => {
    const displayKey = findKeyCaseInsensitive(displays, assignment.displayUUID) || assignment.displayUUID;
    set(displays, displayKey, patchSectionPath(sources[assignment.displayUUID], assignment.filePath));
  });
  set(plist, 'Displays', displays);
  const spaces = mutableDict(get(plist, 'Spaces'));
  inventory.userSpaces.concat(inventory.sharedSpaces).forEach((spaceUUID) => {
    const originalSpace = get(spaces, spaceUUID);
    const space = mutableDict(originalSpace);
    const mapped = assignmentsForSpace(plist, assignments, spaceUUID);
    if (!mapped.length) return;
    const spaceDisplays = mutableDict(get(space, 'Displays'));
    mapped.forEach((assignment) => {
      const displayKey = findKeyCaseInsensitive(spaceDisplays, assignment.displayUUID) || assignment.displayUUID;
      set(spaceDisplays, displayKey, patchSectionPath(sources[assignment.displayUUID], assignment.filePath));
    });
    set(space, 'Displays', spaceDisplays);
    if (ownerDisplayUUIDs(originalSpace).length === 1 || sameEverywhere) {
      set(space, 'Default', patchSectionPath(sources[mapped[0].displayUUID], mapped[0].filePath));
    }
    set(spaces, spaceUUID, space);
  });
  set(plist, 'Spaces', spaces);
  if (sameEverywhere) {
    const source = sources[assignments[0].displayUUID];
    set(plist, 'AllSpacesAndDisplays', patchSectionPath(source, assignments[0].filePath));
    set(plist, 'SystemDefault', patchSectionPath(source, assignments[0].filePath));
  }
}
function patchExistingSection(sectionValue, fallbackSource, filePath) {
  if (sectionValue && get(sectionValue, 'Desktop')) {
    const section = deepMutableCopy(sectionValue);
    set(section, 'Desktop', patchDesktopPath(get(section, 'Desktop'), filePath));
    return section;
  }
  return patchSectionPath(fallbackSource, filePath);
}
function applyPathOnlyApproach(plist, assignments, inventory, sameEverywhere) {
  const sources = {};
  assignments.forEach((assignment) => {
    const source = findSourceSection(plist, assignment);
    if (!source) throw new Error('The active wallpaper record for display ' + assignment.displayUUID + ' was not found.');
    sources[assignment.displayUUID] = source;
  });
  const displays = mutableDict(get(plist, 'Displays'));
  assignments.forEach((assignment) => {
    const displayKey = findKeyCaseInsensitive(displays, assignment.displayUUID) || assignment.displayUUID;
    set(displays, displayKey, patchExistingSection(get(displays, displayKey), sources[assignment.displayUUID], assignment.filePath));
  });
  set(plist, 'Displays', displays);
  const spaces = mutableDict(get(plist, 'Spaces'));
  inventory.userSpaces.concat(inventory.sharedSpaces).forEach((spaceUUID) => {
    const originalSpace = get(spaces, spaceUUID);
    const space = mutableDict(originalSpace);
    const mapped = assignmentsForSpace(plist, assignments, spaceUUID);
    if (!mapped.length) return;
    const spaceDisplays = mutableDict(get(space, 'Displays'));
    mapped.forEach((assignment) => {
      const displayKey = findKeyCaseInsensitive(spaceDisplays, assignment.displayUUID) || assignment.displayUUID;
      set(spaceDisplays, displayKey, patchExistingSection(get(spaceDisplays, displayKey), sources[assignment.displayUUID], assignment.filePath));
    });
    set(space, 'Displays', spaceDisplays);
    if (ownerDisplayUUIDs(originalSpace).length === 1 || sameEverywhere) {
      set(space, 'Default', patchExistingSection(get(space, 'Default'), sources[mapped[0].displayUUID], mapped[0].filePath));
    }
    set(spaces, spaceUUID, space);
  });
  set(plist, 'Spaces', spaces);
  if (sameEverywhere) {
    const source = sources[assignments[0].displayUUID];
    set(plist, 'AllSpacesAndDisplays', patchExistingSection(get(plist, 'AllSpacesAndDisplays'), source, assignments[0].filePath));
    set(plist, 'SystemDefault', patchExistingSection(get(plist, 'SystemDefault'), source, assignments[0].filePath));
  }
}
function applyGlobalApproach(plist, assignments) {
  if (assignments.length < 1) throw new Error('No global wallpaper assignment was available.');
  const unique = {};
  assignments.forEach((assignment) => { unique[assignment.filePath] = true; });
  if (Object.keys(unique).length !== 1) throw new Error('Global all-Spaces mode requires one wallpaper shared by every monitor.');
  const source = findSourceSection(plist, assignments[0]);
  if (!source) throw new Error('The active wallpaper record could not be cloned into the global all-Spaces record.');
  const section = patchSectionPath(source, assignments[0].filePath);
  set(section, 'Type', key('individual'));
  set(plist, 'AllSpacesAndDisplays', section);
  set(plist, 'SystemDefault', deepMutableCopy(section));
}
function verifyAppliedApproach(plist, approachId, assignments, inventory, requireMaterializedSpaces) {
  const displayCount = verifyDisplays(plist, assignments);
  const verification = verifyUserSpaces(plist, assignments, inventory.userSpaces, inventory.sharedSpaces);
  if (approachId === 'global-all-spaces') {
    const globalMatches = desktopReferencesPath(get(get(plist, 'AllSpacesAndDisplays'), 'Desktop'), assignments[0].filePath);
    const type = text(get(get(plist, 'AllSpacesAndDisplays'), 'Type'));
    const spacesMaterialized = verification.verifiedSpaces === inventory.userSpaces.length && verification.verifiedShared === inventory.sharedSpaces.length;
    return {
      ok: globalMatches && type === 'individual' && (!requireMaterializedSpaces || spacesMaterialized),
      verifiedSpaces: verification.verifiedSpaces,
      verifiedShared: verification.verifiedShared,
      verifiedDisplays: displayCount
    };
  }
  return {
    ok: verification.verifiedSpaces === inventory.userSpaces.length && verification.verifiedShared === inventory.sharedSpaces.length,
    verifiedSpaces: verification.verifiedSpaces,
    verifiedShared: verification.verifiedShared,
    verifiedDisplays: displayCount
  };
}
function run(argv) {
  const request = JSON.parse(argv[0] || '{}');
  const rawAssignments = Array.isArray(request.assignments) ? request.assignments : [];
  const mode = String(request.mode || 'all-desktops-all-monitors');
  const refreshHelperPath = String(request.refreshHelperPath || '');
  const home = text($.NSHomeDirectory());
  const indexPath = home + '/Library/Application Support/com.apple.wallpaper/Store/Index.plist';
  const backupPath = indexPath + '.pwc-backup';
  const manager = $.NSFileManager.defaultManager;
  const startedAt = Date.now();
  const output = { ok: false, approach: '', attempts: [], indexPath, backupPath, targetDisplayCount: 0, updatedDisplayCount: 0, verifiedDisplayCount: 0, targetSpaceCount: 0, updatedSpaceCount: 0, verifiedSpaceCount: 0, updatedSharedSpaceCount: 0, verifiedSharedSpaceCount: 0, wallpaperAgentReloaded: false, dockReloaded: false, reloadMethod: 'none', directBridgeAttempted: false, directBridgeAvailable: false, directBridgePostedSignals: [], directBridgeFrameworks: [], directBridgeMechanism: '', directBridgeRequestAccepted: false, directBridgeXPCServices: [], directBridgeSelectors: [], observerSuppressedDuringTransaction: true, operationDurationMs: 0, rollbackPerformed: false };
  try {
    const version = $.NSProcessInfo.processInfo.operatingSystemVersion;
    if (Number(version.majorVersion) < 14) throw new Error('Modern wallpaper Store strategy requires macOS 14 or newer.');
    if (!manager.fileExistsAtPath(key(indexPath)) || !manager.isReadableFileAtPath(key(indexPath)) || !manager.isWritableFileAtPath(key(indexPath))) throw new Error('Wallpaper Store is missing, unreadable, or not writable.');
    const assignments = rawAssignments.map((item) => ({
      displayId: String(item.displayId || ''), displayUUID: String(item.displayUUID || '').toUpperCase(), filePath: String(item.filePath || ''),
      currentSpaceUUID: String(item.currentSpaceUUID || ''), spaceUUIDs: Array.isArray(item.spaceUUIDs) ? item.spaceUUIDs.map(String) : []
    })).filter((item) => validUUID(item.displayUUID) && item.filePath);
    if (!assignments.length) throw new Error('No mapped wallpaper assignments were supplied.');
    assignments.forEach((assignment) => validateImage(assignment.filePath));
    const initial = readMutablePlist(indexPath);
    const visibleFallback = deepMutableCopy(initial);
    applyVisibleFallbackBaseline(visibleFallback, assignments);
    writePlist(visibleFallback, backupPath);
    const inventory = targetInventory(initial, assignments, mode);
    if (!inventory.userSpaces.length) throw new Error('No user-visible Mission Control desktops were found for the selected displays.');
    const sameEverywhere = Object.keys(assignments.reduce((acc, assignment) => { acc[assignment.filePath] = true; return acc; }, {})).length === 1;
    output.targetDisplayCount = assignments.length;
    output.targetSpaceCount = inventory.userSpaces.length;
    output.updatedSharedSpaceCount = inventory.sharedSpaces.length;

    const approaches = [
      { id: 'active-record-clone', label: 'Clone macOS-generated active wallpaper records', apply: applyCloneApproach },
      { id: 'path-only-store', label: 'Patch only existing Store file paths', apply: applyPathOnlyApproach }
    ];
    if (sameEverywhere) approaches.push({ id: 'global-all-spaces', label: 'Use the global Show on all Spaces record', apply: function(plist, a) { applyGlobalApproach(plist, a); } });

    for (const approach of approaches) {
      const attempt = { id: approach.id, label: approach.label, ok: false, targetSpaceCount: inventory.userSpaces.length, verifiedSpaceCount: 0, targetDisplayCount: assignments.length, verifiedDisplayCount: 0 };
      try {
        copyReplacing(backupPath, indexPath);
        const plist = readMutablePlist(indexPath);
        approach.apply(plist, assignments, inventory, sameEverywhere);
        writePlist(plist, indexPath);
        const beforeObservation = readMutablePlist(indexPath);
        const initialVerification = verifyAppliedApproach(beforeObservation, approach.id, assignments, inventory, false);
        attempt.verifiedSpaceCount = initialVerification.verifiedSpaces;
        attempt.verifiedDisplayCount = initialVerification.verifiedDisplays;
        if (!initialVerification.ok) throw new Error('The Store write did not verify every targeted desktop before background observation.');

        // First try the no-restart private bridge. If WallpaperAgent does not
        // accept that refresh request, use the selected refresh mode. The
        // immediate path restarts WallpaperAgent only; it never drives Mission
        // Control or switches the user's Spaces.
        let reloadMethod = 'none';
        let bridgeError = '';
        if (refreshHelperPath && manager.isExecutableFileAtPath(key(refreshHelperPath))) {
          output.directBridgeAttempted = true;
          const bridge = runTaskCapture(refreshHelperPath, ['refresh', indexPath]);
          let bridgeResult = null;
          try { bridgeResult = bridge.stdout ? JSON.parse(bridge.stdout) : null; } catch (_) {}
          output.directBridgeAvailable = Boolean(bridgeResult && bridgeResult.privateFrameworksAvailable && (bridgeResult.discoveredProtocols || []).includes('Wallpaper.AgentXPCProtocol'));
          output.directBridgePostedSignals = bridgeResult ? (bridgeResult.distributedNotificationsPosted || []).concat(bridgeResult.darwinNotificationsPosted || []) : [];
          output.directBridgeFrameworks = bridgeResult ? (bridgeResult.frameworksLoaded || []) : [];
          output.directBridgeMechanism = bridgeResult ? (bridgeResult.mechanism || '') : '';
          output.directBridgeRequestAccepted = Boolean(bridgeResult && bridgeResult.requestAccepted);
          output.directBridgeXPCServices = bridgeResult ? (bridgeResult.xpcServices || []) : [];
          output.directBridgeSelectors = bridgeResult ? (bridgeResult.discoveredSelectors || []) : [];
          if (bridge.status === 0 && bridgeResult && bridgeResult.ok && bridgeResult.requestAccepted) {
            reloadMethod = 'native-wallpaper-agent-xpc';
            $.NSThread.sleepForTimeInterval(1.6);
          } else {
            bridgeError = (bridgeResult && bridgeResult.error) || bridge.stderr || 'The direct private wallpaper bridge could not get WallpaperAgent to accept a native refresh request.';
          }
        } else {
          bridgeError = 'Direct private wallpaper bridge is unavailable on this build.';
        }
        if (reloadMethod === 'none') {
          attempt.ok = true;
          attempt.verifiedSpaceCount = initialVerification.verifiedSpaces;
          attempt.verifiedDisplayCount = initialVerification.verifiedDisplays;
          output.ok = false;
          output.approach = approach.id;
          output.reloadMethod = 'none';
          output.wallpaperAgentReloaded = false;
          output.updatedDisplayCount = assignments.length;
          output.verifiedDisplayCount = initialVerification.verifiedDisplays;
          output.updatedSpaceCount = inventory.userSpaces.length;
          output.verifiedSpaceCount = initialVerification.verifiedSpaces;
          output.verifiedSharedSpaceCount = initialVerification.verifiedShared;
          output.operationDurationMs = Date.now() - startedAt;
          output.error = (bridgeError ? bridgeError + ' ' : '') + 'All desktop Store records were staged. A separate native System Events desktop request must confirm that WallpaperAgent adopted them.';
          output.attempts.push(attempt);
          return JSON.stringify(output);
        }
        const settledVerification = verifyAppliedApproach(readMutablePlist(indexPath), approach.id, assignments, inventory, true);
        if (!settledVerification.ok) {
          const refreshName = reloadMethod === 'native-wallpaper-agent-xpc' ? 'the native WallpaperAgent bridge' : 'restarting WallpaperAgent';
          throw new Error('macOS did not adopt the inactive desktop records after ' + refreshName + '.');
        }

        attempt.ok = true;
        attempt.verifiedSpaceCount = settledVerification.verifiedSpaces;
        attempt.verifiedDisplayCount = settledVerification.verifiedDisplays;
        output.ok = true;
        output.approach = approach.id;
        output.reloadMethod = reloadMethod;
        output.wallpaperAgentReloaded = reloadMethod === 'wallpaperagent-restart';
        output.updatedDisplayCount = assignments.length;
        output.verifiedDisplayCount = settledVerification.verifiedDisplays;
        output.updatedSpaceCount = inventory.userSpaces.length;
        output.verifiedSpaceCount = settledVerification.verifiedSpaces;
        output.verifiedSharedSpaceCount = settledVerification.verifiedShared;
        output.operationDurationMs = Date.now() - startedAt;
        output.attempts.push(attempt);
        return JSON.stringify(output);
      } catch (error) {
        attempt.error = error instanceof Error ? error.message : String(error);
        output.attempts.push(attempt);
      }
    }
    copyReplacing(backupPath, indexPath);
    const fallbackVerification = verifyAppliedApproach(readMutablePlist(indexPath), 'path-only-store', assignments, inventory, false);
    output.updatedDisplayCount = fallbackVerification.verifiedDisplays;
    output.verifiedDisplayCount = fallbackVerification.verifiedDisplays;
    output.updatedSpaceCount = fallbackVerification.verifiedSpaces;
    output.verifiedSpaceCount = fallbackVerification.verifiedSpaces;
    output.verifiedSharedSpaceCount = fallbackVerification.verifiedShared;
    output.rollbackPerformed = true;
    output.operationDurationMs = Date.now() - startedAt;
    output.error = output.attempts.map((attempt) => attempt.label + ': ' + (attempt.error || 'failed')).join(' | ');
    return JSON.stringify(output);
  } catch (error) {
    output.error = error instanceof Error ? error.message : String(error);
    try { if (manager.fileExistsAtPath(key(backupPath))) { copyReplacing(backupPath, indexPath); output.rollbackPerformed = true; } } catch (_) {}
    output.operationDurationMs = Date.now() - startedAt;
    return JSON.stringify(output);
  }
}`;

interface ModernStoreApplyResult {
  ok: boolean;
  approach?: "active-record-clone" | "path-only-store" | "global-all-spaces";
  attempts?: Array<{
    id: "active-record-clone" | "path-only-store" | "global-all-spaces";
    label: string;
    ok: boolean;
    targetSpaceCount?: number;
    verifiedSpaceCount?: number;
    targetDisplayCount?: number;
    verifiedDisplayCount?: number;
    error?: string;
  }>;
  indexPath?: string;
  backupPath?: string;
  targetDisplayCount: number;
  updatedDisplayCount: number;
  verifiedDisplayCount: number;
  targetSpaceCount: number;
  updatedSpaceCount: number;
  verifiedSpaceCount: number;
  updatedSharedSpaceCount: number;
  verifiedSharedSpaceCount: number;
  wallpaperAgentReloaded: boolean;
  dockReloaded?: boolean;
  reloadMethod?: "none" | "native-wallpaper-agent-xpc" | "system-events-desktop-api" | "wallpaperagent-restart";
  directBridgeAttempted?: boolean;
  directBridgeAvailable?: boolean;
  directBridgePostedSignals?: string[];
  directBridgeFrameworks?: string[];
  directBridgeMechanism?: string;
  directBridgeRequestAccepted?: boolean;
  directBridgeXPCServices?: string[];
  directBridgeSelectors?: string[];
  systemEventsAttempted?: boolean;
  systemEventsAccepted?: boolean;
  stableStoreVerificationPassed?: boolean;
  observerSuppressedDuringTransaction?: boolean;
  operationDurationMs?: number;
  rollbackPerformed: boolean;
  error?: string;
}

async function resolvePrivateWallpaperBridgePath() {
  if (process.platform !== "darwin") return "";
  const packagedFromResources = process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar.unpacked", "dist", "main", "helpers", "pwc-wallpaper-bridge")
    : "";
  const packagedFromDirname = /app\.asar[\\/]/.test(__dirname)
    ? path.join(__dirname.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked"), "helpers", "pwc-wallpaper-bridge")
    : "";
  const developmentPath = path.join(__dirname, "helpers", "pwc-wallpaper-bridge");
  const candidates = /app\.asar[\\/]/.test(__dirname)
    ? [packagedFromDirname, packagedFromResources, developmentPath]
    : [developmentPath, packagedFromResources, packagedFromDirname];
  for (const candidate of [...new Set(candidates)]) {
    if (!candidate) continue;
    if (/app\.asar[\\/]/.test(candidate)) continue;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next packaged/development location.
    }
  }
  return "";
}

async function applyModernWallpaperStore(
  assignments: MacOSSpaceAssignment[],
  mode: Extract<WallpaperTargetMode, "all-desktops-current-monitor" | "all-desktops-all-monitors">,
  displayMode: WallpaperDisplayMode | undefined,
  diagnostic: MacOSWallpaperDiagnosticReport,
  refreshMode: WallpaperAllSpacesRefreshMode | undefined
) {
  const displayById = new Map(diagnostic.displays.map((display) => [display.displayId, display]));
  const mappedAssignments = assignments.map((assignment) => {
    const display = displayById.get(assignment.displayId);
    return {
      ...assignment,
      displayUUID: display?.displayUUID,
      currentSpaceUUID: display?.currentSpaceUUID,
      spaceUUIDs: display?.spaceUUIDs ?? []
    };
  });
  const command = await runNativeCommand(
    "macos-modern-wallpaper-store-transaction",
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", macOSModernStoreApplyScript, JSON.stringify({ assignments: mappedAssignments, mode, style: displayStyle(displayMode), refreshMode: "system-events", refreshHelperPath: "" })],
    75_000
  );
  let result: ModernStoreApplyResult | undefined;
  if (commandSucceeded(command)) {
    try { result = JSON.parse(command.stdout.trim()) as ModernStoreApplyResult; } catch { result = undefined; }
  }
  return { command, result };
}


function appleScriptString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function normalizedPath(value: string | undefined) {
  if (!value) return "";
  return path.resolve(value);
}

async function applyWithSystemEventsDesktopAPI(
  assignments: MacOSSpaceAssignment[],
  diagnostic: MacOSWallpaperDiagnosticReport
) {
  const displayIndexById = new Map(diagnostic.displays.map((display, index) => [display.displayId, index + 1]));
  const lines = assignments.flatMap((assignment) => {
    const desktopIndex = displayIndexById.get(assignment.displayId);
    if (!desktopIndex) return [];
    return [`set picture of desktop ${desktopIndex} to POSIX file ${appleScriptString(assignment.filePath)}`];
  });
  if (!lines.length) return fallbackCommand("No System Events desktop objects matched the selected physical displays.");
  const script = [
    'tell application "System Events"',
    ...lines.map((line) => `  ${line}`),
    'end tell',
    'return "PWC_SYSTEM_EVENTS_OK"'
  ].join("\n");
  return runNativeCommand(
    "macos-system-events-desktop-api",
    "/usr/bin/osascript",
    ["-e", script],
    20_000
  );
}

interface StableStoreVerification {
  ok: boolean;
  targetSpaceCount: number;
  verifiedSpaceCount: number;
  targetDisplayCount: number;
  verifiedDisplayCount: number;
  targetSharedSpaceCount: number;
  verifiedSharedSpaceCount: number;
  reports: MacOSWallpaperDiagnosticReport[];
}

function verifyAssignmentsInDiagnostic(
  diagnostic: MacOSWallpaperDiagnosticReport,
  assignments: MacOSSpaceAssignment[]
) {
  const selected = new Map(assignments.map((assignment) => [assignment.displayId, normalizedPath(assignment.filePath)]));
  const shared = new Set(diagnostic.sharedSpaceUUIDs);
  let targetSpaceCount = 0;
  let verifiedSpaceCount = 0;
  let targetSharedSpaceCount = 0;
  let verifiedSharedSpaceCount = 0;
  let targetDisplayCount = 0;
  let verifiedDisplayCount = 0;

  for (const display of diagnostic.displays) {
    const expectedPath = selected.get(display.displayId);
    if (!expectedPath || !display.displayUUID) continue;
    const displayUUID = display.displayUUID.toUpperCase();
    targetDisplayCount += 1;
    const displayPath = diagnostic.store.displayPaths?.[displayUUID];
    if (normalizedPath(displayPath) === expectedPath) verifiedDisplayCount += 1;

    for (const spaceUUID of display.spaceUUIDs) {
      const actualPath = diagnostic.store.spaceDisplayPaths?.[spaceUUID]?.[displayUUID];
      if (shared.has(spaceUUID)) {
        targetSharedSpaceCount += 1;
        if (normalizedPath(actualPath) === expectedPath) verifiedSharedSpaceCount += 1;
      } else {
        targetSpaceCount += 1;
        if (normalizedPath(actualPath) === expectedPath) verifiedSpaceCount += 1;
      }
    }
  }

  return {
    ok: targetSpaceCount > 0
      && verifiedSpaceCount === targetSpaceCount
      && verifiedDisplayCount === targetDisplayCount
      && verifiedSharedSpaceCount === targetSharedSpaceCount,
    targetSpaceCount,
    verifiedSpaceCount,
    targetDisplayCount,
    verifiedDisplayCount,
    targetSharedSpaceCount,
    verifiedSharedSpaceCount
  };
}

async function verifyModernStoreRemainsStable(
  assignments: MacOSSpaceAssignment[],
  activeDisplayId?: string
): Promise<StableStoreVerification> {
  const reports: MacOSWallpaperDiagnosticReport[] = [];
  await new Promise((resolve) => setTimeout(resolve, 1_400));
  reports.push(await diagnoseMacOSWallpaperEnvironment(activeDisplayId));
  await new Promise((resolve) => setTimeout(resolve, 2_800));
  reports.push(await diagnoseMacOSWallpaperEnvironment(activeDisplayId));
  const checks = reports.map((report) => verifyAssignmentsInDiagnostic(report, assignments));
  const last = checks.at(-1) ?? {
    ok: false,
    targetSpaceCount: 0,
    verifiedSpaceCount: 0,
    targetDisplayCount: 0,
    verifiedDisplayCount: 0,
    targetSharedSpaceCount: 0,
    verifiedSharedSpaceCount: 0
  };
  return {
    ...last,
    ok: checks.length === 2 && checks.every((check) => check.ok),
    reports
  };
}

async function restoreVisibleFallbackStore(backupPath?: string, indexPath?: string) {
  if (!backupPath || !indexPath) return fallbackCommand("The visible-only wallpaper Store fallback path was unavailable.");
  return runNativeCommand(
    "macos-modern-wallpaper-store-visible-fallback",
    "/bin/cp",
    ["-f", backupPath, indexPath],
    10_000
  );
}

function fallbackCommand(message: string): NativeCommandResult {
  return { method: "macos-all-spaces-controller", command: "", args: [], stdout: "", stderr: message, exitCode: 1, timedOut: false, error: message };
}

export interface NativeGlobalAllSpacesEligibility {
  ok: boolean;
  sameWallpaperEverywhere: boolean;
  reason?: string;
}

export function nativeGlobalAllSpacesEligibility(
  assignments: MacOSSpaceAssignment[],
  mode: Extract<WallpaperTargetMode, "all-desktops-current-monitor" | "all-desktops-all-monitors">,
  connectedDisplayCount: number
): NativeGlobalAllSpacesEligibility {
  const normalized = assignments.map((assignment) => normalizedPath(assignment.filePath)).filter(Boolean);
  const sameWallpaperEverywhere = normalized.length > 0 && new Set(normalized).size === 1;
  if (!assignments.length) return { ok: false, sameWallpaperEverywhere: false, reason: "No visible display assignment was available." };
  if (!sameWallpaperEverywhere) {
    return {
      ok: false,
      sameWallpaperEverywhere,
      reason: "macOS Show on all Spaces supports one shared wallpaper across every desktop and display; the current batch contains different images."
    };
  }
  if (mode === "all-desktops-current-monitor" && connectedDisplayCount > 1) {
    return {
      ok: false,
      sameWallpaperEverywhere,
      reason: "macOS Show on all Spaces also affects every connected display, so it cannot safely target only one monitor while multiple monitors are connected."
    };
  }
  return { ok: true, sameWallpaperEverywhere };
}

const macOSNativeGlobalAllSpacesSettingScript = String.raw`
ObjC.import('Foundation');
// PWC_NATIVE_GLOBAL_ALL_SPACES_V1
function sleep(seconds) { $.NSThread.sleepForTimeInterval(seconds); }
function safe(fn, fallback) { try { var value = fn(); return value === undefined || value === null ? fallback : value; } catch (_) { return fallback; } }
function text(value) { try { return String(ObjC.unwrap(value)); } catch (_) { return value === undefined || value === null ? '' : String(value); } }
function lower(value) { return text(value).toLowerCase(); }
function attr(element, name) {
  return safe(function() { return element.attributes.byName(name).value(); }, null);
}
function role(element) { return text(attr(element, 'AXRole')) || safe(function() { return text(element.role()); }, ''); }
function label(element) {
  return [attr(element, 'AXTitle'), attr(element, 'AXDescription'), attr(element, 'AXHelp'), attr(element, 'AXIdentifier'), safe(function() { return element.name(); }, '')]
    .map(text).filter(Boolean).join(' | ');
}
function children(element) { return safe(function() { return element.uiElements(); }, []); }
function actions(element) {
  return safe(function() { return element.actions().map(function(action) { return text(action.name()); }); }, []);
}
function position(element) {
  var value = attr(element, 'AXPosition');
  try { return [Number(value[0]), Number(value[1])]; } catch (_) { return null; }
}
function size(element) {
  var value = attr(element, 'AXSize');
  try { return [Number(value[0]), Number(value[1])]; } catch (_) { return null; }
}
function enabledValue(element) {
  var value = attr(element, 'AXValue');
  if (value === true || value === 1 || text(value) === '1') return true;
  if (value === false || value === 0 || text(value) === '0') return false;
  var normalized = lower(value);
  if (normalized === 'on' || normalized === 'selected' || normalized === 'true') return true;
  if (normalized === 'off' || normalized === 'unselected' || normalized === 'false') return false;
  return null;
}
function collect(roots, maxNodes) {
  var queue = roots.slice();
  var output = [];
  while (queue.length && output.length < maxNodes) {
    var current = queue.shift();
    output.push(current);
    var nested = children(current);
    for (var index = 0; index < nested.length && output.length + queue.length < maxNodes; index += 1) queue.push(nested[index]);
  }
  return output;
}
function isTargetText(value) {
  var normalized = lower(value).replace(/\s+/g, ' ').trim();
  return normalized.indexOf('show on all spaces') >= 0 || normalized.indexOf('all spaces') >= 0 && normalized.indexOf('show') >= 0;
}
function press(element) {
  try { element.actions.byName('AXPress').perform(); return true; } catch (_) {}
  try { element.actions['AXPress'].perform(); return true; } catch (_) {}
  try {
    var available = element.actions();
    for (var index = 0; index < available.length; index += 1) {
      if (text(available[index].name()) === 'AXPress') { available[index].perform(); return true; }
    }
  } catch (_) {}
  try { element.click(); return true; } catch (_) {}
  return false;
}
function findToggle(process) {
  var roots = safe(function() { return process.windows(); }, []);
  var nodes = collect(roots, 4500);
  var direct = [];
  var labels = [];
  nodes.forEach(function(node) {
    var nodeLabel = label(node);
    if (isTargetText(nodeLabel)) labels.push(node);
    var nodeRole = role(node);
    var canPress = actions(node).indexOf('AXPress') >= 0 || nodeRole === 'AXCheckBox' || nodeRole === 'AXSwitch' || nodeRole === 'AXButton';
    if (canPress && isTargetText(nodeLabel)) direct.push(node);
  });
  if (direct.length) {
    direct.sort(function(a, b) {
      var ar = role(a), br = role(b);
      var as = ar === 'AXCheckBox' || ar === 'AXSwitch' ? 0 : 1;
      var bs = br === 'AXCheckBox' || br === 'AXSwitch' ? 0 : 1;
      return as - bs;
    });
    return { element: direct[0], nodes: nodes, match: label(direct[0]) };
  }
  var pressable = nodes.filter(function(node) {
    var nodeRole = role(node);
    return actions(node).indexOf('AXPress') >= 0 || nodeRole === 'AXCheckBox' || nodeRole === 'AXSwitch' || nodeRole === 'AXButton';
  });
  var best = null;
  labels.forEach(function(textNode) {
    var tp = position(textNode), ts = size(textNode);
    if (!tp || !ts) return;
    var tx = tp[0] + ts[0] / 2, ty = tp[1] + ts[1] / 2;
    pressable.forEach(function(control) {
      var cp = position(control), cs = size(control);
      if (!cp || !cs) return;
      var cx = cp[0] + cs[0] / 2, cy = cp[1] + cs[1] / 2;
      var dx = cx - tx, dy = cy - ty;
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 320) return;
      var controlRole = role(control);
      var rolePenalty = controlRole === 'AXCheckBox' || controlRole === 'AXSwitch' ? 0 : 80;
      var score = distance + rolePenalty;
      if (!best || score < best.score) best = { element: control, score: score, match: label(textNode) + ' -> ' + label(control) };
    });
  });
  return best ? { element: best.element, nodes: nodes, match: best.match } : { element: null, nodes: nodes, match: '' };
}
function locateProcess(systemEvents) {
  var process = systemEvents.applicationProcesses.byName('System Settings');
  return safe(function() { return process.exists(); }, false) ? process : null;
}
function run(argv) {
  var request = JSON.parse(argv[0] || '{}');
  var output = { ok: false, enabled: false, rearmed: false, openedUI: false, permissionDenied: false, activatedFallback: false, controlLabel: '', beforeValue: null, afterValue: null, error: '' };
  var current = Application.currentApplication();
  current.includeStandardAdditions = true;
  var settings = Application('System Settings');
  var systemEvents = Application('System Events');
  var wasRunning = safe(function() { return settings.running(); }, false);
  try {
    current.doShellScript("/usr/bin/open -gj 'x-apple.systempreferences:com.apple.Wallpaper-Settings.extension'");
    output.openedUI = true;
    var process = null;
    var found = null;
    for (var attempt = 0; attempt < 30; attempt += 1) {
      sleep(0.2);
      process = locateProcess(systemEvents);
      if (!process) continue;
      found = findToggle(process);
      if (found.element) break;
    }
    if (!found || !found.element) {
      safe(function() { settings.activate(); }, null);
      output.activatedFallback = true;
      for (var retry = 0; retry < 25; retry += 1) {
        sleep(0.2);
        process = locateProcess(systemEvents);
        if (!process) continue;
        found = findToggle(process);
        if (found.element) break;
      }
    }
    if (!found || !found.element) throw new Error('Could not locate the Show on all Spaces control in System Settings. Accessibility permission may be required, or this macOS build may use a different Wallpaper pane layout.');
    output.controlLabel = found.match;
    output.beforeValue = enabledValue(found.element);
    if (output.beforeValue === true) {
      if (!press(found.element)) throw new Error('The Show on all Spaces control was found but could not be switched off for re-arming.');
      sleep(0.3);
      found = findToggle(process);
      if (!found.element || !press(found.element)) throw new Error('The Show on all Spaces control could not be switched back on.');
      output.rearmed = true;
    } else {
      if (!press(found.element)) throw new Error('The Show on all Spaces control was found but could not be enabled.');
    }
    for (var verify = 0; verify < 25; verify += 1) {
      sleep(0.2);
      found = findToggle(process);
      if (found.element && enabledValue(found.element) === true) break;
    }
    output.afterValue = found && found.element ? enabledValue(found.element) : null;
    output.enabled = output.afterValue === true;
    output.ok = output.enabled;
    if (!output.ok) output.error = 'System Settings did not confirm that Show on all Spaces remained enabled.';
    if (!wasRunning && process) safe(function() { process.visible = false; }, null);
  } catch (error) {
    output.error = error instanceof Error ? error.message : String(error);
    var normalized = lower(output.error);
    output.permissionDenied = normalized.indexOf('not authorized') >= 0 || normalized.indexOf('assistive access') >= 0 || normalized.indexOf('accessibility') >= 0;
  }
  return JSON.stringify(output);
}`;

interface NativeGlobalAllSpacesSettingResult {
  ok: boolean;
  enabled: boolean;
  rearmed: boolean;
  openedUI: boolean;
  permissionDenied: boolean;
  activatedFallback?: boolean;
  controlLabel?: string;
  beforeValue?: boolean | null;
  afterValue?: boolean | null;
  error?: string;
}

async function applyNativeGlobalAllSpacesSetting() {
  const command = await runNativeCommand(
    "macos-native-show-on-all-spaces",
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", macOSNativeGlobalAllSpacesSettingScript, JSON.stringify({ action: "enable-and-rearm" })],
    25_000
  );
  let result: NativeGlobalAllSpacesSettingResult | undefined;
  if (commandSucceeded(command)) {
    try { result = JSON.parse(command.stdout.trim()) as NativeGlobalAllSpacesSettingResult; } catch { result = undefined; }
  }
  return { command, result };
}

function targetSpaceInventory(
  diagnostic: MacOSWallpaperDiagnosticReport,
  assignments: MacOSSpaceAssignment[]
) {
  const selected = new Set(assignments.map((assignment) => assignment.displayId));
  const shared = new Set(diagnostic.sharedSpaceUUIDs);
  const userSpaces = new Set<string>();
  const sharedSpaces = new Set<string>();
  for (const display of diagnostic.displays) {
    if (!selected.has(display.displayId)) continue;
    for (const spaceUUID of display.spaceUUIDs) {
      if (shared.has(spaceUUID)) sharedSpaces.add(spaceUUID);
      else userSpaces.add(spaceUUID);
    }
  }
  return { userSpaces, sharedSpaces };
}

function globalWallpaperReferenceMatches(
  diagnostic: MacOSWallpaperDiagnosticReport,
  expectedPath: string
) {
  const expected = normalizedPath(expectedPath);
  return diagnostic.store.references.some((reference) =>
    reference.source.startsWith("AllSpacesAndDisplays.Desktop")
    && normalizedPath(reference.path) === expected
  );
}

export async function applyMacOSWallpapersAcrossSpaces(
  assignments: MacOSSpaceAssignment[],
  mode: Extract<WallpaperTargetMode, "all-desktops-current-monitor" | "all-desktops-all-monitors">,
  _displayMode?: WallpaperDisplayMode,
  activeDisplayId?: string,
  _refreshMode?: WallpaperAllSpacesRefreshMode
): Promise<MacOSSpacesApplyResult> {
  const startedAt = Date.now();
  const diagnostic = await diagnoseMacOSWallpaperEnvironment(activeDisplayId);
  const commands: NativeCommandResult[] = [];
  const inventory = targetSpaceInventory(diagnostic, assignments);
  const eligibility = nativeGlobalAllSpacesEligibility(assignments, mode, diagnostic.displays.length);
  const status: MacOSSpacesApplySummary = {
    ok: false,
    attempted: true,
    mode,
    strategy: diagnostic.recommendedStrategy,
    attempts: [],
    targetDisplayCount: assignments.length,
    updatedDisplayCount: assignments.length,
    verifiedDisplayCount: assignments.length,
    targetSpaceCount: inventory.userSpaces.size,
    updatedSpaceCount: 0,
    verifiedSpaceCount: 0,
    updatedSharedSpaceCount: inventory.sharedSpaces.size,
    verifiedSharedSpaceCount: 0,
    modernStoreWritten: false,
    modernStoreVerified: false,
    legacyDatabaseWritten: false,
    legacyDatabaseVerified: false,
    wallpaperAgentReloaded: false,
    dockReloaded: false,
    reloadMethod: "none",
    visibleApplyPassCount: 0,
    observerSuppressedDuringTransaction: true,
    operationDurationMs: 0,
    observerStarted: false,
    observerFallback: false,
    rollbackPerformed: false,
    backupPaths: [],
    stableAssetSlotsAttempted: false,
    stableAssetSlotsVerified: false,
    stableAssetSlotCount: 0,
    stableAssetSlotPaths: [],
    nativeGlobalSettingAttempted: false,
    nativeGlobalSettingEnabled: false,
    nativeGlobalSettingRearmed: false,
    nativeGlobalSettingOpenedUI: false,
    nativeGlobalSettingPermissionDenied: false,
    diagnostic
  };

  if (!eligibility.ok) {
    status.fallbackToVisibleMonitors = true;
    status.reloadMethod = "visible-monitors-fallback";
    status.error = eligibility.reason;
    status.warning = `${eligibility.reason} Only the already verified visible monitor targets were kept.`;
    status.operationDurationMs = Date.now() - startedAt;
    status.attempts.push({
      id: "native-global-all-spaces",
      label: "Use macOS Show on all Spaces through the native Wallpaper settings pane",
      ok: false,
      targetSpaceCount: inventory.userSpaces.size,
      verifiedSpaceCount: 0,
      targetDisplayCount: assignments.length,
      verifiedDisplayCount: assignments.length,
      error: eligibility.reason
    });
    const command = fallbackCommand(status.warning);
    return { command, commands: [command], summary: status };
  }

  if (diagnostic.recommendedStrategy !== "modern-store") {
    status.fallbackToVisibleMonitors = true;
    status.reloadMethod = "visible-monitors-fallback";
    status.error = diagnostic.errors[0] || diagnostic.warnings[0] || "The macOS wallpaper Store could not be inspected to verify the global setting.";
    status.warning = `${status.error} Only the already verified visible monitor targets were kept.`;
    status.operationDurationMs = Date.now() - startedAt;
    const command = fallbackCommand(status.warning);
    return { command, commands: [command], summary: status };
  }

  status.nativeGlobalSettingAttempted = true;
  status.systemEventsAttempted = true;
  const nativeGlobal = await applyNativeGlobalAllSpacesSetting();
  commands.push(nativeGlobal.command);
  status.systemEventsAccepted = Boolean(nativeGlobal.result?.ok);
  status.nativeGlobalSettingEnabled = Boolean(nativeGlobal.result?.enabled);
  status.nativeGlobalSettingRearmed = Boolean(nativeGlobal.result?.rearmed);
  status.nativeGlobalSettingOpenedUI = Boolean(nativeGlobal.result?.openedUI);
  status.nativeGlobalSettingPermissionDenied = Boolean(nativeGlobal.result?.permissionDenied);
  status.nativeGlobalSettingControlLabel = nativeGlobal.result?.controlLabel;

  let settledDiagnostic = diagnostic;
  if (nativeGlobal.result?.ok) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    settledDiagnostic = await diagnoseMacOSWallpaperEnvironment(activeDisplayId);
  }
  const expectedPath = assignments[0].filePath;
  const globalReferenceVerified = Boolean(nativeGlobal.result?.ok && globalWallpaperReferenceMatches(settledDiagnostic, expectedPath));
  status.modernStoreVerified = globalReferenceVerified;
  status.ok = Boolean(nativeGlobal.result?.ok && globalReferenceVerified);
  status.updatedSpaceCount = status.ok ? inventory.userSpaces.size : 0;
  status.verifiedSpaceCount = status.ok ? inventory.userSpaces.size : 0;
  status.verifiedSharedSpaceCount = status.ok ? inventory.sharedSpaces.size : 0;
  status.reloadMethod = status.ok ? "native-global-setting" : "visible-monitors-fallback";
  status.fallbackToVisibleMonitors = !status.ok;
  status.operationDurationMs = Date.now() - startedAt;
  status.diagnostic = settledDiagnostic;
  const failure = nativeGlobal.result?.error
    || nativeGlobal.command.error
    || nativeGlobal.command.stderr
    || (nativeGlobal.result?.ok && !globalReferenceVerified
      ? "System Settings enabled Show on all Spaces, but the global wallpaper record did not settle on the newly generated image."
      : "The native Show on all Spaces setting was not confirmed.");
  status.attempts.push({
    id: "native-global-all-spaces",
    label: "Use macOS Show on all Spaces through the native Wallpaper settings pane",
    ok: status.ok,
    targetSpaceCount: inventory.userSpaces.size,
    verifiedSpaceCount: status.verifiedSpaceCount,
    targetDisplayCount: assignments.length,
    verifiedDisplayCount: assignments.length,
    error: status.ok ? undefined : failure
  });

  if (status.ok) {
    status.warning = [
      `macOS confirmed its native Show on all Spaces setting and the global wallpaper record for ${inventory.userSpaces.size} desktop${inventory.userSpaces.size === 1 ? "" : "s"}.`,
      nativeGlobal.result?.rearmed ? "The setting was safely re-armed to force a native global adoption transaction." : "The setting was enabled to force a native global adoption transaction.",
      "No wallpaper files or Store records were edited directly, and no Dock or WallpaperAgent process was restarted."
    ].join(" ");
  } else {
    status.error = failure;
    status.warning = `${failure} Only the already verified visible monitor targets remain changed.`;
  }

  const command = commands.at(-1) ?? fallbackCommand(status.warning || "Native global wallpaper setting was unavailable.");
  return { command, commands: commands.length ? commands : [command], summary: status };
}

export async function getMacOSReferencedWallpaperPaths(activeDisplayId?: string) {
  if (process.platform !== "darwin") return [] as string[];
  const diagnostic = await diagnoseMacOSWallpaperEnvironment(activeDisplayId);
  const references = diagnostic.store.references;
  return [...new Set(references.filter((reference) => reference.exists && reference.readable).map((reference) => reference.path))];
}

const macOSActiveSpaceObserverScript = String.raw`
ObjC.import('AppKit');
ObjC.import('Foundation');
// PWC_SPACE_OBSERVER_V3
function unwrap(value) { try { return ObjC.unwrap(value); } catch (_) { return String(value || ''); } }
function displayNumber(screen, fallback) {
  try { return String(unwrap(screen.deviceDescription.objectForKey('NSScreenNumber'))); }
  catch (_) { return String(fallback); }
}
function normalizePath(value) {
  const raw = String(value || '');
  if (!raw) return '';
  try {
    if (/^file:/i.test(raw)) {
      const url = $.NSURL.URLWithString($(raw));
      return url ? String(unwrap(url.path)) : raw;
    }
  } catch (_) {}
  return raw;
}
function optionsForStyle(style) {
  const options = $.NSMutableDictionary.dictionary;
  if (style === 'stretch') {
    options.setObjectForKey($.NSImageScaleAxesIndependently, $.NSWorkspaceDesktopImageScalingKey);
    options.setObjectForKey(true, $.NSWorkspaceDesktopImageAllowClippingKey);
  } else if (style === 'center') {
    options.setObjectForKey($.NSImageScaleNone, $.NSWorkspaceDesktopImageScalingKey);
    options.setObjectForKey(false, $.NSWorkspaceDesktopImageAllowClippingKey);
  } else {
    options.setObjectForKey($.NSImageScaleProportionallyUpOrDown, $.NSWorkspaceDesktopImageScalingKey);
    options.setObjectForKey(style !== 'fit', $.NSWorkspaceDesktopImageAllowClippingKey);
  }
  return options;
}
function run(argv) {
  const request = JSON.parse(argv[0] || '{}');
  const assignments = Array.isArray(request.assignments) ? request.assignments : [];
  const byDisplay = {};
  assignments.forEach((item) => { byDisplay[String(item.displayId || '')] = String(item.filePath || ''); });
  const fallbackPath = assignments.length === 1 ? String(assignments[0].filePath || '') : '';
  const workspace = $.NSWorkspace.sharedWorkspace;
  let lastRepairAt = 0;

  const repairIfNeeded = () => {
    const now = Date.now();
    if (now - lastRepairAt < 450) return;
    lastRepairAt = now;
    // Wait until the Space animation has settled. This process is isolated from
    // Dock and Mission Control, so the delay cannot cancel the user's gesture.
    $.NSThread.sleepForTimeInterval(0.65);
    $.NSScreen.screens.js.forEach((screen, index) => {
      const displayId = displayNumber(screen, index + 1);
      const filePath = byDisplay[displayId] || (request.mode === 'all-desktops-all-monitors' ? fallbackPath : '');
      if (!filePath) return;
      let currentPath = '';
      try { currentPath = normalizePath(unwrap(workspace.desktopImageURLForScreen(screen).path)); } catch (_) {}
      const expectedPath = normalizePath(filePath);
      if (currentPath === expectedPath) return;
      const error = Ref();
      workspace.setDesktopImageURLForScreenOptionsError($.NSURL.fileURLWithPath($(filePath)), screen, optionsForStyle(String(request.style || 'fill')), error);
    });
  };

  // No initial apply. The foreground transaction already performed exactly one
  // visible-screen pass. This observer is maintenance/fallback only.
  const block = ObjC.block('void', ['id'], function(_) { repairIfNeeded(); });
  globalThis.__pwcSpaceObserverBlock = block;
  globalThis.__pwcSpaceObserverToken = workspace.notificationCenter.addObserverForNameObjectQueueUsingBlock(
    $.NSWorkspaceActiveSpaceDidChangeNotification, null, $.NSOperationQueue.mainQueue, block
  );
  globalThis.__pwcWakeObserverToken = workspace.notificationCenter.addObserverForNameObjectQueueUsingBlock(
    $.NSWorkspaceDidWakeNotification, null, $.NSOperationQueue.mainQueue, block
  );
  $.NSRunLoop.currentRunLoop.run;
}`

export class MacOSActiveSpaceWallpaperObserver {
  private child: ChildProcessWithoutNullStreams | undefined;

  start(
    assignments: MacOSSpaceAssignment[],
    mode: Extract<WallpaperTargetMode, "all-desktops-current-monitor" | "all-desktops-all-monitors">,
    displayMode?: WallpaperDisplayMode
  ) {
    this.stop();
    if (process.platform !== "darwin" || assignments.length === 0) return false;
    const payload = JSON.stringify({ assignments, mode, style: displayStyle(displayMode) });
    const child = spawn(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", macOSActiveSpaceObserverScript, payload],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    this.child = child;
    child.stdin.end();
    child.stdout.resume();
    child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) console.warn("macOS active-Space wallpaper observer:", message);
    });
    child.once("exit", () => {
      if (this.child === child) this.child = undefined;
    });
    return true;
  }

  stop() {
    const child = this.child;
    this.child = undefined;
    if (!child || child.killed) return;
    child.kill("SIGTERM");
  }

  isRunning() {
    return Boolean(this.child && !this.child.killed);
  }
}
