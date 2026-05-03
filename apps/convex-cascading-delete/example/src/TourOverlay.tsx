import { useState, useEffect, useRef, useCallback } from "react";
import "./Tour.css";

const TOUR_STEPS = [
  {
    title: "Welcome to Cascading Delete",
    text: "Let's walk through how to use this component in 30 seconds.",
  },
  {
    title: "Step 1: Switch to Demo",
    text: 'Click the "Demo" tab to see cascading deletes in action.',
  },
  {
    title: "Step 2: Create Sample Data",
    text: 'Click "Seed Sample Data" to create an organizational hierarchy.',
  },
  {
    title: "Step 3: Try Inline Delete",
    text: 'Click "Delete (Inline)" on any organization to delete it and all related documents in one transaction.',
  },
  {
    title: "Step 4: Try Batched Delete",
    text: 'Click "Delete (Batched)" to see background batch processing with progress tracking.',
  },
];

interface TourOverlayProps {
  tourStep: number;
  setTourStep: (step: number) => void;
  skipTour: () => void;
  demoTabRef: React.RefObject<HTMLButtonElement | null>;
  seedBtnRef: React.RefObject<HTMLButtonElement | null>;
  firstInlineBtnRef: React.RefObject<HTMLButtonElement | null>;
  firstBatchedBtnRef: React.RefObject<HTMLButtonElement | null>;
  organizationsLength?: number;
}

export function TourOverlay({
  tourStep,
  setTourStep,
  skipTour,
  demoTabRef,
  seedBtnRef,
  firstInlineBtnRef,
  firstBatchedBtnRef,
  organizationsLength,
}: TourOverlayProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [positionedForStep, setPositionedForStep] = useState(-1);
  const [highlightStyle, setHighlightStyle] = useState<React.CSSProperties>({});
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const [arrowLeft, setArrowLeft] = useState(0);
  const [placement, setPlacement] = useState<"above" | "below">("below");

  const updateTourPosition = useCallback(() => {
    const refs: Record<number, React.RefObject<HTMLElement | null>> = {
      1: demoTabRef,
      2: seedBtnRef,
      3: firstInlineBtnRef,
      4: firstBatchedBtnRef,
    };
    const ref = refs[tourStep];
    if (!ref?.current) return;

    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    const gap = 20;

    setHighlightStyle({
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    });

    const tooltipW = 380;
    let tLeft = rect.left + rect.width / 2 - tooltipW / 2;
    tLeft = Math.max(16, Math.min(tLeft, window.innerWidth - tooltipW - 16));

    const tooltipH = tooltipRef.current?.offsetHeight ?? 220;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;

    let newPlacement: "above" | "below";
    let tTop: number;

    if (spaceBelow >= tooltipH) {
      newPlacement = "below";
      tTop = rect.bottom + gap;
    } else if (spaceAbove >= tooltipH) {
      newPlacement = "above";
      tTop = rect.top - gap - tooltipH;
    } else {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
      newPlacement = "below";
      tTop = rect.bottom + gap;
    }

    setPositionedForStep(tourStep);
    setPlacement(newPlacement);
    setTooltipStyle({ top: tTop, left: tLeft, width: tooltipW });
    setArrowLeft(rect.left + rect.width / 2 - tLeft - 10);
  }, [tourStep, demoTabRef, seedBtnRef, firstInlineBtnRef, firstBatchedBtnRef]);

  useEffect(() => {
    if (tourStep <= 0) return;
    const timer = setTimeout(updateTourPosition, 150);
    window.addEventListener("resize", updateTourPosition);
    window.addEventListener("scroll", updateTourPosition, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateTourPosition);
      window.removeEventListener("scroll", updateTourPosition, true);
    };
  }, [tourStep, updateTourPosition, organizationsLength]);

  const hasHighlight =
    tourStep > 0 &&
    positionedForStep === tourStep &&
    Object.keys(highlightStyle).length > 0;

  useEffect(() => {
    if (hasHighlight && tooltipRef.current) {
      requestAnimationFrame(updateTourPosition);
    }
  }, [hasHighlight, updateTourPosition]);

  if (tourStep < 0) return null;

  return (
    <div className="tour-overlay">
      {tourStep === 0 && <div className="tour-backdrop" onClick={skipTour} />}
      {hasHighlight && (
        <div className="tour-highlight" style={highlightStyle} />
      )}
      {tourStep === 0 ? (
        <div className="tour-tooltip tour-centered">
          <h3 className="tour-title">{TOUR_STEPS[0].title}</h3>
          <p className="tour-text">{TOUR_STEPS[0].text}</p>
          <div className="tour-progress">
            {TOUR_STEPS.map((_, i) => (
              <div key={i} className={`tour-dot ${i === 0 ? "active" : ""}`} />
            ))}
          </div>
          <div className="tour-buttons">
            <button className="tour-skip" onClick={skipTour}>
              Skip Tour
            </button>
            <button className="tour-next" onClick={() => setTourStep(1)}>
              Next
            </button>
          </div>
        </div>
      ) : hasHighlight ? (
        <div ref={tooltipRef} className="tour-tooltip" style={tooltipStyle}>
          <div
            className={placement === "below" ? "tour-arrow" : "tour-arrow-down"}
            style={{ left: arrowLeft }}
          />
          <h3 className="tour-title">{TOUR_STEPS[tourStep].title}</h3>
          <p className="tour-text">{TOUR_STEPS[tourStep].text}</p>
          <div className="tour-progress">
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                className={`tour-dot ${
                  i === tourStep ? "active" : i < tourStep ? "completed" : ""
                }`}
              />
            ))}
          </div>
          <button className="tour-skip" onClick={skipTour}>
            Skip Tour
          </button>
        </div>
      ) : null}
    </div>
  );
}
