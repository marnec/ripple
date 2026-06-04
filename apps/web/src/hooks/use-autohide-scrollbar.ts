import { useEffect, useState } from "react";

/**
 * Reveals a scroll container's scrollbar only while it is being scrolled, then
 * hides it again after `idleMs` of inactivity — the familiar overlay-scrollbar
 * behaviour that desktop OSes give for free but the web does not.
 *
 * Returns a **callback ref**: spread it onto the scroll element together with
 * the `.scrollbar-autohide` class (see index.css). A callback ref (over a
 * `useRef`) is deliberate — the host often renders a loading placeholder before
 * the real scroll element, and a callback ref re-runs the listener setup if/when
 * the node actually mounts, whereas a `useRef` + mount effect would attach to a
 * node that isn't there yet and never retry.
 */
export function useAutoHideScrollbar<T extends HTMLElement>(idleMs = 900) {
  const [node, setNode] = useState<T | null>(null);

  useEffect(() => {
    if (!node) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      node.setAttribute("data-scrolling", "true");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        node.setAttribute("data-scrolling", "false");
      }, idleMs);
    };

    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [node, idleMs]);

  return setNode;
}
