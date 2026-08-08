import { useEffect } from "react";
import { RippleLogoCanvas } from "@/components/RippleLogoCanvas";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  // The app shell pins `body` to `height: 100svh; overflow: hidden`, which left
  // this page with no scroll container at all — on a short phone everything past
  // the fold was clipped away with no way to reach it. Auth pages are documents,
  // not app shell, so they opt back into scrolling the *root* rather than
  // introducing a nested scroller: browsers only retract the URL bar for the
  // root scroller, and Chrome refuses to promote a nested one whose ancestor
  // clips. Root scrolling also keeps native scroll-into-view on input focus,
  // which is what moves a focused field clear of the virtual keyboard.
  //
  // Scrolling here is the safety net, though. The layout below is built so it
  // isn't needed on any real phone.
  useEffect(() => {
    document.body.classList.add("document-scroll");
    return () => document.body.classList.remove("document-scroll");
  }, []);

  return (
    // min-h-svh, not dvh: the small viewport is the toolbar-expanded height, so
    // the page is laid out once for the worst case instead of reflowing as the
    // toolbar animates away.
    <div
      className="relative min-h-svh flex flex-col items-center justify-center bg-black text-white px-4 sm:px-8 [--gutter:1rem] squat:[--gutter:0.5rem] sm:[--gutter:2rem]"
      style={{
        paddingTop: "calc(var(--gutter) + var(--safe-area-top))",
        paddingBottom: "calc(var(--gutter) + var(--safe-area-bottom))",
      }}
    >
      <div className="fixed inset-0 opacity-[0.03] pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />
      </div>

      {/* The mark is the only thing on this page that can yield, so it does:
          this box takes whatever the form leaves over, up to its cap, and
          collapses toward zero as the viewport shortens. The form is never the
          thing that gives, so it never has to scroll to stay whole. The box
          doubles as the gap above the form and shrinks with it. */}
      <div className="relative w-full max-w-100 flex-1 min-h-0 max-h-56 overflow-hidden">
        {/* The artwork occupies only the middle ~55% of the shader's canvas, so
            the canvas is oversized and centre-cropped to trim the transparent
            margin. This is what the old fixed `-mb-16` did, expressed as a ratio
            so it survives every size the box gets resized to. Absolute
            positioning is load-bearing: as a flex child the canvas would size
            from its intrinsic 300px instead of the box. */}
        <RippleLogoCanvas className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[150%] aspect-square text-white" />
      </div>

      <div className="relative w-full max-w-100 shrink-0">{children}</div>
    </div>
  );
}
