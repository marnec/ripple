// Embed resolution for document export. Two entry points:
//   - resolveDiagramEmbed(): fetch a diagram snapshot and produce HTML/MD/DOCX-ready forms.
//   - fetchCellGrid(): fetch resolved cell values for a spreadsheet range or single cell ref.
//
// Internals (PNG rasterization, SVG-to-string, base64 encoding) are file-private.

import type { ConvexReactClient } from "convex/react";
import { exportToSvg } from "@excalidraw/excalidraw";
import { yjsToExcalidraw } from "y-excalidraw";
import * as Y from "yjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { DiagramEmbed } from "./types";

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
    const scale = Math.min(2, 2048 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!pngBlob) return null;
    const bytes = new Uint8Array(await pngBlob.arrayBuffer());
    return { bytes, width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
