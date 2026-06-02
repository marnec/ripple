"use client";

import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { Theme } from "@excalidraw/excalidraw/element/types";
import { generateNKeysBetween } from "fractional-indexing";
import { Frame } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExcalidrawBinding, yjsToExcalidraw } from "y-excalidraw";
import type { Awareness } from "y-protocols/awareness";
import type YProvider from "y-partyserver/provider";
import * as Y from "yjs";


interface ImportedScene {
  elements: readonly unknown[];
  files: Record<string, unknown>;
}

interface ExcalidrawEditorProps {
  yElements: Y.Array<Y.Map<any>>;
  yAssets: Y.Map<any>;
  awareness: Awareness | null;
  provider: YProvider | null;
  onExcalidrawAPI: (api: ExcalidrawImperativeAPI) => void;
  viewModeEnabled?: boolean;
  importedScene?: ImportedScene | null;
}

export function ExcalidrawEditor({
  yElements,
  yAssets,
  awareness,
  provider,
  onExcalidrawAPI,
  viewModeEnabled,
  importedScene,
}: ExcalidrawEditorProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI>();
  const { resolvedTheme } = useTheme();
  const bindingRef = useRef<ExcalidrawBinding | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Seed an imported .excalidraw upload synchronously during first render,
  // BEFORE Excalidraw mounts. Excalidraw's internal initializeScene runs more
  // than once and resets the scene from initialData each time
  // (excalidraw/excalidraw#7585), so anything injected via updateScene after
  // mount gets wiped. Putting elements into yElements before render means
  // initialData={ elements: yjsToExcalidraw(yElements) } already contains the
  // imported scene, and every initializeScene re-run lands on it.
  // useState's lazy initializer is the standard one-shot pre-render hook.
  useState(() => {
    if (
      !importedScene ||
      yElements.length !== 0 ||
      importedScene.elements.length === 0
    ) {
      return null;
    }
    const positions = generateNKeysBetween(
      null,
      null,
      importedScene.elements.length,
    );
    const doc = yElements.doc;
    const seed = () => {
      importedScene.elements.forEach((el, i) => {
        yElements.push([
          new Y.Map<unknown>(
            Object.entries({ pos: positions[i], el }),
          ) as Y.Map<any>,
        ]);
      });
      for (const [fileId, file] of Object.entries(importedScene.files)) {
        yAssets.set(fileId, file);
      }
    };
    if (doc) doc.transact(seed);
    else seed();
    window.history.replaceState({}, "");
    return null;
  });

  // Notify parent directly in callback (event handler, not effect)
  const handleExcalidrawAPI = (api: ExcalidrawImperativeAPI) => {
    setExcalidrawAPI(api);
    onExcalidrawAPI(api);
  };

  // Set up y-excalidraw binding — it handles:
  // - Bidirectional element/asset sync
  // - Awareness → Excalidraw collaborators map (cursors, selections)
  // - selectedElementIds → awareness (on onChange)
  useEffect(() => {
    if (!excalidrawAPI || !provider || !yElements || !yAssets || !awareness) return;

    const binding = new ExcalidrawBinding(
      yElements,
      yAssets,
      excalidrawAPI,
      provider.awareness
    );
    bindingRef.current = binding;

    return () => {
      binding.destroy();
      bindingRef.current = null;
    };
  }, [excalidrawAPI, provider, yElements, yAssets, awareness]);

  // Fit the diagram into view once on open. yElements may be empty at mount
  // if the user is opening a diagram cold (no IndexedDB cache) — in that case
  // wait for the first provider-sync update.
  // The canvas stays hidden (opacity-0) until the fit lands so the user
  // doesn't see a flash of default zoom/scroll before the fit applies.
  const fittedOnOpenRef = useRef(false);
  // Empty at mount → reveal immediately so the user can interact with the
  // blank canvas; if content arrives later via collab, the observer below
  // will fit it. Non-empty at mount → start hidden, the rAF in fit() reveals.
  const [isReady, setIsReady] = useState(() => yElements.length === 0);
  useEffect(() => {
    if (!excalidrawAPI || fittedOnOpenRef.current) return;

    const fit = () => {
      if (fittedOnOpenRef.current || yElements.length === 0) return;
      fittedOnOpenRef.current = true;
      requestAnimationFrame(() => {
        excalidrawAPI.scrollToContent(undefined, { fitToContent: true });
        requestAnimationFrame(() => setIsReady(true));
      });
    };

    fit();
    if (fittedOnOpenRef.current) return;

    const observer = () => fit();
    yElements.observe(observer);
    return () => yElements.unobserve(observer);
  }, [excalidrawAPI, yElements]);

  // Broadcast pointer position to other users via awareness
  // (The binding exposes onPointerUpdate but doesn't auto-connect it)
  const handlePointerUpdate = (payload: { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "down" | "up" }) => {
    if (bindingRef.current) {
      bindingRef.current.onPointerUpdate(payload);
    }
  };

  // Frame tool button injected into Excalidraw's native toolbar.
  // Excalidraw exposes no API to add a tool to its shapes toolbar, and the
  // Frame tool otherwise only lives in the hidden "more tools" dropdown. We
  // keep one <span> slot anchored where that trigger sits (right end of the
  // toolbar) and render a React button into it via a portal. A MutationObserver
  // re-attaches the slot if Excalidraw re-renders/remounts the toolbar.
  const frameSlotRef = useRef<HTMLSpanElement | null>(null);
  const [frameSlot, setFrameSlot] = useState<HTMLElement | null>(null);
  const [frameActive, setFrameActive] = useState(false);
  useEffect(() => {
    const container = rootRef.current;
    if (!excalidrawAPI || !container) return;

    if (!frameSlotRef.current) {
      const span = document.createElement("span");
      span.className = "ripple-frame-tool-slot";
      span.style.display = "contents";
      frameSlotRef.current = span;
    }
    const slot = frameSlotRef.current;

    const ensureSlot = () => {
      // The (hidden) native trigger marks the correct toolbar slot; place our
      // button right after it so it lands at the toolbar's right edge.
      const trigger = container.querySelector(".App-toolbar__extra-tools-trigger");
      const parent = trigger?.parentElement;
      if (parent && slot.parentElement !== parent) {
        parent.appendChild(slot);
        setFrameSlot(slot);
      }
    };
    ensureSlot();

    const observer = new MutationObserver(ensureSlot);
    observer.observe(container, { childList: true, subtree: true });

    const unsubscribe = excalidrawAPI.onChange(() => {
      setFrameActive(excalidrawAPI.getAppState().activeTool.type === "frame");
    });

    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, [excalidrawAPI]);

  return (
    <div
      ref={rootRef}
      className={`relative h-full w-full overflow-hidden transition-opacity duration-200 ${
        isReady ? "opacity-100" : "opacity-0"
      }`}
    >
      <style>{`
        /* The native "more tools" trigger is replaced by our own Frame button
           injected into the same toolbar slot (see frame-tool injection). */
        .excalidraw .App-toolbar__extra-tools-trigger { display: none !important; }
        .excalidraw .ToolIcon__LaserPointer { display: none !important; }
        .excalidraw .default-sidebar-trigger { display: none !important; }
        .excalidraw .UserList__wrapper { display: none !important; }
        .excalidraw .zoom-actions { display: none !important; }
        .excalidraw .undo-redo-buttons { display: none !important; }
        .excalidraw .HelpButton { display: none !important; }
        /* Reset the injected button so only the .ToolIcon__icon box shows,
           matching the native shape tools. */
        .ripple-frame-tool { background: none; border: none; padding: 0; cursor: pointer; font: inherit; }

        /* ── Ripple theme for Excalidraw ──────────────────────────────────
           Repaint Excalidraw's panels/menus with Ripple's sidebar background
           and swap its purple brand for the app's blue (matches bg-blue-500).
           Specificity notes: Excalidraw's light defaults live under
           ".excalidraw" (0,1,0) and dark under ".excalidraw.theme--dark"
           (0,2,0); only theme--dark is applied in dark mode. We double the
           class for the base block to win in light, and target theme--dark
           (placed later) to win in dark. Backgrounds reference Ripple's own
           theme-aware vars so they track light/dark automatically. */
        .excalidraw.excalidraw {
          --island-bg-color: var(--color-sidebar);
          --color-surface-low: var(--color-sidebar);
          --color-surface-mid: var(--color-sidebar);
          --color-surface-high: var(--color-sidebar-accent); /* menu-item hover */

          --color-primary: #3b82f6;            /* blue-500 */
          --color-primary-darker: #2563eb;     /* blue-600 (hover) */
          --color-primary-darkest: #1d4ed8;    /* blue-700 (active) */
          --color-primary-hover: #2563eb;
          --color-primary-light: #dbeafe;      /* blue-100 (selected tint) */
          --color-primary-light-darker: #bfdbfe; /* blue-200 */
          --color-brand-hover: #2563eb;
          --color-brand-active: #1d4ed8;
          --color-surface-primary-container: #dbeafe;
        }
        .excalidraw.theme--dark {
          --island-bg-color: var(--color-sidebar);
          --color-surface-low: var(--color-sidebar);
          --color-surface-mid: var(--color-sidebar);
          --color-surface-high: var(--color-sidebar-accent);

          --color-primary: #60a5fa;            /* blue-400 */
          --color-primary-darker: #93c5fd;     /* blue-300 (Excalidraw lightens on hover in dark) */
          --color-primary-darkest: #bfdbfe;    /* blue-200 */
          --color-primary-hover: #93c5fd;
          --color-primary-light: #1e3a8a;      /* blue-900 (selected tint) */
          --color-primary-light-darker: #1e40af; /* blue-800 */
          --color-brand-hover: #93c5fd;
          --color-brand-active: #bfdbfe;
          --color-surface-primary-container: #1e3a8a;
        }
      `}</style>

      <Excalidraw
        excalidrawAPI={handleExcalidrawAPI}
        isCollaborating={true}
        theme={resolvedTheme as Theme}
        initialData={{
          elements: yElements ? yjsToExcalidraw(yElements) : [],
          appState: { viewBackgroundColor: "transparent" },
        }}
        onPointerUpdate={handlePointerUpdate}
        viewModeEnabled={viewModeEnabled}
        validateEmbeddable={false}
        aiEnabled={false}
        UIOptions={{
          tools: { image: false, eraser: false } as { image: boolean } & Record<string, boolean>,
          canvasActions: {
            changeViewBackgroundColor: false,
            loadScene: false,
            export: {
              saveFileToDisk: true,
            },
          },
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SaveToActiveFile />
        </MainMenu>
      </Excalidraw>

      {frameSlot &&
        !viewModeEnabled &&
        createPortal(
          <button
            type="button"
            className={`ToolIcon ToolIcon_size_medium ripple-frame-tool${frameActive ? " ToolIcon--selected" : ""}`}
            title="Frame — F"
            aria-label="Frame"
            aria-pressed={frameActive}
            onClick={() => excalidrawAPI?.setActiveTool({ type: "frame" })}
          >
            <div className="ToolIcon__icon" aria-hidden="true">
              <Frame size={16} strokeWidth={1.5} />
              <span className="ToolIcon__keybinding">F</span>
            </div>
          </button>,
          frameSlot,
        )}
    </div>
  );
}
