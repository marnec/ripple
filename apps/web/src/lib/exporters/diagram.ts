import { exportToCanvas, exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawFrameLikeElement } from "@excalidraw/excalidraw/element/types";
import { sanitizeFilename, triggerDownload } from "@/lib/download-blob";
import { orderFrames } from "@/pages/App/Diagram/frames";

export async function exportDiagramPng(api: ExcalidrawImperativeAPI, name: string): Promise<void> {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();
  const blob = await exportToBlob({
    elements,
    appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
    files,
    mimeType: "image/png",
    quality: 1,
  });
  triggerDownload(blob, `${sanitizeFilename(name)}.png`);
}

export async function exportDiagramSvg(api: ExcalidrawImperativeAPI, name: string): Promise<void> {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();
  const svg = await exportToSvg({
    elements,
    appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
    files,
  });
  const xml = new XMLSerializer().serializeToString(svg);
  triggerDownload(
    new Blob([xml], { type: "image/svg+xml;charset=utf-8" }),
    `${sanitizeFilename(name)}.svg`,
  );
}

/**
 * Export a presentation diagram to a multi-page PDF — one landscape page per
 * Excalidraw frame, in reading order. Falls back to a single page of the whole
 * scene when the diagram has no frames. Each frame is rasterised via
 * `exportToCanvas` with `exportingFrame`, which clips to the frame's bounds.
 */
export async function exportDiagramPdf(api: ExcalidrawImperativeAPI, name: string): Promise<void> {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();
  const frames = orderFrames(elements) as unknown as ExcalidrawFrameLikeElement[];

  // jsPDF is heavy (~350KB) — keep it out of the main bundle. This module is
  // already lazy-loaded by DiagramActionsMenu, but import jsPDF lazily too so
  // the other (PNG/SVG/JSON) exporters don't pull it in.
  const { jsPDF } = await import("jspdf");

  const commonAppState = { ...appState, exportBackground: true, exportWithDarkMode: false };

  // Each canvas defines its own page geometry, so create the doc from the
  // first page and add subsequent pages with explicit dimensions.
  const targets: Array<ExcalidrawFrameLikeElement | null> =
    frames.length > 0 ? frames : [null];

  let doc: import("jspdf").jsPDF | null = null;
  for (const frame of targets) {
    const canvas = await exportToCanvas({
      elements,
      appState: commonAppState,
      files,
      exportingFrame: frame,
    });
    const { width, height } = canvas;
    const orientation = width >= height ? "landscape" : "portrait";
    const dataUrl = canvas.toDataURL("image/png");

    if (!doc) {
      doc = new jsPDF({ orientation, unit: "px", format: [width, height] });
    } else {
      doc.addPage([width, height], orientation);
    }
    doc.addImage(dataUrl, "PNG", 0, 0, width, height);
  }

  doc?.save(`${sanitizeFilename(name)}.pdf`);
}

export function exportDiagramJson(api: ExcalidrawImperativeAPI, name: string): void {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();
  const scene = {
    type: "excalidraw",
    version: 2,
    source: "ripple",
    elements,
    appState: {
      gridSize: appState.gridSize,
      viewBackgroundColor: appState.viewBackgroundColor,
    },
    files,
  };
  triggerDownload(
    new Blob([JSON.stringify(scene, null, 2)], { type: "application/json;charset=utf-8" }),
    `${sanitizeFilename(name)}.excalidraw`,
  );
}
