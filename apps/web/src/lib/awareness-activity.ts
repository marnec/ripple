import type { Awareness } from "y-protocols/awareness";

/**
 * Self-reported presence activity.
 *
 * Whether a collaborator is *present* is a transport question — their socket is
 * open, so their awareness entry exists. Whether they are *available* is a
 * different question, and only their own browser can answer it: peers can't
 * tell "reading quietly" from "closed the laptop", and inferring it from "have
 * I received an edit recently" wrongly retires people who are just still.
 *
 * So each client publishes its own `activity` field into awareness. Peers read
 * it; nobody guesses. Clients that don't publish it (an older bundle mid-deploy)
 * simply read as active.
 */

/** No pointer/keyboard input for this long, while visible, reads as idle. */
export const IDLE_AFTER_MS = 120_000;

const PUBLISH_INTERVAL_MS = 5_000;

const INPUT_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
] as const;

export interface ActivitySignal {
  idle: boolean;
}

export function computeIdle(input: {
  documentHidden: boolean;
  lastInputAt: number;
  now: number;
  idleAfterMs?: number;
}): boolean {
  // A hidden tab is a certainty, not an inference — report it immediately
  // rather than waiting out the input timeout.
  if (input.documentHidden) return true;
  return input.now - input.lastInputAt > (input.idleAfterMs ?? IDLE_AFTER_MS);
}

// Input is a property of the page, not of any one document, so the listeners
// are installed once and shared by every provider mounted on it.
let lastInputAt = Date.now();
let trackerCount = 0;

const noteInput = () => {
  lastInputAt = Date.now();
};

function trackInput(): () => void {
  trackerCount += 1;
  if (trackerCount === 1) {
    for (const event of INPUT_EVENTS) {
      window.addEventListener(event, noteInput, { passive: true, capture: true });
    }
  }
  return () => {
    trackerCount -= 1;
    if (trackerCount === 0) {
      for (const event of INPUT_EVENTS) {
        window.removeEventListener(event, noteInput, { capture: true });
      }
    }
  };
}

/**
 * Publish this client's activity into awareness and keep it current.
 * Returns a stop function.
 */
export function startActivityReporting(awareness: Awareness): () => void {
  const stopTrackingInput = trackInput();
  let published: boolean | null = null;

  const publish = () => {
    // setLocalStateField no-ops while local state is null (before the editor
    // has published its user), so don't record what we didn't manage to send.
    if (awareness.getLocalState() === null) return;

    const idle = computeIdle({
      documentHidden: document.visibilityState === "hidden",
      lastInputAt,
      now: Date.now(),
    });
    if (idle === published) return;

    published = idle;
    const signal: ActivitySignal = { idle };
    awareness.setLocalStateField("activity", signal);
  };

  // Hiding a tab throttles its timers, so both edges have to be published from
  // the event itself — the interval can't be relied on to catch them.
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") noteInput();
    publish();
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  const interval = setInterval(publish, PUBLISH_INTERVAL_MS);
  publish();

  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    stopTrackingInput();
  };
}
