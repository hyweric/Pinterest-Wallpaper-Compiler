import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { classifyMacOSStoreSpaces } from "./macos-spaces.js";

test("shared wallpaper Store records are excluded from the user-visible desktop count", () => {
  const displays = {
    "AFA8B6A2-7280-4EB9-9377-5A5F198328F5": ["BUILTIN"],
    "1BD340B5-EB3E-44E1-94EC-0B379358CF1A": ["DELL"],
    "87C336D4-B1B7-4801-AA90-4BC9CA677BC4": ["BUILTIN"],
    "E2D99ECE-30A6-4BDE-80E0-A16C9EF0641F": ["BUILTIN"],
    "29823DEC-01EB-4C05-BB30-154B939E6D92": ["BUILTIN", "DELL"],
    "99F73589-4E08-4A72-8D1C-8A7DA9023CDB": ["DELL"]
  };
  const result = classifyMacOSStoreSpaces(displays);
  assert.equal(result.desktopSpaceUUIDs.length, 5);
  assert.deepEqual(result.sharedSpaceUUIDs, ["29823DEC-01EB-4C05-BB30-154B939E6D92"]);
});

test("modern Store updates preserve macOS-generated Configuration and change only Files paths", async () => {
  const source = await readFile(path.join(process.cwd(), "src/main/macos-spaces.ts"), "utf8");
  assert.match(source, /patchDesktopPath/);
  assert.match(source, /set\(file, 'relative'/);
  assert.doesNotMatch(source, /set\(choice, 'Configuration'/);
  assert.doesNotMatch(source, /type: 'imageFile', url:/);
});

test("modern Store transaction verifies user desktops and shared records separately", async () => {
  const source = await readFile(path.join(process.cwd(), "src/main/macos-spaces.ts"), "utf8");
  assert.match(source, /owners\.length > 1/);
  assert.match(source, /userSpaces/);
  assert.match(source, /sharedSpaces/);
  assert.match(source, /verifiedSharedSpaceCount/);
  assert.match(source, /verifyUserSpaces/);
});
