import { createContext, useContext, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";

const HeaderSlotContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/** Provide the header slot ref — used by Layout to create the portal target. */
export function useHeaderSlotRef() {
  return useRef<HTMLDivElement | null>(null);
}

export { HeaderSlotContext };

/**
 * Render children into the header slot (next to breadcrumb indicators).
 * No-ops if the slot ref isn't mounted.
 */
export function HeaderSlot({ children }: { children: React.ReactNode }) {
  const ref = useContext(HeaderSlotContext);
  if (!ref?.current) return null;
  return createPortal(children, ref.current);
}
