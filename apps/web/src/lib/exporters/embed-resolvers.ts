import type { ConvexReactClient } from "convex/react";
import { exportToSvg } from "@excalidraw/excalidraw";
import { yjsToExcalidraw } from "y-excalidraw";
import * as Y from "yjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

/** Fetch a diagram's Yjs snapshot from Convex and render it to an SVGElement.
 *  Returns null if the snapshot is missing or empty. Pure: does not touch
 *  IndexedDB, Y.Doc registries, or the module-level preview cache. */
export async function fetchDiagramSvgElement(
  convex: ConvexReactClient,
  diagramId: Id<"diagrams">,
  isDark: boolean,
): Promise<SVGSVGElement | null> {
  const url = await convex.query(api.snapshots.getSnapshotUrl, {
    resourceType: "diagram",
    resourceId: diagramId,
  });
  if (!url) return null;

  const response = await fetch(url);
  if (!response.ok) return null;
  const buffer = await response.arrayBuffer();

  const yDoc = new Y.Doc();
  try {
    Y.applyUpdate(yDoc, new Uint8Array(buffer));
    const yElements = yDoc.getArray<Y.Map<any>>("elements");
    const elements = yjsToExcalidraw(yElements);
    if (elements.length === 0) return null;
    const svg = await exportToSvg({
      elements,
      appState: { exportWithDarkMode: isDark, exportBackground: false },
      files: null,
    });
    return svg;
  } finally {
    yDoc.destroy();
  }
}

/** Convert an SVG element to a PNG byte buffer using a 2D canvas. Preserves
 *  the SVG's pixel dimensions (set by Excalidraw's exportToSvg). The browser
 *  rasterizes the SVG via an `<img>` element load, so this only works in a
 *  browser context. */
export async function svgElementToPngBytes(svg: SVGSVGElement): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const widthAttr = parseFloat(svg.getAttribute("width") ?? "0");
  const heightAttr = parseFloat(svg.getAttribute("height") ?? "0");
  // Fallback to viewBox if width/height attrs are missing or zero
  let width = widthAttr;
  let height = heightAttr;
  if (!width || !height) {
    const vb = svg.getAttribute("viewBox");
    if (vb) {
      const parts = vb.split(/\s+/).map((n) => parseFloat(n));
      if (parts.length === 4 && parts[2] && parts[3]) {
        width = width || parts[2];
        height = height || parts[3];
      }
    }
  }
  if (!width || !height) return null;

  const xml = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("svg image load failed"));
      el.src = objectUrl;
    });
    // 2x devicePixelRatio for crisper Word rendering, capped at 2048px
    const scale = Math.min(2, 2048 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
    if (!pngBlob) return null;
    const bytes = new Uint8Array(await pngBlob.arrayBuffer());
    return { bytes, width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** SVG element serialized for HTML embedding (responsive width). */
export function svgElementToResponsiveString(svg: SVGSVGElement): string {
  // Clone so we don't mutate the original (it might be reused for PNG conversion)
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("width");
  clone.removeAttribute("height");
  clone.setAttribute("style", "max-width:100%;height:auto;");
  return new XMLSerializer().serializeToString(clone);
}

/** Encode binary bytes as a base64 string. Browser-safe (uses btoa).
 *  For SVG embedding into Markdown as a data URL. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Fetch the resolved cell values for a `spreadsheetRange` block. Returns the
 *  2D string grid stored in `spreadsheetCellRefs.getCellRef`, or null if the
 *  range is orphaned or the query fails. */
export async function fetchSpreadsheetCells(
  convex: ConvexReactClient,
  spreadsheetId: Id<"spreadsheets">,
  stableRef: string,
): Promise<string[][] | null> {
  if (!stableRef) return null;
  try {
    const result = await convex.query(api.spreadsheetCellRefs.getCellRef, {
      spreadsheetId,
      stableRef,
    });
    if (!result || result.orphan) return null;
    return result.values;
  } catch {
    return null;
  }
}
