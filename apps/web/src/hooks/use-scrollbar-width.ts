import { useEffect, useState } from "react";

/**
 * The width a scroll container's vertical scrollbar currently takes out of its
 * content box — 0 while it doesn't overflow, or where scrollbars overlay.
 *
 * The gutter's width depends on browser, OS and `scrollbar-width`, so it can't
 * be compensated in CSS. Subtract it from the container's right padding to
 * keep its content flush with siblings outside the scroll container (a toolbar
 * above a list) whether or not the scrollbar is showing.
 *
 * Returns a callback ref (see `use-autohide-scrollbar` for why) and the width.
 */
export function useScrollbarWidth<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!node) return;
    // The scrollbar appearing shrinks the content box without changing the
    // border box — a content-box ResizeObserver (the default) catches it.
    const measure = () => setWidth(node.offsetWidth - node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, width] as const;
}
