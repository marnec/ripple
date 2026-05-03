import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery } from "convex-helpers/react/cache";
import { useTheme } from "next-themes";
import { IndexeddbPersistence } from "y-indexeddb";
import { yjsToExcalidraw } from "y-excalidraw";
import { exportToSvg } from "@excalidraw/excalidraw";
import * as Y from "yjs";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

// Module-level SVG cache to avoid redundant exportToSvg calls across mounts
const svgCache = new Map<
  string,
  { svg: string; theme: string; timestamp: number }
>();
const CACHE_TTL = 60_000; // 60 seconds

// Debounce interval for SVG regeneration on Yjs updates
const DEBOUNCE_MS = 2_000;

export interface UseDiagramPreviewResult {
  /** The SVG HTML string to render, or null if not available */
  svgHtml: string | null;
  /** Still loading */
  isLoading: boolean;
  /** Whether the app is in dark mode */
  isDark: boolean;
  /** Force re-read from IndexedDB and regenerate SVG */
  refresh: () => void;
  /** The diagram document from Convex (for metadata, null checks) */
  diagram: { _id: Id<"diagrams">; name: string } | null | undefined;
}

/**
 * Hook to get the best available diagram preview for embedding.
 *
 * Uses IndexeddbPersistence for instant cached data on mount, and Convex
 * reactive snapshot queries for live updates (2-10s freshness). No WebSocket
 * connection is opened — previews piggyback on the existing Convex connection.
 */
export function useDiagramPreview(
  diagramId: Id<"diagrams">,
): UseDiagramPreviewResult {
  // Convex query for metadata (diagram exists? name?)
  const diagram = useQuery(api.diagrams.get, { id: diagramId });

  // Reactive snapshot URL — fires when the diagram DO saves a new snapshot
  const snapshotUrl = useQuery(api.snapshots.getSnapshotUrl, {
    resourceType: "diagram",
    resourceId: diagramId,
  });

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const cacheKey = `${diagramId}-${resolvedTheme}`;
  const [localSvg, setLocalSvg] = useState<string | null>(() => {
    // Check cache on initial render
    const cached = svgCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.svg;
    }
    return null;
  });
  const [isLocalLoading, setIsLocalLoading] = useState(true);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Hydrate from the module cache synchronously when the cache key changes
  // (e.g. theme switch or diagramId change). Render-time setState avoids
  // a wasted no-op effect cycle.
  const [prevCacheKey, setPrevCacheKey] = useState(cacheKey);
  if (prevCacheKey !== cacheKey) {
    setPrevCacheKey(cacheKey);
    const cached = svgCache.get(cacheKey);
    // eslint-disable-next-line react-hooks/purity
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setLocalSvg(cached.svg);
      setIsLocalLoading(false);
    }
  }

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSnapshotUrlRef = useRef<string | null>(null);

  // Stable Y.Doc — one per diagramId
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const yDoc = useMemo(() => new Y.Doc(), [diagramId]);

  // Cleanup Y.Doc on diagramId change
  useEffect(() => {
    return () => {
      yDoc.destroy();
    };
  }, [yDoc]);

  // Core effect: IndexedDB + Yjs observation + SVG generation
  useEffect(() => {
    let cancelled = false;
    const currentTheme = resolvedTheme ?? "light";
    const effectCacheKey = `${diagramId}-${currentTheme}`;

    // Helper: generate SVG from current Yjs state
    const generateSvg = async () => {
      if (cancelled) return;
      try {
        const yElements = yDoc.getArray<Y.Map<any>>("elements");
        if (yElements.length === 0) return;

        const elements = yjsToExcalidraw(yElements);
        if (elements.length === 0) return;

        const svg = await exportToSvg({
          elements,
          appState: {
            exportWithDarkMode: isDark,
            exportBackground: false,
          },
          files: null,
        });

        // Make the SVG intrinsically responsive so it scales with its container.
        // exportToSvg sets fixed pixel width/height which prevents CSS scaling.
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.style.width = "100%";
        svg.style.height = "auto";

        if (!cancelled) {
          const svgHtml = svg.outerHTML;
          setLocalSvg(svgHtml);
          svgCache.set(effectCacheKey, {
            svg: svgHtml,
            theme: currentTheme,
            timestamp: Date.now(),
          });
          setIsLocalLoading(false);
        }
      } catch (err) {
        console.error("Failed to generate diagram preview SVG:", err);
        if (!cancelled) setIsLocalLoading(false);
      }
    };

    // Debounced SVG generation for Yjs updates
    const debouncedGenerate = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        void generateSvg();
      }, DEBOUNCE_MS);
    };

    // 1. Set up IndexedDB persistence (instant cached data)
    const persistence = new IndexeddbPersistence(`diagram-${diagramId}`, yDoc);

    persistence.on("synced", () => {
      if (cancelled) return;
      // Generate SVG from IndexedDB data
      void generateSvg();
    });

    // 2. Observe Yjs changes for live updates (triggered by snapshot applies)
    const yElements = yDoc.getArray<Y.Map<any>>("elements");
    const observeHandler = () => {
      debouncedGenerate();
    };
    yElements.observeDeep(observeHandler);

    // Mark as not loading after a timeout if nothing has produced data
    const fallbackTimeout = setTimeout(() => {
      if (!cancelled) setIsLocalLoading(false);
    }, 4000);

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimeout);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      yElements.unobserveDeep(observeHandler);
      void persistence.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramId, resolvedTheme, refreshCounter]);

  // Fetch and apply Convex snapshot when URL changes (reactive live updates)
  useEffect(() => {
    if (!snapshotUrl || snapshotUrl === prevSnapshotUrlRef.current) return;
    prevSnapshotUrlRef.current = snapshotUrl;

    let cancelled = false;
    const applySnapshot = async () => {
      try {
        const response = await fetch(snapshotUrl);
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();
        if (!cancelled) {
          Y.applyUpdate(yDoc, new Uint8Array(arrayBuffer));
        }
      } catch (err) {
        console.warn("Diagram preview: snapshot fetch failed:", err);
      }
    };
    void applySnapshot();

    return () => {
      cancelled = true;
    };
  }, [snapshotUrl, yDoc]);

  const refresh = useCallback(() => {
    // Invalidate cache for this diagram
    svgCache.delete(`${diagramId}-light`);
    svgCache.delete(`${diagramId}-dark`);
    setIsLocalLoading(true);
    setLocalSvg(null);
    prevSnapshotUrlRef.current = null; // Force re-fetch
    setRefreshCounter((c) => c + 1);
  }, [diagramId]);

  const isLoading = diagram === undefined && isLocalLoading;

  return { svgHtml: localSvg, isLoading, isDark, refresh, diagram };
}
