// Embed resolution for document export. Three entry points:
//   - resolveDiagramEmbed(): fetch a diagram snapshot and produce HTML/MD/DOCX-ready forms.
//   - resolveImageEmbed(): fetch an image block's bytes in a form Word accepts.
//   - fetchCellGrid(): fetch resolved cell values for a spreadsheet range or single cell ref.
//
// Internals (PNG rasterization, SVG-to-string, base64 encoding) are file-private.

import type { ConvexReactClient } from "convex/react";
import { exportToSvg } from "@excalidraw/excalidraw";
import { yjsToExcalidraw } from "y-excalidraw";
import * as Y from "yjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { DiagramEmbed, ImageEmbed } from "./types";

interface ResolveDiagramOptions {
  /** Render with Excalidraw's dark mode. Document exports always pass false. */
  isDark?: boolean;
  /** Skip canvas rasterization (e.g. caller only needs HTML/MD forms). */
  skipPng?: boolean;
}

export async function resolveDiagramEmbed(
  convex: ConvexReactClient,
  diagramId: Id<"diagrams">,
  options: ResolveDiagramOptions = {},
): Promise<DiagramEmbed | null> {
  const svg = await fetchDiagramSvgElement(convex, diagramId, options.isDark ?? false);
  if (!svg) return null;
  const svgHtml = svgElementToResponsiveString(svg);
  const xml = new XMLSerializer().serializeToString(svg);
  const svgBase64 = bytesToBase64(new TextEncoder().encode(xml));
  const png = options.skipPng ? null : await svgElementToPngBytes(svg).catch(() => null);
  return { svgHtml, svgBase64, png: png ?? undefined };
}

/**
 * Read an image block's bytes so DOCX can embed the picture itself rather than
 * a placeholder line. Word only understands PNG/JPEG/GIF/BMP, so anything else
 * the browser can decode (WebP, AVIF, SVG) is rasterized to PNG on the way out.
 *
 * Returns null — and the exporter falls back to a caption line — when the
 * image cannot be read: a cross-origin host without CORS, a dead URL, or a
 * format the browser itself cannot decode.
 */
export async function resolveImageEmbed(url: string): Promise<ImageEmbed | null> {
  if (!url) return null;

  let raw: Blob;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    raw = await response.blob();
  } catch {
    return null;
  }

  const bytes = new Uint8Array(await raw.arrayBuffer());
  const nativeType = sniffDocxImageType(bytes);
  // A blob served without a usable Content-Type still has to reach `<img>`
  // with one, or the browser refuses to decode it.
  const mime = raw.type.startsWith("image/") ? raw.type : sniffMimeType(bytes);
  const blob = raw.type === mime ? raw : new Blob([raw], { type: mime });

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return null;
    if (nativeType) return { bytes, type: nativeType, width, height };
    // A vector source has no pixels of its own — oversample it the way the
    // diagram exporter does. Raster formats Word rejects (WebP, AVIF) only
    // need re-encoding, so they draw 1:1.
    const scale = mime === "image/svg+xml" ? Math.min(2, 2048 / Math.max(width, height)) : 1;
    const png = await drawToPngBytes(img, Math.round(width * scale), Math.round(height * scale));
    return png ? { bytes: png, type: "png", width, height } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function fetchCellGrid(
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

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function fetchDiagramSvgElement(
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
    const yElements = yDoc.getArray<Y.Map<unknown>>("elements");
    const elements = yjsToExcalidraw(yElements);
    if (elements.length === 0) return null;
    return await exportToSvg({
      elements,
      appState: { exportWithDarkMode: isDark, exportBackground: false },
      files: null,
    });
  } finally {
    yDoc.destroy();
  }
}

function svgElementToResponsiveString(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("width");
  clone.removeAttribute("height");
  clone.setAttribute("style", "max-width:100%;height:auto;");
  return new XMLSerializer().serializeToString(clone);
}

async function svgElementToPngBytes(
  svg: SVGSVGElement,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const { width, height } = readSvgPixelDimensions(svg);
  if (!width || !height) return null;

  const xml = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    // Vector source: oversample so the raster still looks sharp in Word.
    const scale = Math.min(2, 2048 / Math.max(width, height));
    const bytes = await drawToPngBytes(
      img,
      Math.round(width * scale),
      Math.round(height * scale),
      "#ffffff",
    );
    return bytes ? { bytes, width, height } : null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function drawToPngBytes(
  img: HTMLImageElement,
  width: number,
  height: number,
  background?: string,
): Promise<Uint8Array | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  const pngBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!pngBlob) return null;
  return new Uint8Array(await pngBlob.arrayBuffer());
}

/** Magic-byte sniff, limited to the formats `docx`'s ImageRun takes directly.
 *  Null means "the canvas has to convert this one". */
function sniffDocxImageType(bytes: Uint8Array): ImageEmbed["type"] | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (starts(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (starts(bytes, [0x42, 0x4d])) return "bmp";
  return null;
}

function sniffMimeType(bytes: Uint8Array): string {
  const native = sniffDocxImageType(bytes);
  if (native) return native === "jpg" ? "image/jpeg" : `image/${native}`;
  // RIFF....WEBP
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp";
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return "application/octet-stream";
}

function starts(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

function readSvgPixelDimensions(svg: SVGSVGElement): { width: number; height: number } {
  let width = parseFloat(svg.getAttribute("width") ?? "0");
  let height = parseFloat(svg.getAttribute("height") ?? "0");
  if (!width || !height) {
    const vb = svg.getAttribute("viewBox");
    if (vb) {
      const parts = vb.split(/\s+/).map((n) => parseFloat(n));
      if (parts.length === 4) {
        width = width || parts[2] || 0;
        height = height || parts[3] || 0;
      }
    }
  }
  return { width, height };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("svg image load failed"));
    el.src = src;
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
