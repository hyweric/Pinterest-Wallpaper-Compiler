#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MEDIA_USAGE_KEYS = [
  'NSMicrophoneUsageDescription',
  'NSCameraUsageDescription'
];

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
    } else if (entry.isFile() && entry.name === 'Info.plist') {
      results.push(fullPath);
    }
  }
  return results;
}

function deletePlistKey(plistPath, key) {
  const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plistPath], {
    encoding: 'utf8'
  });
  // PlistBuddy exits non-zero when the key is absent. That is the desired final state.
  if (result.status !== 0 && !String(result.stderr || '').includes('Does Not Exist')) {
    console.warn(`[Pin Paper] Could not remove ${key} from ${plistPath}: ${result.stderr || result.stdout || 'unknown error'}`);
  }
}

exports.default = async function stripMacosMediaUsage(context) {
  const appOutDir = context && context.appOutDir;
  if (!appOutDir || process.platform !== 'darwin') return;

  const plistPaths = walk(appOutDir);
  for (const plistPath of plistPaths) {
    for (const key of MEDIA_USAGE_KEYS) {
      deletePlistKey(plistPath, key);
    }
  }
};

module.exports = exports.default;
