import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, Theme } from "@excalidraw/excalidraw/element/types";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { orderFrames } from "./frames";

interface PresentationOverlayProps {
  /** Scene snapshot captured when entering presentation mode. */
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  theme: Theme;
  onClose: () => void;
}

/**
 * Fullscreen slideshow over a diagram's Excalidraw frames. Each frame is a
 * slide; the camera animates to fill the viewport with the active frame. Read
 * navigation only — the scene is a static snapshot (view mode), so edits made
 * while presenting are not reflected until the deck is reopened. Diagrams with
 * no frames present as a single fit-to-content slide.
 */
export function PresentationOverlay({ elements, files, theme, onClose }: PresentationOverlayProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [index, setIndex] = useState(0);

  const frames = orderFrames(elements);
  const slideCount = Math.max(frames.length, 1);

  const goTo = (next: number) => setIndex(Math.min(Math.max(next, 0), slideCount - 1));

  // Whether the first slide has been positioned yet. The initial placement is
  // snapped (no animation); only subsequent slide changes animate.
  const positionedRef = useRef(false);

  // Move the camera to the active slide. fitToViewport fills ~92% of the
  // screen with the frame, or the whole scene when there are no frames.
  useEffect(() => {
    if (!api) return;
    // Target the active frame, or the entire snapshot when the diagram has no
    // frames — a frameless deck is one fit-to-content slide. (Relying on
    // scrollToContent's default arg here is unsafe: passing an explicit target
    // keeps the camera correct regardless of what's in the scene.)
    const target = frames[index] ?? elements;

    let raf = 0;
    let cancelled = false;
    const fit = () => {
      if (cancelled || !api) return;
      // Excalidraw measures its canvas via a ResizeObserver *after* mount, so
      // on the very first frame the fullscreen container still reports a 0×0
      // viewport. Fitting then divides by a zero-size viewport and flings the
      // content off-screen (the "ghost" sliding out during the crossfade, and
      // an empty viewport for a single-slide deck). Wait for real dimensions.
      const { width, height } = api.getAppState();
      if (!width || !height) {
        raf = requestAnimationFrame(fit);
        return;
      }
      api.scrollToContent(target, {
        fitToViewport: true,
        viewportZoomFactor: 0.92,
        // Snap the first slide into place; animate only when navigating, so the
        // entrance doesn't visibly pan from Excalidraw's default top-left camera.
        animate: positionedRef.current,
        duration: 350,
      });
      positionedRef.current = true;
    };
    raf = requestAnimationFrame(fit);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [api, index, frames, elements]);

  useEffect(() => {
    const clamp = (n: number) => Math.min(Math.max(n, 0), slideCount - 1);
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
          e.preventDefault();
          setIndex((i) => clamp(i + 1));
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          e.preventDefault();
          setIndex((i) => clamp(i - 1));
          break;
        case "Home":
          e.preventDefault();
          setIndex(0);
          break;
        case "End":
          e.preventDefault();
          setIndex(slideCount - 1);
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    };
    // Capture phase: Excalidraw stops propagation of keys like Escape on its
    // own container, so a bubble-phase window listener never sees them.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [slideCount, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-background animate-fade-in">
      <style>{`
        .presentation-canvas .excalidraw .App-menu,
        .presentation-canvas .excalidraw .App-toolbar,
        .presentation-canvas .excalidraw .layer-ui__wrapper__top-right,
        .presentation-canvas .excalidraw .zoom-actions,
        .presentation-canvas .excalidraw .scroll-back-to-content { display: none !important; }
      `}</style>

      <div className="presentation-canvas h-full w-full">
        <Excalidraw
          excalidrawAPI={setApi}
          theme={theme}
          viewModeEnabled={true}
          zenModeEnabled={true}
          initialData={{
            elements,
            files,
            appState: {
              viewBackgroundColor: "transparent",
              // Show frame contents without the editing chrome.
              frameRendering: { enabled: true, name: false, outline: false, clip: true },
            },
          }}
          UIOptions={{ canvasActions: { changeViewBackgroundColor: false } }}
        />
      </div>

      {/* Controls — must sit above Excalidraw's canvas/UI layers, which
          otherwise intercept the clicks. The wrapper is click-through so the
          slide area stays interactive; the buttons opt back in. */}
      <div className="pointer-events-none absolute inset-0 z-60">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Exit presentation"
          className="pointer-events-auto absolute right-4 top-4 bg-background/70 backdrop-blur"
        >
          <X className="size-5" />
        </Button>

        <div className="pointer-events-auto absolute inset-x-0 bottom-6 flex items-center justify-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            aria-label="Previous slide"
            className="bg-background/70 backdrop-blur"
          >
            <ChevronLeft className="size-5" />
          </Button>
          <span className="min-w-16 rounded-md bg-background/70 px-3 py-1.5 text-center text-sm tabular-nums backdrop-blur">
            {index + 1} / {slideCount}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => goTo(index + 1)}
            disabled={index === slideCount - 1}
            aria-label="Next slide"
            className="bg-background/70 backdrop-blur"
          >
            <ChevronRight className="size-5" />
          </Button>
          {frames.length === 0 && (
            // The whole diagram is one fallback slide — tell the user how to
            // turn it into a real deck.
            <span className="rounded-md bg-background/70 px-3 py-1.5 text-sm text-muted-foreground backdrop-blur">
              Add frames to the diagram to create slides
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
