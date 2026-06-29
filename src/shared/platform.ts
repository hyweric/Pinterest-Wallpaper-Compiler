import type { WallpaperTargetMode } from "./types.js";

export type PinPaperPlatformKind = "macos" | "windows" | "web" | "unsupported-desktop";

export interface PinPaperPlatformCapabilities {
  canApplyWallpaper: boolean;
  canPreviewCurrentDesktop: boolean;
  canCreateNativeWallpaperSet: boolean;
  canCreateExportPack: boolean;
  canUseMacSpaces: boolean;
  canOpenWallpaperSettings: boolean;
  canCleanNativeWallpaperSets: boolean;
  canUseLocalFolders: boolean;
  canUseNativeTray: boolean;
  canUseStartupBehavior: boolean;
  canUsePinterestImport: boolean;
  supportsMultipleWallpaperTargets: boolean;
}

export interface PinPaperPlatformCopy {
  createWallpaperSet: string;
  createWallpaperPack: string;
  previewCurrentDesktop: string;
  applyWallpaper: string;
  wallpaperSetReadyTitle: string;
  wallpaperPackReadyTitle: string;
  openWallpaperSettings: string;
  showSetInFileManager: string;
  cleanupWallpaperSets: string;
  cleanupWallpaperPacks: string;
  rotationGuideTitle: string;
  rotationGuideBody: string;
}

export interface PinPaperPlatformProfile {
  kind: PinPaperPlatformKind;
  label: string;
  capabilities: PinPaperPlatformCapabilities;
  copy: PinPaperPlatformCopy;
}

export function platformKindFromNodePlatform(platform: string): PinPaperPlatformKind {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "browser" || platform === "web") return "web";
  return "unsupported-desktop";
}

export function platformKindFromNavigator(input: { userAgent?: string; platform?: string } = {}): PinPaperPlatformKind {
  const userAgent = input.userAgent ?? "";
  const platform = input.platform ?? "";
  if (/Macintosh|MacIntel|MacPPC|Mac68K/i.test(userAgent) || /Mac/i.test(platform)) return "macos";
  if (/Windows/i.test(userAgent) || /Win/i.test(platform)) return "windows";
  return "web";
}

export function platformCapabilities(kind: PinPaperPlatformKind): PinPaperPlatformCapabilities {
  switch (kind) {
    case "macos":
      return {
        canApplyWallpaper: true,
        canPreviewCurrentDesktop: true,
        canCreateNativeWallpaperSet: true,
        canCreateExportPack: true,
        canUseMacSpaces: true,
        canOpenWallpaperSettings: true,
        canCleanNativeWallpaperSets: true,
        canUseLocalFolders: true,
        canUseNativeTray: true,
        canUseStartupBehavior: true,
        canUsePinterestImport: true,
        supportsMultipleWallpaperTargets: true
      };
    case "windows":
      return {
        canApplyWallpaper: true,
        canPreviewCurrentDesktop: true,
        canCreateNativeWallpaperSet: false,
        canCreateExportPack: true,
        canUseMacSpaces: false,
        canOpenWallpaperSettings: false,
        canCleanNativeWallpaperSets: false,
        canUseLocalFolders: true,
        canUseNativeTray: true,
        canUseStartupBehavior: true,
        canUsePinterestImport: true,
        supportsMultipleWallpaperTargets: false
      };
    case "web":
      return {
        canApplyWallpaper: false,
        canPreviewCurrentDesktop: false,
        canCreateNativeWallpaperSet: false,
        canCreateExportPack: true,
        canUseMacSpaces: false,
        canOpenWallpaperSettings: false,
        canCleanNativeWallpaperSets: false,
        canUseLocalFolders: false,
        canUseNativeTray: false,
        canUseStartupBehavior: false,
        canUsePinterestImport: false,
        supportsMultipleWallpaperTargets: false
      };
    case "unsupported-desktop":
    default:
      return {
        canApplyWallpaper: false,
        canPreviewCurrentDesktop: false,
        canCreateNativeWallpaperSet: false,
        canCreateExportPack: true,
        canUseMacSpaces: false,
        canOpenWallpaperSettings: false,
        canCleanNativeWallpaperSets: false,
        canUseLocalFolders: true,
        canUseNativeTray: true,
        canUseStartupBehavior: true,
        canUsePinterestImport: true,
        supportsMultipleWallpaperTargets: false
      };
  }
}

export function platformCopy(kind: PinPaperPlatformKind): PinPaperPlatformCopy {
  if (kind === "macos") {
    return {
      createWallpaperSet: "Create Wallpaper Set",
      createWallpaperPack: "Create Wallpaper Pack",
      previewCurrentDesktop: "Preview on Current Desktop",
      applyWallpaper: "Apply Wallpaper",
      wallpaperSetReadyTitle: "Wallpaper Set Ready",
      wallpaperPackReadyTitle: "Wallpaper Pack Ready",
      openWallpaperSettings: "Open Wallpaper Settings",
      showSetInFileManager: "Show Set in Finder",
      cleanupWallpaperSets: "Clean Up Wallpaper Sets…",
      cleanupWallpaperPacks: "Clean Up Wallpaper Packs…",
      rotationGuideTitle: "Use macOS to rotate exported sets",
      rotationGuideBody: "Create a Wallpaper Set, then choose that folder in macOS Wallpaper Settings."
    };
  }
  if (kind === "windows") {
    return {
      createWallpaperSet: "Create Wallpaper Pack",
      createWallpaperPack: "Create Wallpaper Pack",
      previewCurrentDesktop: "Set as Wallpaper Preview",
      applyWallpaper: "Set as Wallpaper",
      wallpaperSetReadyTitle: "Wallpaper Pack Ready",
      wallpaperPackReadyTitle: "Wallpaper Pack Ready",
      openWallpaperSettings: "Open Windows Background Settings",
      showSetInFileManager: "Show Pack in Folder",
      cleanupWallpaperSets: "Clean Up Wallpaper Packs…",
      cleanupWallpaperPacks: "Clean Up Wallpaper Packs…",
      rotationGuideTitle: "Export wallpaper packs for Windows",
      rotationGuideBody: "Create a Wallpaper Pack, then select images from Windows Background settings or use the desktop app to set one wallpaper directly."
    };
  }
  return {
    createWallpaperSet: "Export Wallpaper Pack",
    createWallpaperPack: "Export Wallpaper Pack",
    previewCurrentDesktop: "Download Preview",
    applyWallpaper: "Download Wallpaper",
    wallpaperSetReadyTitle: "Wallpaper Pack Ready",
    wallpaperPackReadyTitle: "Wallpaper Pack Ready",
    openWallpaperSettings: "Open Settings",
    showSetInFileManager: "Show Pack",
    cleanupWallpaperSets: "Clean Up Wallpaper Packs…",
    cleanupWallpaperPacks: "Clean Up Wallpaper Packs…",
    rotationGuideTitle: "Download wallpapers from the web version",
    rotationGuideBody: "The web version can create and export wallpapers. Native desktop preview and wallpaper setting are available in the Mac and Windows apps."
  };
}

export function platformProfile(kind: PinPaperPlatformKind): PinPaperPlatformProfile {
  return {
    kind,
    label: kind === "macos" ? "macOS" : kind === "windows" ? "Windows" : kind === "web" ? "Website" : "Desktop",
    capabilities: platformCapabilities(kind),
    copy: platformCopy(kind)
  };
}

export function platformSupportsWallpaperTargetMode(kind: PinPaperPlatformKind, mode: WallpaperTargetMode) {
  const capabilities = platformCapabilities(kind);
  if (!capabilities.canApplyWallpaper) return false;
  if ((mode === "all-desktops-current-monitor" || mode === "all-desktops-all-monitors") && !capabilities.canUseMacSpaces) return false;
  if (mode === "all-visible-monitors" && !capabilities.supportsMultipleWallpaperTargets) return kind === "macos";
  return true;
}

export function fallbackWallpaperTargetMode(kind: PinPaperPlatformKind, mode: WallpaperTargetMode): WallpaperTargetMode {
  return platformSupportsWallpaperTargetMode(kind, mode) ? mode : "current-desktop";
}
