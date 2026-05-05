import { exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { sanitizeFilename, triggerDownload } from "@/lib/download-blob";

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
