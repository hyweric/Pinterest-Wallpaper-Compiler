/// <reference types="vite/client" />

import type { WallpaperApi } from "../preload/index";

declare global {
  interface Window {
    wallpaperApi: WallpaperApi;
  }
}
