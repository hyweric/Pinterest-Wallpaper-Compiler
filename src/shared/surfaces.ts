

import type { PaperTextureEffect } from "./types";
export type BundledSurfaceId = "paper" | "crumpled-paper" | "grid-paper" | "dotted-paper";

export interface BundledSurfaceManifestEntry {
  id: BundledSurfaceId;
  label: string;
  paperType: "paper" | "crumpled-paper" | "grid-paper" | "dotted-paper";
  assetFile: string;
  thumbnailFile: string;
  sourceAsset: string;
  sourceUrl: string;
  publisher: "ambientCG";
  license: "CC0-1.0";
  downloadedAt: string;
  originalFileName: string;
  sha256: string;
}

export const bundledSurfaceManifest: BundledSurfaceManifestEntry[] = [
  {
    id: "paper",
    label: "Paper",
    paperType: "paper",
    assetFile: "paper.webp",
    thumbnailFile: "thumbs/paper.webp",
    sourceAsset: "Paper 002",
    sourceUrl: "https://ambientcg.com/view?id=Paper002",
    publisher: "ambientCG",
    license: "CC0-1.0",
    downloadedAt: "2026-06-16",
    originalFileName: "paper002_4K_Color.jpg",
    sha256: "ab7c1d7a01f990dbde98df12972baf6c620b0f0f860a1563efefa6f2935fb65d"
  },
  {
    id: "crumpled-paper",
    label: "Crumpled Paper",
    paperType: "crumpled-paper",
    assetFile: "crumpled-paper.webp",
    thumbnailFile: "thumbs/crumpled-paper.webp",
    sourceAsset: "Paper 003",
    sourceUrl: "https://ambientcg.com/view?id=Paper003",
    publisher: "ambientCG",
    license: "CC0-1.0",
    downloadedAt: "2026-06-16",
    originalFileName: "Paper003_4K_Color.jpg",
    sha256: "fb910cb512a556e6b25285f281a6b6f8b47ae66e4db65e9718a9cfb7fc2bb51b"
  },
  {
    id: "grid-paper",
    label: "Grid Paper",
    paperType: "grid-paper",
    assetFile: "grid-paper.webp",
    thumbnailFile: "thumbs/grid-paper.webp",
    sourceAsset: "Generated from Paper 002",
    sourceUrl: "https://ambientcg.com/view?id=Paper002",
    publisher: "ambientCG",
    license: "CC0-1.0",
    downloadedAt: "2026-06-16",
    originalFileName: "generated-grid-paper.webp",
    sha256: "5d6867ea6f5c69de45e1543b21e8cc4aa0c7e0e313f8815d462847324b8e9151"
  },
  {
    id: "dotted-paper",
    label: "Dotted Paper",
    paperType: "dotted-paper",
    assetFile: "dotted-paper.webp",
    thumbnailFile: "thumbs/dotted-paper.webp",
    sourceAsset: "Generated from Paper 002",
    sourceUrl: "https://ambientcg.com/view?id=Paper002",
    publisher: "ambientCG",
    license: "CC0-1.0",
    downloadedAt: "2026-06-16",
    originalFileName: "generated-dotted-paper.webp",
    sha256: "a42e787044d398e654596129854c21db4ec3125157293619c75e73101bbb351e"
  }
];


export const bundledSurfaceDefaults: Record<BundledSurfaceManifestEntry["paperType"], Pick<PaperTextureEffect, "intensity" | "scale" | "rotation" | "opacity" | "blendMode" | "noise" | "roughness" | "tone">> = {
  paper: {
    intensity: 100,
    scale: 0.24,
    rotation: 0,
    opacity: 0.72,
    blendMode: "multiply",
    noise: 88,
    roughness: 82,
    tone: 12
  },
  "crumpled-paper": {
    intensity: 100,
    scale: 0.24,
    rotation: 24,
    opacity: 0.58,
    blendMode: "multiply",
    noise: 82,
    roughness: 94,
    tone: 8
  },
  "grid-paper": {
    intensity: 100,
    scale: 0.95,
    rotation: 0,
    opacity: 0.78,
    blendMode: "multiply",
    noise: 58,
    roughness: 6,
    tone: 40
  },
  "dotted-paper": {
    intensity: 100,
    scale: 0.9,
    rotation: 0,
    opacity: 1,
    blendMode: "multiply",
    noise: 64,
    roughness: 10,
    tone: 68
  }
};

export function surfaceDefaultsForType(type: PaperTextureEffect["type"]) {
  const resolved = resolveBundledSurfaceType(type);
  return resolved ? { ...bundledSurfaceDefaults[resolved] } : undefined;
}

const bundledSurfaceAliases: Record<string, BundledSurfaceManifestEntry["paperType"]> = {
  paper: "paper",
  "crumpled-paper": "crumpled-paper",
  "grid-paper": "grid-paper",
  "dotted-paper": "dotted-paper",
  "fine-grain": "paper",
  "matte-photo": "paper",
  recycled: "paper",
  handmade: "crumpled-paper",
  canvas: "crumpled-paper"
};

export function resolveBundledSurfaceType(type: string) {
  return bundledSurfaceAliases[type];
}

export function surfaceManifestIsComplete(entries = bundledSurfaceManifest) {
  const ids = new Set(entries.map((entry) => entry.id));
  return entries.length === 4
    && ids.size === entries.length
    && entries.every((entry) => Boolean(entry.label && entry.assetFile && entry.thumbnailFile && entry.sourceUrl && entry.license));
}

export function surfaceManifestEntryForPaperType(type: string) {
  const resolved = resolveBundledSurfaceType(type);
  return resolved ? bundledSurfaceManifest.find((entry) => entry.paperType === resolved) : undefined;
}
