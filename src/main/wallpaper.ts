import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WallpaperDisplayMode } from "../shared/types.js";

const execFileAsync = promisify(execFile);

export interface WallpaperControllerOptions {
  displayMode?: WallpaperDisplayMode;
  monitorMode?: "primary" | "all" | "span";
}

export interface WallpaperController {
  setWallpaper(filePath: string, options?: WallpaperControllerOptions): Promise<void>;
}

export class MacOSWallpaperController implements WallpaperController {
  async setWallpaper(filePath: string) {
    const { stdout } = await execFileAsync("osascript", [
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
      'return "ok"',
      "-e",
      "end run",
      filePath
    ]);
    if (!String(stdout).trim().includes("ok")) {
      throw new Error("macOS did not confirm the wallpaper change.");
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
    await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
  }
}

export class UnsupportedWallpaperController implements WallpaperController {
  async setWallpaper() {
    throw new Error("Setting the desktop wallpaper is not supported on this platform yet.");
  }
}

export function createWallpaperController(): WallpaperController {
  if (process.platform === "darwin") return new MacOSWallpaperController();
  if (process.platform === "win32") return new WindowsWallpaperController();
  return new UnsupportedWallpaperController();
}
