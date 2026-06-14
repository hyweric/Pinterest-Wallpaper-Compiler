export type BundledSurfaceId = "fine-paper" | "matte-paper" | "recycled-paper" | "canvas" | "handmade-paper";

export interface BundledSurfaceManifestEntry {
  id: BundledSurfaceId;
  label: string;
  paperType: "fine-grain" | "matte-photo" | "recycled" | "canvas" | "handmade";
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
    id: "fine-paper",
    label: "Fine Paper",
    paperType: "fine-grain",
    assetFile: "fine-paper.webp",
    thumbnailFile: "thumbs/fine-paper.webp",
    sourceAsset: "Paper 001",
    sourceUrl: "https://ambientcg.com/view?id=Paper001",
    publisher: "ambientCG",
    license: "CC0-1.0",
    downloadedAt: "2026-06-14",
    originalFileName: "Paper001.webp",
    sha256: "7579751bcb520325bf9073a93828b8f3ad4a777fe3b01b2988772a92763d8826"
  },
  {
    id: "matte-paper",
    label: "Matte Paper",
    paperType: "matte-photo",
    assetFile: "matte-paper.webp",
    thumbnailFile: "thumbs/matte-paper.webp",
    sourceAsset: "Paper 001",
    sourceUrl: "https://ambientcg.com/view?id=Paper001",
    publisher: "ambientCG",
    license: "CC0-1.0",
    downloadedAt: "2026-06-14",
    originalFileName: "Paper001.webp",
    sha256: "0a9ec4518e87fa8b6b9f596e134433d218632665585817aa825d41e7f6811d33"
  },
  {
    id: "recycled-paper",
    label: "Recycled Paper",
    paperType: "recycled",
    assetFile: "recycled-paper.webp",
    thumbnailFile: "thumbs/recycled-paper.webp",
    sourceAsset: "Paper 002",
    sourceUrl: "https://ambientcg.com/view?id=Paper002",
    publisher: "ambientCG",
    license: "CC0-1.0",
    downloadedAt: "2026-06-14",
    originalFileName: "Paper002.webp",
    sha256: "ae7b66359f34193e709286a6bce8a9a3bcbbc699ff4f68c6e1edd1870a662c7f"
  },
  {
    id: "canvas",
    label: "Canvas",
    paperType: "canvas",
    assetFile: "canvas.webp",
    thumbnailFile: "thumbs/canvas.webp",
    sourceAsset: "Fabric 001",
    sourceUrl: "https://ambientcg.com/view?id=Fabric001",
    publisher: "ambientCG",
    license: "CC0-1.0",
    downloadedAt: "2026-06-14",
    originalFileName: "Fabric001.webp",
    sha256: "a187999cf1a0cc7cb98561d32f674832d3835ff735b4f819ae68785d811a3b8f"
  },
  {
    id: "handmade-paper",
    label: "Handmade Paper",
    paperType: "handmade",
    assetFile: "handmade-paper.webp",
    thumbnailFile: "thumbs/handmade-paper.webp",
    sourceAsset: "Paper 003",
    sourceUrl: "https://ambientcg.com/view?id=Paper003",
    publisher: "ambientCG",
    license: "CC0-1.0",
    downloadedAt: "2026-06-14",
    originalFileName: "Paper003.webp",
    sha256: "2d775cb3437648d5e0e48e647f3c8099a25af34e91a14f678b7c95ea0463d504"
  }
];

export function surfaceManifestIsComplete(entries = bundledSurfaceManifest) {
  const ids = new Set(entries.map((entry) => entry.id));
  return entries.length === 5
    && ids.size === entries.length
    && entries.every((entry) => Boolean(entry.label && entry.assetFile && entry.thumbnailFile && entry.sourceUrl && entry.license));
}


export function surfaceManifestEntryForPaperType(type: string) {
  return bundledSurfaceManifest.find((entry) => entry.paperType === type);
}
