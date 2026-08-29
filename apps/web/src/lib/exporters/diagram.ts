import { exportToCanvas, exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawFrameLikeElement } from "@excalidraw/excalidraw/element/types";
import { sanitizeFilename, triggerDownload } from "@/lib/download-blob";
import { orderFrames } from "@/pages/App/Diagram/frames";
import { deckSize, fitContain, type SlideSize } from "./slide-layout";

/** Custom slide size registered per deck — see `deckSize`. */
const LAYOUT_NAME = "RIPPLE_DIAGRAM";

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
 * Rasterise a presentation diagram one frame at a time, in reading order —
 * shared by the PDF and PPTX exporters, which differ only in what they wrap
 * each canvas in. Yields a single canvas of the whole scene when the diagram
 * has no frames. `exportingFrame` clips the render to the frame's bounds, so
 * each canvas is exactly one page/slide.
 *
 * A generator rather than an array: a long deck then costs one frame's worth of
 * bitmap at a time instead of holding every page in memory at once.
 */
async function* frameCanvases(
  api: ExcalidrawImperativeAPI,
): AsyncGenerator<HTMLCanvasElement> {
  const elements = api.getSceneElements();
  const appState = { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false };
  const files = api.getFiles();
  const frames = orderFrames(elements) as unknown as ExcalidrawFrameLikeElement[];
  const targets: Array<ExcalidrawFrameLikeElement | null> = frames.length > 0 ? frames : [null];

  for (const frame of targets) {
    yield await exportToCanvas({ elements, appState, files, exportingFrame: frame });
  }
}

/**
 * Export a presentation diagram to a multi-page PDF — one landscape page per
 * Excalidraw frame, in reading order. Falls back to a single page of the whole
 * scene when the diagram has no frames.
 */
export async function exportDiagramPdf(api: ExcalidrawImperativeAPI, name: string): Promise<void> {
  // jsPDF is heavy (~350KB) — keep it out of the main bundle. This module is
  // already lazy-loaded by DiagramActionsMenu, but import jsPDF lazily too so
  // the other (PNG/SVG/PPTX/JSON) exporters don't pull it in.
  const { jsPDF } = await import("jspdf");

  // Each canvas defines its own page geometry, so create the doc from the
  // first page and add subsequent pages with explicit dimensions.
  let doc: import("jspdf").jsPDF | null = null;
  for await (const canvas of frameCanvases(api)) {
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

/**
 * Export a presentation diagram to PPTX — one slide per Excalidraw frame, in
 * reading order, each frame rasterised to a full-bleed PNG. Falls back to a
 * single slide of the whole scene when the diagram has no frames.
 *
 * Frames become *pictures*, not editable shapes: Excalidraw's model (hand-drawn
 * roughness, freedraw strokes, arrow bindings) has no faithful DrawingML
 * equivalent, so a shape-by-shape translation would silently redraw the
 * diagram. A raster slide is what the author actually drew.
 *
 * Unlike PDF, a deck has one slide size for every slide, so the size comes from
 * the first frame and the rest are contain-fitted into it.
 */
export async function exportDiagramPptx(api: ExcalidrawImperativeAPI, name: string): Promise<void> {
  // pptxgenjs bundles JSZip and is ~500KB — same treatment as jsPDF above.
  const { default: PptxGenJS } = await import("pptxgenjs");

  const pptx = new PptxGenJS();
  pptx.title = name;

  let slide: SlideSize | null = null;
  for await (const canvas of frameCanvases(api)) {
    if (!slide) {
      slide = deckSize(canvas);
      pptx.defineLayout({ name: LAYOUT_NAME, width: slide.width, height: slide.height });
      pptx.layout = LAYOUT_NAME;
    }
    const rect = fitContain(canvas, slide);
    pptx.addSlide().addImage({
      data: canvas.toDataURL("image/png"),
      x: rect.x,
      y: rect.y,
      w: rect.width,
      h: rect.height,
    });
  }

  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  triggerDownload(blob, `${sanitizeFilename(name)}.pptx`);
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
