const { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const source = path.join(projectRoot, "src", "main", "pwc-wallpaper-bridge.swift");
const outputDir = path.join(projectRoot, "dist", "main", "helpers");
const output = path.join(outputDir, "pwc-wallpaper-bridge");
const sourceCopy = path.join(outputDir, "pwc-wallpaper-bridge.swift");

mkdirSync(outputDir, { recursive: true });
copyFileSync(source, sourceCopy);
rmSync(output, { force: true });

if (process.platform !== "darwin") {
  writeFileSync(path.join(outputDir, "pwc-wallpaper-bridge.unavailable"), "The native wallpaper bridge is compiled only on macOS.\n");
  process.exit(0);
}

const find = spawnSync("/usr/bin/xcrun", ["--find", "swiftc"], { encoding: "utf8" });
if (find.status !== 0 || !find.stdout.trim()) {
  writeFileSync(path.join(outputDir, "pwc-wallpaper-bridge.unavailable"), "xcrun swiftc was unavailable; direct inactive-Space refresh will fall back to visible monitors.\n");
  console.warn("[wallpaper bridge] swiftc unavailable; continuing without private refresh bridge.");
  process.exit(0);
}

const result = spawnSync("/usr/bin/xcrun", [
  "swiftc",
  "-O",
  "-framework", "AppKit",
  "-framework", "Foundation",
  source,
  "-o", output
], { stdio: "inherit" });

if (result.status !== 0 || !existsSync(output)) {
  writeFileSync(path.join(outputDir, "pwc-wallpaper-bridge.unavailable"), "The Swift helper failed to compile; direct inactive-Space refresh will fall back to visible monitors.\n");
  console.warn("[wallpaper bridge] compilation failed; continuing without private refresh bridge.");
  process.exit(0);
}

chmodSync(output, 0o755);
console.log(`[wallpaper bridge] built ${output}`);
