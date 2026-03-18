/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";

const HeaderSlotContext = createContext<HTMLDivElement | null>(null);

/**
 * Provide a callback ref for the header slot target element.
 * Used by Layout to create the portal target.
 */
export function useHeaderSlotRef() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const callbackRef = (el: HTMLDivElement | null) => {
    setNode(el);
  };
  return [callbackRef, node] as const;
}

export { HeaderSlotContext };

/**
 * Render children into the header slot (next to breadcrumb indicators).
 * No-ops if the slot isn't mounted.
 */
export function HeaderSlot({ children }: { children: React.ReactNode }) {
  const node = useContext(HeaderSlotContext);
  if (!node) return null;
  return createPortal(children, node);
}
