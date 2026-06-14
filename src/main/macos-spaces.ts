import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, copyFile, rm } from "node:fs/promises";
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
  storeCompatible: boolean;
  storeWritable: boolean;
  legacyCompatible: boolean;
  legacyWritable: boolean;
  legacyTargetRecordCount: number;
}): MacOSWallpaperStrategy {
  if (input.platform !== "darwin") return "unsupported";
  const modern = input.storeCompatible && input.storeWritable;
  const legacy = input.legacyCompatible && input.legacyWritable && input.legacyTargetRecordCount > 0;
  if (modern && legacy) return "modern-store+legacy-dock";
  if (modern) return "modern-store";
  if (legacy) return "legacy-dock";
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
function uuidForDisplayId(displayId) {
  try {
    const uuid = $.CGDisplayCreateUUIDFromDisplayID(Number(displayId));
    return uuid ? String(text($.CFUUIDCreateString(null, uuid))).toUpperCase() : '';
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
  function addDesktop(desktop, source) {
    if (!desktop) return;
    desktopRecordCount += 1;
    referencesFromDesktop(desktop, source).forEach((item) => refs.push(item));
  }
  ['AllSpacesAndDisplays', 'SystemDefault'].forEach((sectionName) => {
    const section = get(plist, sectionName);
    addDesktop(get(section, 'Desktop'), sectionName + '.Desktop');
  });
  const displays = get(plist, 'Displays');
  keys(displays).forEach((displayKey) => addDesktop(get(get(displays, displayKey), 'Desktop'), 'Displays.' + displayKey + '.Desktop'));
  const spaces = get(plist, 'Spaces');
  keys(spaces).forEach((spaceKey) => {
    const space = get(spaces, spaceKey);
    addDesktop(get(get(space, 'Default'), 'Desktop'), 'Spaces.' + spaceKey + '.Default.Desktop');
    const spaceDisplays = get(space, 'Displays');
    keys(spaceDisplays).forEach((displayKey) => addDesktop(get(get(spaceDisplays, displayKey), 'Desktop'), 'Spaces.' + spaceKey + '.Displays.' + displayKey + '.Desktop'));
  });
  const unique = {};
  refs.forEach((ref) => {
    const token = ref.source + '|' + ref.path;
    if (unique[token]) return;
    unique[token] = true;
    ref.exists = Boolean(manager.fileExistsAtPath(key(ref.path)));
    ref.readable = Boolean(manager.isReadableFileAtPath(key(ref.path)));
  });
  return { references: refs.filter((ref) => unique[ref.source + '|' + ref.path]), desktopRecordCount };
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
      displayUUID: uuidForDisplayId(displayId),
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
    schema: 'missing', compatible: false, topLevelKeys: [], displayRecordCount: 0, spaceRecordCount: 0, desktopRecordCount: 0, references: []
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
      store.references = collected.references;
      store.compatible = store.topLevelKeys.includes('Spaces') && (store.topLevelKeys.includes('AllSpacesAndDisplays') || store.topLevelKeys.includes('SystemDefault') || store.topLevelKeys.includes('Displays'));
      store.schema = store.compatible ? 'modern-index-v1' : 'unknown';
    } catch (error) {
      store.schema = 'corrupt';
      store.error = error instanceof Error ? error.message : String(error);
    }
  }
  return JSON.stringify({ displays, tree, store });
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

  if (native.store.references.some((reference) => !reference.exists || !reference.readable)) {
    warnings.push("One or more wallpaper Store records point to a missing or unreadable file. Those records can produce black desktops.");
  }
  if (legacyDatabase.references.some((reference) => !reference.exists || !reference.readable)) {
    warnings.push("One or more legacy desktop records point to a missing or unreadable file. Those records can produce black desktops after Dock reloads.");
  }
  if (!native.store.compatible && !legacyDatabase.compatible) {
    warnings.push("No compatible immediate all-Space wallpaper store was detected; observer fallback is the only safe strategy.");
  }

  const recommendedStrategy = chooseMacOSWallpaperStrategy({
    platform: process.platform,
    storeCompatible: native.store.compatible,
    storeWritable: native.store.writable,
    legacyCompatible: legacyDatabase.compatible,
    legacyWritable: legacyDatabase.writable,
    legacyTargetRecordCount: legacyDatabase.targetRecordCount
  });
  const allSpaces = new Set(native.displays.flatMap((display) => display.spaceUUIDs).filter(Boolean));
  const activeSpaceUUIDs = native.displays.map((display) => display.currentSpaceUUID).filter((value): value is string => Boolean(value));

  return {
    ok: errors.length === 0,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    macOSVersion: commandSucceeded(version) ? version.stdout.trim() : undefined,
    macOSBuild: commandSucceeded(build) ? build.stdout.trim() : undefined,
    displaysHaveSeparateSpaces: commandSucceeded(separateSpaces) ? parseBooleanDefaults(separateSpaces.stdout) : undefined,
    activeDisplayId,
    activeSpaceUUIDs,
    displays: native.displays,
    totalSpaceCount: allSpaces.size || native.store.spaceRecordCount,
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
ObjC.import('CoreGraphics');
try {
  ObjC.bindFunction('CGSMainConnectionID', ['uint32', []]);
  ObjC.bindFunction('CGSCopyManagedDisplaySpaces', ['id', ['uint32']]);
} catch (_) {}
function text(value) { try { return ObjC.unwrap(value); } catch (_) { return String(value || ''); } }
function key(value) { return $(String(value)); }
function get(dict, name) { try { return dict ? dict.objectForKey(key(name)) : null; } catch (_) { return null; } }
function set(dict, name, value) { dict.setObjectForKey(value, key(name)); }
function keys(dict) { try { return dict.allKeys.js.map(text); } catch (_) { return []; } }
function array(value) { try { return value ? value.js : []; } catch (_) { return []; } }
function mutableDict(value) { try { return value ? value.mutableCopy : $.NSMutableDictionary.dictionary; } catch (_) { return $.NSMutableDictionary.dictionary; } }
function mutableArray(value) { try { return value ? value.mutableCopy : $.NSMutableArray.array; } catch (_) { return $.NSMutableArray.array; } }
function propertyListData(value) {
  const error = Ref();
  const data = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError($(value), $.NSPropertyListBinaryFormat_v1_0, 0, error);
  if (!data) throw new Error(error[0] ? text(error[0].localizedDescription) : 'Unable to encode wallpaper property list data.');
  return data;
}
function readMutablePlist(indexPath) {
  const data = $.NSData.dataWithContentsOfFile(key(indexPath));
  if (!data) throw new Error('Wallpaper settings file could not be read.');
  const format = Ref();
  const error = Ref();
  const plist = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, $.NSPropertyListMutableContainersAndLeaves, format, error);
  if (!plist) throw new Error(error[0] ? text(error[0].localizedDescription) : 'Wallpaper settings property list is invalid.');
  return plist;
}
function displayNumber(screen, fallback) {
  try { return String(text(screen.deviceDescription.objectForKey('NSScreenNumber'))); }
  catch (_) { return String(fallback); }
}
function uuidForDisplayId(displayId) {
  try {
    const uuid = $.CGDisplayCreateUUIDFromDisplayID(Number(displayId));
    return uuid ? String(text($.CFUUIDCreateString(null, uuid))).toUpperCase() : '';
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
      return { displayUUID: displayUUID.toUpperCase(), spaces: spaces.map((space) => String(space.uuid || space.UUID || '')).filter(Boolean) };
    }).filter((entry) => entry.displayUUID);
  } catch (_) { return []; }
}
function configurationData(filePath) {
  const url = text($.NSURL.fileURLWithPath(key(filePath)).absoluteString);
  return propertyListData({ type: 'imageFile', url: { relative: url } });
}
function optionsData(style) {
  return propertyListData({ values: { style: { picker: { _0: { id: style || 'fill' } } } } });
}
function findDesktopTemplate(plist, displayKeys, spaceKeys) {
  const all = get(get(plist, 'AllSpacesAndDisplays'), 'Desktop'); if (all) return all;
  const system = get(get(plist, 'SystemDefault'), 'Desktop'); if (system) return system;
  const displays = get(plist, 'Displays');
  for (const displayKey of displayKeys) { const desktop = get(get(displays, displayKey), 'Desktop'); if (desktop) return desktop; }
  const spaces = get(plist, 'Spaces');
  for (const spaceKey of spaceKeys) {
    const space = get(spaces, spaceKey);
    const defaultDesktop = get(get(space, 'Default'), 'Desktop'); if (defaultDesktop) return defaultDesktop;
    const spaceDisplays = get(space, 'Displays');
    for (const displayKey of keys(spaceDisplays)) { const desktop = get(get(spaceDisplays, displayKey), 'Desktop'); if (desktop) return desktop; }
  }
  return $.NSMutableDictionary.dictionary;
}
function patchedDesktop(template, filePath, style) {
  const desktop = mutableDict(template);
  const content = mutableDict(get(desktop, 'Content'));
  const existingChoices = mutableArray(get(content, 'Choices'));
  const first = existingChoices.count > 0 ? mutableDict(existingChoices.objectAtIndex(0)) : $.NSMutableDictionary.dictionary;
  set(first, 'Configuration', configurationData(filePath));
  const fileEntry = $.NSMutableDictionary.dictionary;
  set(fileEntry, 'relative', key(text($.NSURL.fileURLWithPath(key(filePath)).absoluteString)));
  const files = $.NSMutableArray.array; files.addObject(fileEntry);
  set(first, 'Files', files);
  set(first, 'Provider', key('com.apple.wallpaper.choice.image'));
  const choices = $.NSMutableArray.array; choices.addObject(first);
  for (let i = 1; i < Number(existingChoices.count); i += 1) choices.addObject(existingChoices.objectAtIndex(i));
  set(content, 'Choices', choices);
  set(content, 'EncodedOptionValues', optionsData(style));
  set(desktop, 'Content', content);
  set(desktop, 'LastSet', $.NSDate.date);
  set(desktop, 'LastUse', $.NSDate.date);
  return desktop;
}
function setSectionDesktop(container, sectionKey, desktop) {
  const section = mutableDict(get(container, sectionKey));
  set(section, 'Type', key('individual'));
  set(section, 'Desktop', desktop);
  set(container, sectionKey, section);
}
function normalizeReference(value) {
  const raw = String(value || '');
  if (!raw) return '';
  try { if (/^file:/i.test(raw)) { const url = $.NSURL.URLWithString(key(raw)); return url ? text(url.path) : raw; } } catch (_) {}
  return raw.startsWith('/') ? raw : '';
}
function desktopReferencesPath(desktop, expectedPath) {
  const expected = text($.NSURL.fileURLWithPath(key(expectedPath)).path);
  const content = get(desktop, 'Content');
  for (const choice of array(get(content, 'Choices'))) {
    for (const file of array(get(choice, 'Files'))) {
      const ref = normalizeReference(text(get(file, 'relative')) || text(get(file, 'url')) || text(get(file, 'path')));
      if (ref === expected) return true;
    }
    const data = get(choice, 'Configuration');
    if (data) {
      try {
        const format = Ref(); const error = Ref();
        const decoded = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, $.NSPropertyListMutableContainersAndLeaves, format, error);
        const url = get(decoded, 'url');
        const ref = normalizeReference(text(get(url, 'relative')) || text(get(decoded, 'relative')) || text(get(decoded, 'path')));
        if (ref === expected) return true;
      } catch (_) {}
    }
  }
  return false;
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
  if (!manager.copyItemAtPathToPathError(key(source), key(destination), error)) throw new Error(error[0] ? text(error[0].localizedDescription) : 'Unable to create wallpaper Store backup.');
}
function runTask(command, args) {
  try {
    const task = $.NSTask.alloc.init; task.launchPath = command; task.arguments = args; task.launch; task.waitUntilExit;
    return Number(task.terminationStatus);
  } catch (_) { return -1; }
}
function atomicCommit(plist, indexPath, backupPath) {
  const manager = $.NSFileManager.defaultManager;
  const tempPath = indexPath + '.pwc-writing-' + text($.NSUUID.UUID.UUIDString);
  const error = Ref();
  const data = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(plist, $.NSPropertyListBinaryFormat_v1_0, 0, error);
  if (!data) throw new Error(error[0] ? text(error[0].localizedDescription) : 'Wallpaper settings could not be serialized.');
  if (!data.writeToFileAtomically(key(tempPath), true)) throw new Error('Wallpaper settings temporary file could not be written.');
  readMutablePlist(tempPath);
  copyReplacing(indexPath, backupPath);
  const status = runTask('/bin/mv', ['-f', tempPath, indexPath]);
  if (status !== 0) {
    copyReplacing(backupPath, indexPath);
    throw new Error('Wallpaper settings could not be committed atomically.');
  }
  readMutablePlist(indexPath);
}
function run(argv) {
  const request = JSON.parse(argv[0] || '{}');
  const assignments = Array.isArray(request.assignments) ? request.assignments : [];
  const mode = String(request.mode || 'all-desktops-all-monitors');
  const style = String(request.style || 'fill');
  const home = text($.NSHomeDirectory());
  const indexPath = home + '/Library/Application Support/com.apple.wallpaper/Store/Index.plist';
  const backupPath = indexPath + '.pwc-backup';
  const manager = $.NSFileManager.defaultManager;
  const result = { ok: false, indexPath, backupPath, targetDisplayCount: 0, updatedDisplayCount: 0, verifiedDisplayCount: 0, targetSpaceCount: 0, updatedSpaceCount: 0, verifiedSpaceCount: 0, wallpaperAgentReloaded: false, rollbackPerformed: false };
  try {
    const version = $.NSProcessInfo.processInfo.operatingSystemVersion;
    if (Number(version.majorVersion) < 14) throw new Error('Modern wallpaper Store strategy requires macOS 14 or newer.');
    if (!manager.fileExistsAtPath(key(indexPath)) || !manager.isReadableFileAtPath(key(indexPath)) || !manager.isWritableFileAtPath(key(indexPath))) throw new Error('Wallpaper Store is missing, unreadable, or not writable.');
    if (!assignments.length) throw new Error('No wallpaper assignments were supplied.');
    assignments.forEach((assignment) => validateImage(String(assignment.filePath || '')));

    const screens = $.NSScreen.screens.js;
    const screenUUIDById = {};
    screens.forEach((screen, index) => { const id = displayNumber(screen, index + 1); screenUUIDById[id] = uuidForDisplayId(id); });
    const mainScreen = $.NSScreen.mainScreen;
    const mainId = mainScreen ? displayNumber(mainScreen, 1) : '';
    const mainUUID = screenUUIDById[mainId] || uuidForDisplayId(mainId);
    const tree = managedDisplaySpaces(mainUUID);
    const normalized = assignments.map((item) => ({
      displayId: String(item.displayId || ''),
      displayUUID: String(screenUUIDById[String(item.displayId || '')] || '').toUpperCase(),
      filePath: String(item.filePath || '')
    })).filter((item) => item.displayUUID && item.filePath);
    if (!normalized.length) throw new Error('Connected displays could not be mapped to wallpaper display UUIDs.');
    result.targetDisplayCount = normalized.length;

    const plist = readMutablePlist(indexPath);
    const topKeys = keys(plist);
    if (!topKeys.includes('Spaces') || !(topKeys.includes('AllSpacesAndDisplays') || topKeys.includes('SystemDefault') || topKeys.includes('Displays'))) throw new Error('Unsupported wallpaper Store schema.');
    const displays = mutableDict(get(plist, 'Displays'));
    const spaces = mutableDict(get(plist, 'Spaces'));
    const storeSpaceKeys = keys(spaces).filter(Boolean);
    const uniqueFiles = Array.from(new Set(normalized.map((item) => item.filePath)));
    const sameEverywhere = mode === 'all-desktops-all-monitors' && uniqueFiles.length === 1;
    const allDisplayKeys = Array.from(new Set(normalized.flatMap((item) => [item.displayUUID, item.displayId]).filter(Boolean)));
    const managedSpaceKeys = Array.from(new Set(tree.flatMap((entry) => entry.spaces).filter(Boolean)));
    const targetSpaceKeys = mode === 'all-desktops-all-monitors'
      ? Array.from(new Set(storeSpaceKeys.concat(managedSpaceKeys)))
      : Array.from(new Set(normalized.flatMap((assignment) => {
          const monitor = tree.find((entry) => entry.displayUUID === assignment.displayUUID);
          return monitor ? monitor.spaces : [];
        })));
    if (!targetSpaceKeys.length) throw new Error('No active Mission Control Space inventory was found for the selected monitor target.');
    result.targetSpaceCount = targetSpaceKeys.length;

    const template = findDesktopTemplate(plist, allDisplayKeys, targetSpaceKeys);
    const assignmentByUUID = {}; normalized.forEach((item) => { assignmentByUUID[item.displayUUID] = item; });
    function assignmentForSpace(spaceUUID) {
      const monitor = tree.find((entry) => entry.spaces.includes(spaceUUID));
      return (monitor && assignmentByUUID[monitor.displayUUID]) || (sameEverywhere ? normalized[0] : null);
    }

    normalized.forEach((assignment) => {
      const desktop = patchedDesktop(template, assignment.filePath, style);
      const existingKey = keys(displays).find((candidate) => candidate.toUpperCase() === assignment.displayUUID || candidate === assignment.displayId) || assignment.displayUUID;
      setSectionDesktop(displays, existingKey, desktop);
      result.updatedDisplayCount += 1;
    });

    targetSpaceKeys.forEach((spaceUUID) => {
      const assignment = assignmentForSpace(spaceUUID);
      if (!assignment) return;
      const desktop = patchedDesktop(template, assignment.filePath, style);
      const space = mutableDict(get(spaces, spaceUUID));
      setSectionDesktop(space, 'Default', desktop);
      const spaceDisplays = mutableDict(get(space, 'Displays'));
      const existingKey = keys(spaceDisplays).find((candidate) => candidate.toUpperCase() === assignment.displayUUID || candidate === assignment.displayId) || assignment.displayUUID;
      setSectionDesktop(spaceDisplays, existingKey, desktop);
      set(space, 'Displays', spaceDisplays);
      set(spaces, spaceUUID, space);
      result.updatedSpaceCount += 1;
    });

    if (sameEverywhere) {
      const globalDesktop = patchedDesktop(template, normalized[0].filePath, style);
      setSectionDesktop(plist, 'AllSpacesAndDisplays', globalDesktop);
      setSectionDesktop(plist, 'SystemDefault', globalDesktop);
    }
    set(plist, 'Displays', displays);
    set(plist, 'Spaces', spaces);
    atomicCommit(plist, indexPath, backupPath);

    const verified = readMutablePlist(indexPath);
    const verifiedDisplays = get(verified, 'Displays');
    normalized.forEach((assignment) => {
      const existingKey = keys(verifiedDisplays).find((candidate) => candidate.toUpperCase() === assignment.displayUUID || candidate === assignment.displayId) || assignment.displayUUID;
      if (desktopReferencesPath(get(get(verifiedDisplays, existingKey), 'Desktop'), assignment.filePath)) result.verifiedDisplayCount += 1;
    });
    const verifiedSpaces = get(verified, 'Spaces');
    targetSpaceKeys.forEach((spaceUUID) => {
      const assignment = assignmentForSpace(spaceUUID);
      if (!assignment) return;
      const space = get(verifiedSpaces, spaceUUID);
      const defaultMatches = desktopReferencesPath(get(get(space, 'Default'), 'Desktop'), assignment.filePath);
      const spaceDisplays = get(space, 'Displays');
      const existingKey = keys(spaceDisplays).find((candidate) => candidate.toUpperCase() === assignment.displayUUID || candidate === assignment.displayId) || assignment.displayUUID;
      const displayMatches = desktopReferencesPath(get(get(spaceDisplays, existingKey), 'Desktop'), assignment.filePath);
      if (defaultMatches || displayMatches) result.verifiedSpaceCount += 1;
    });
    if (result.verifiedDisplayCount !== result.targetDisplayCount || result.verifiedSpaceCount !== result.targetSpaceCount) {
      copyReplacing(backupPath, indexPath);
      result.rollbackPerformed = true;
      throw new Error('Wallpaper Store verification did not match every requested display and Space; the original Store was restored.');
    }

    runTask('/usr/bin/killall', ['WallpaperAgent']);
    $.NSThread.sleepForTimeInterval(0.25);
    const byDisplay = {}; normalized.forEach((item) => { byDisplay[item.displayId] = item.filePath; });
    const workspace = $.NSWorkspace.sharedWorkspace;
    $.NSScreen.screens.js.forEach((screen, index) => {
      const displayId = displayNumber(screen, index + 1);
      const filePath = byDisplay[displayId];
      if (!filePath) return;
      const applyError = Ref();
      workspace.setDesktopImageURLForScreenOptionsError($.NSURL.fileURLWithPath(key(filePath)), screen, $({}), applyError);
    });
    $.NSThread.sleepForTimeInterval(0.55);
    result.wallpaperAgentReloaded = runTask('/usr/bin/pgrep', ['-x', 'WallpaperAgent']) === 0;
    if (!result.wallpaperAgentReloaded) {
      copyReplacing(backupPath, indexPath);
      result.rollbackPerformed = true;
      throw new Error('WallpaperAgent did not recover after the Store refresh; the original Store was restored.');
    }
    result.ok = true;
    return JSON.stringify(result);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return JSON.stringify(result);
  }
}`;

interface ModernStoreApplyResult {
  ok: boolean;
  indexPath?: string;
  backupPath?: string;
  targetDisplayCount: number;
  updatedDisplayCount: number;
  verifiedDisplayCount: number;
  targetSpaceCount: number;
  updatedSpaceCount: number;
  verifiedSpaceCount: number;
  wallpaperAgentReloaded: boolean;
  rollbackPerformed: boolean;
  error?: string;
}

async function applyModernWallpaperStore(
  assignments: MacOSSpaceAssignment[],
  mode: Extract<WallpaperTargetMode, "all-desktops-current-monitor" | "all-desktops-all-monitors">,
  displayMode: WallpaperDisplayMode | undefined
) {
  const command = await runNativeCommand(
    "macos-modern-wallpaper-store-transaction",
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", macOSModernStoreApplyScript, JSON.stringify({ assignments, mode, style: displayStyle(displayMode) })],
    30_000
  );
  let result: ModernStoreApplyResult | undefined;
  if (commandSucceeded(command)) {
    try { result = JSON.parse(command.stdout.trim()) as ModernStoreApplyResult; } catch { result = undefined; }
  }
  return { command, result };
}

function escapeSql(value: string) {
  return value.replace(/'/g, "''");
}

interface LegacyRow {
  pictureId: number;
  spaceId?: string;
  displayId?: string;
  currentPath?: string;
}

async function readLegacyRows(databasePath: string) {
  const command = await runNativeCommand(
    "macos-legacy-wallpaper-rows",
    "/usr/bin/sqlite3",
    ["-separator", "\t", databasePath, [
      "select p.ROWID, coalesce(s.space_uuid,''), coalesce(di.display_uuid,''), coalesce(d.value,'')",
      "from pictures p",
      "left join spaces s on s.ROWID = p.space_id",
      "left join displays di on di.ROWID = p.display_id",
      "left join preferences pr on pr.picture_id = p.ROWID and pr.key = 1",
      "left join data d on d.ROWID = pr.data_id",
      "where coalesce(s.space_uuid,'') <> '' or coalesce(di.display_uuid,'') <> ''",
      "order by p.ROWID;"
    ].join(" ")],
    8_000
  );
  if (!commandSucceeded(command)) return { command, rows: [] as LegacyRow[] };
  const rows = command.stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [rawId, spaceId = "", displayId = "", currentPath = ""] = line.split("\t");
    const pictureId = Number(rawId);
    return Number.isFinite(pictureId) ? [{ pictureId, spaceId: spaceId || undefined, displayId: displayId || undefined, currentPath: currentPath || undefined }] : [];
  });
  return { command, rows };
}

function legacyAssignmentsSql(assignments: Array<{ pictureId: number; filePath: string }>) {
  const statements = ["begin immediate;"];
  for (const assignment of assignments) {
    const filePath = escapeSql(assignment.filePath);
    statements.push(
      `insert or ignore into data(value) values ('${filePath}');`,
      `update preferences set data_id = (select ROWID from data where value = '${filePath}' order by ROWID desc limit 1) where picture_id = ${assignment.pictureId} and key = 1;`,
      `insert into preferences(picture_id,key,data_id) select ${assignment.pictureId}, 1, (select ROWID from data where value = '${filePath}' order by ROWID desc limit 1) where not exists (select 1 from preferences where picture_id = ${assignment.pictureId} and key = 1);`
    );
  }
  statements.push("commit;");
  return statements.join("\n");
}

interface LegacyApplyResult {
  ok: boolean;
  backupPath?: string;
  targetSpaceCount: number;
  updatedSpaceCount: number;
  verifiedSpaceCount: number;
  dockReloaded: boolean;
  rollbackPerformed: boolean;
  error?: string;
}

async function restoreLegacyDatabase(databasePath: string, backupPath: string) {
  await rm(`${databasePath}-wal`, { force: true }).catch(() => undefined);
  await rm(`${databasePath}-shm`, { force: true }).catch(() => undefined);
  await copyFile(backupPath, databasePath);
}

async function applyLegacyWallpaperDatabase(
  assignments: MacOSSpaceAssignment[],
  mode: Extract<WallpaperTargetMode, "all-desktops-current-monitor" | "all-desktops-all-monitors">,
  diagnostic: MacOSWallpaperDiagnosticReport
): Promise<{ commands: NativeCommandResult[]; result: LegacyApplyResult }> {
  const commands: NativeCommandResult[] = [];
  const databasePath = diagnostic.legacyDatabase.path;
  const backupPath = `${databasePath}.pwc-backup`;
  const output: LegacyApplyResult = {
    ok: false,
    backupPath,
    targetSpaceCount: 0,
    updatedSpaceCount: 0,
    verifiedSpaceCount: 0,
    dockReloaded: false,
    rollbackPerformed: false
  };
  const rowsResult = await readLegacyRows(databasePath);
  commands.push(rowsResult.command);
  if (!commandSucceeded(rowsResult.command) || !rowsResult.rows.length) {
    output.error = rowsResult.command.error || rowsResult.command.stderr || "No compatible legacy desktop rows were found.";
    return { commands, result: output };
  }

  const displayUUIDById = new Map(diagnostic.displays.map((display) => [display.displayId, display.displayUUID?.toUpperCase()]));
  const assignmentByDisplay = new Map(assignments.map((assignment) => [assignment.displayId, assignment]));
  const firstAssignment = assignments[0];
  const selectedRows = rowsResult.rows.flatMap((row) => {
    if (mode === "all-desktops-all-monitors") {
      if (assignments.length === 1) return [{ row, assignment: firstAssignment }];
      const assignment = assignments.find((candidate) => {
        const uuid = displayUUIDById.get(candidate.displayId);
        return row.displayId?.toUpperCase() === uuid || row.displayId === candidate.displayId;
      });
      return assignment ? [{ row, assignment }] : [];
    }
    const assignment = assignments.find((candidate) => {
      const uuid = displayUUIDById.get(candidate.displayId);
      return row.displayId?.toUpperCase() === uuid || row.displayId === candidate.displayId;
    });
    return assignment ? [{ row, assignment }] : [];
  });
  const uniqueRows = new Map(selectedRows.map((entry) => [entry.row.pictureId, entry]));
  const updates = [...uniqueRows.values()].map(({ row, assignment }) => ({ pictureId: row.pictureId, filePath: assignment.filePath }));
  output.targetSpaceCount = updates.length;
  if (!updates.length) {
    output.error = "The selected display could not be mapped to any legacy desktop rows.";
    return { commands, result: output };
  }

  const backup = await runNativeCommand("macos-legacy-wallpaper-backup", "/usr/bin/sqlite3", [databasePath, `.backup '${escapeSql(backupPath)}'`], 8_000);
  commands.push(backup);
  if (!commandSucceeded(backup)) {
    output.error = backup.error || backup.stderr || "The legacy wallpaper database could not be backed up.";
    return { commands, result: output };
  }

  const apply = await runNativeCommand("macos-legacy-wallpaper-transaction", "/usr/bin/sqlite3", [databasePath, legacyAssignmentsSql(updates)], 10_000);
  commands.push(apply);
  if (!commandSucceeded(apply)) {
    await restoreLegacyDatabase(databasePath, backupPath).catch(() => undefined);
    output.rollbackPerformed = true;
    output.error = apply.error || apply.stderr || "The legacy wallpaper transaction failed.";
    return { commands, result: output };
  }
  output.updatedSpaceCount = updates.length;

  const ids = updates.map((item) => item.pictureId).join(",");
  const verify = await runNativeCommand(
    "macos-legacy-wallpaper-verify",
    "/usr/bin/sqlite3",
    ["-separator", "\t", databasePath, [
      "select p.ROWID, coalesce(d.value,'') from pictures p",
      "left join preferences pr on pr.picture_id = p.ROWID and pr.key = 1",
      "left join data d on d.ROWID = pr.data_id",
      `where p.ROWID in (${ids}) order by p.ROWID;`
    ].join(" ")],
    8_000
  );
  commands.push(verify);
  if (commandSucceeded(verify)) {
    const expected = new Map(updates.map((item) => [item.pictureId, path.resolve(item.filePath)]));
    output.verifiedSpaceCount = verify.stdout.split(/\r?\n/).filter(Boolean).filter((line) => {
      const [rawId, filePath = ""] = line.split("\t");
      return expected.get(Number(rawId)) === path.resolve(filePath);
    }).length;
  }
  if (output.verifiedSpaceCount !== output.targetSpaceCount) {
    await restoreLegacyDatabase(databasePath, backupPath).catch(() => undefined);
    output.rollbackPerformed = true;
    output.error = "Legacy wallpaper verification did not match every requested desktop row; the database was restored.";
    return { commands, result: output };
  }

  const refresh = await runNativeCommand("macos-legacy-wallpaper-dock-reload", "/usr/bin/killall", ["Dock"], 5_000);
  commands.push(refresh);
  await new Promise((resolve) => setTimeout(resolve, 900));
  const dock = await runNativeCommand("macos-legacy-wallpaper-dock-status", "/usr/bin/pgrep", ["-x", "Dock"], 3_000);
  commands.push(dock);
  output.dockReloaded = commandSucceeded(dock);
  if (!output.dockReloaded) {
    await restoreLegacyDatabase(databasePath, backupPath).catch(() => undefined);
    output.rollbackPerformed = true;
    output.error = "Dock did not recover after the wallpaper refresh; the legacy database was restored.";
    return { commands, result: output };
  }
  output.ok = true;
  return { commands, result: output };
}

function fallbackCommand(message: string): NativeCommandResult {
  return { method: "macos-all-spaces-controller", command: "", args: [], stdout: "", stderr: message, exitCode: 1, timedOut: false, error: message };
}

export async function applyMacOSWallpapersAcrossSpaces(
  assignments: MacOSSpaceAssignment[],
  mode: Extract<WallpaperTargetMode, "all-desktops-current-monitor" | "all-desktops-all-monitors">,
  displayMode?: WallpaperDisplayMode,
  activeDisplayId?: string
): Promise<MacOSSpacesApplyResult> {
  const diagnostic = await diagnoseMacOSWallpaperEnvironment(activeDisplayId);
  const commands: NativeCommandResult[] = [];
  const status: MacOSSpacesApplySummary = {
    ok: false,
    attempted: true,
    mode,
    strategy: diagnostic.recommendedStrategy,
    targetDisplayCount: assignments.length,
    updatedDisplayCount: 0,
    verifiedDisplayCount: 0,
    targetSpaceCount: 0,
    updatedSpaceCount: 0,
    verifiedSpaceCount: 0,
    modernStoreWritten: false,
    modernStoreVerified: false,
    legacyDatabaseWritten: false,
    legacyDatabaseVerified: false,
    wallpaperAgentReloaded: false,
    dockReloaded: false,
    observerStarted: false,
    observerFallback: false,
    rollbackPerformed: false,
    backupPaths: [],
    diagnostic
  };

  let modernOk = false;
  let legacyOk = false;
  if (diagnostic.recommendedStrategy === "modern-store" || diagnostic.recommendedStrategy === "modern-store+legacy-dock") {
    const modern = await applyModernWallpaperStore(assignments, mode, displayMode);
    commands.push(modern.command);
    if (modern.result) {
      modernOk = modern.result.ok;
      status.targetDisplayCount = Math.max(status.targetDisplayCount, modern.result.targetDisplayCount);
      status.updatedDisplayCount = modern.result.updatedDisplayCount;
      status.verifiedDisplayCount = modern.result.verifiedDisplayCount;
      status.targetSpaceCount = modern.result.targetSpaceCount;
      status.updatedSpaceCount = modern.result.updatedSpaceCount;
      status.verifiedSpaceCount = modern.result.verifiedSpaceCount;
      status.modernStoreWritten = modern.result.updatedSpaceCount > 0;
      status.modernStoreVerified = modern.result.ok;
      status.wallpaperAgentReloaded = modern.result.wallpaperAgentReloaded;
      status.rollbackPerformed ||= modern.result.rollbackPerformed;
      if (modern.result.backupPath) status.backupPaths.push(modern.result.backupPath);
      if (!modern.result.ok) status.error = modern.result.error;
    } else {
      status.error = modern.command.error || modern.command.stderr || "The modern wallpaper Store transaction returned no result.";
    }
  }

  if (diagnostic.recommendedStrategy === "legacy-dock" || diagnostic.recommendedStrategy === "modern-store+legacy-dock") {
    const legacy = await applyLegacyWallpaperDatabase(assignments, mode, diagnostic);
    commands.push(...legacy.commands);
    legacyOk = legacy.result.ok;
    status.targetSpaceCount = Math.max(status.targetSpaceCount, legacy.result.targetSpaceCount);
    status.updatedSpaceCount = Math.max(status.updatedSpaceCount, legacy.result.updatedSpaceCount);
    status.verifiedSpaceCount = Math.max(status.verifiedSpaceCount, legacy.result.verifiedSpaceCount);
    status.legacyDatabaseWritten = legacy.result.updatedSpaceCount > 0;
    status.legacyDatabaseVerified = legacy.result.ok;
    status.dockReloaded = legacy.result.dockReloaded;
    status.rollbackPerformed ||= legacy.result.rollbackPerformed;
    if (legacy.result.backupPath) status.backupPaths.push(legacy.result.backupPath);
    if (!legacy.result.ok) status.error = [status.error, legacy.result.error].filter(Boolean).join(" ");
  }

  if (diagnostic.recommendedStrategy === "modern-store+legacy-dock") status.ok = modernOk && legacyOk;
  else if (diagnostic.recommendedStrategy === "modern-store") status.ok = modernOk;
  else if (diagnostic.recommendedStrategy === "legacy-dock") status.ok = legacyOk;
  else status.ok = false;

  if (!status.ok) {
    status.observerFallback = true;
    status.warning = status.error || diagnostic.warnings.join(" ") || "Immediate inactive-Space synchronization was unavailable.";
  }
  const command = commands.at(-1) ?? fallbackCommand(status.warning || "No immediate all-Space wallpaper strategy was available.");
  return { command, commands, summary: status };
}

export async function getMacOSReferencedWallpaperPaths(activeDisplayId?: string) {
  if (process.platform !== "darwin") return [] as string[];
  const diagnostic = await diagnoseMacOSWallpaperEnvironment(activeDisplayId);
  return [...new Set([
    ...diagnostic.store.references,
    ...diagnostic.legacyDatabase.references
  ].filter((reference) => reference.exists && reference.readable).map((reference) => reference.path))];
}

const macOSActiveSpaceObserverScript = String.raw`
ObjC.import('AppKit');
ObjC.import('Foundation');
// PWC_SPACE_OBSERVER_V2
function unwrap(value) { try { return ObjC.unwrap(value); } catch (_) { return String(value || ''); } }
function displayNumber(screen, fallback) {
  try { return String(unwrap(screen.deviceDescription.objectForKey('NSScreenNumber'))); }
  catch (_) { return String(fallback); }
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
  const apply = () => {
    $.NSScreen.screens.js.forEach((screen, index) => {
      const displayId = displayNumber(screen, index + 1);
      const filePath = byDisplay[displayId] || (request.mode === 'all-desktops-all-monitors' ? fallbackPath : '');
      if (!filePath) return;
      const error = Ref();
      workspace.setDesktopImageURLForScreenOptionsError($.NSURL.fileURLWithPath($(filePath)), screen, optionsForStyle(String(request.style || 'fill')), error);
    });
  };
  apply();
  const block = ObjC.block('void', ['id'], function(_) { apply(); });
  globalThis.__pwcSpaceObserverBlock = block;
  globalThis.__pwcSpaceObserverToken = workspace.notificationCenter.addObserverForNameObjectQueueUsingBlock(
    $.NSWorkspaceActiveSpaceDidChangeNotification, null, $.NSOperationQueue.mainQueue, block
  );
  globalThis.__pwcWakeObserverToken = workspace.notificationCenter.addObserverForNameObjectQueueUsingBlock(
    $.NSWorkspaceDidWakeNotification, null, $.NSOperationQueue.mainQueue, block
  );
  $.NSRunLoop.currentRunLoop.run;
}`;

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
