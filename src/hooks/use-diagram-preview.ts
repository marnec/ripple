import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useAction, useConvexAuth } from "convex/react";
import { useTheme } from "next-themes";
import { IndexeddbPersistence } from "y-indexeddb";
import { yjsToExcalidraw } from "y-excalidraw";
import { exportToSvg } from "@excalidraw/excalidraw";
import YPartyKitProvider from "y-partykit/provider";
import * as Y from "yjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

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
 * Creates a single Y.Doc backed by both IndexeddbPersistence (instant cached data)
 * and YPartyKitProvider (live updates). On Yjs changes, debounced exportToSvg
 * regenerates the SVG with the correct theme.
 */
export function useDiagramPreview(
  diagramId: Id<"diagrams">,
): UseDiagramPreviewResult {
  // Convex query for metadata (diagram exists? name?)
  const diagram = useQuery(api.diagrams.get, { id: diagramId });
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { isAuthenticated } = useConvexAuth();
  const getToken = useAction(api.collaboration.getCollaborationToken);

  const [localSvg, setLocalSvg] = useState<string | null>(() => {
    // Check cache on initial render
    const cacheKey = `${diagramId}-${resolvedTheme}`;
    const cached = svgCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.svg;
    }
    return null;
  });
  const [isLocalLoading, setIsLocalLoading] = useState(true);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Refs for cleanup
  const providerRef = useRef<YPartyKitProvider | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable Y.Doc — one per diagramId
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const yDoc = useMemo(() => new Y.Doc(), [diagramId]);

  // Cleanup Y.Doc on diagramId change
  useEffect(() => {
    return () => {
      yDoc.destroy();
    };
  }, [yDoc]);

  // Core effect: IndexedDB + PartyKit + SVG generation
  useEffect(() => {
    let cancelled = false;
    const currentTheme = resolvedTheme ?? "light";
    const cacheKey = `${diagramId}-${currentTheme}`;

    // Check cache first
    const cached = svgCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setLocalSvg(cached.svg);
      setIsLocalLoading(false);
      // Still set up the live connection below for real-time updates
    }

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
          svgCache.set(cacheKey, {
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

    // 2. Observe Yjs changes for live updates
    const yElements = yDoc.getArray<Y.Map<any>>("elements");
    const observeHandler = () => {
      debouncedGenerate();
    };
    yElements.observeDeep(observeHandler);

    // 3. Connect to PartyKit for live sync (if authenticated)
    const connectToParty = async () => {
      if (!isAuthenticated || cancelled) return;

      try {
        const { token } = await getToken({
          resourceType: "diagram",
          resourceId: diagramId,
        });

        if (cancelled) return;

        const host =
          import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";
        const roomId = `diagram-${diagramId}`;

        const provider = new YPartyKitProvider(host, roomId, yDoc, {
          connect: true,
          params: { token },
        });

        providerRef.current = provider;
      } catch (err) {
        // Token fetch failed (no permission, offline, etc.)
        // Silently fall back to IndexedDB only
        console.warn("Diagram preview: could not connect to live room:", err);
        if (!cancelled) setIsLocalLoading(false);
      }
    };

    void connectToParty();

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
      if (providerRef.current) {
        providerRef.current.shouldConnect = false;
        providerRef.current.destroy();
        providerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramId, resolvedTheme, refreshCounter, isAuthenticated]);

  const refresh = useCallback(() => {
    // Invalidate cache for this diagram
    svgCache.delete(`${diagramId}-light`);
    svgCache.delete(`${diagramId}-dark`);
    setIsLocalLoading(true);
    setLocalSvg(null);
    setRefreshCounter((c) => c + 1);
  }, [diagramId]);

  const isLoading = diagram === undefined && isLocalLoading;

  return { svgHtml: localSvg, isLoading, isDark, refresh, diagram };
}
