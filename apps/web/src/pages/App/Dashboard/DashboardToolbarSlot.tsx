import type { ReactNode } from "react";
import { useContext } from "react";
import { createPortal } from "react-dom";

import { DashboardToolbarSlotContext } from "./dashboard-toolbar-context";

/** Render children into the dashboard toolbar, left of the tab switch. */
export function DashboardToolbarSlot({ children }: { children: ReactNode }) {
  const node = useContext(DashboardToolbarSlotContext);
  if (!node) return null;
  return createPortal(children, node);
}
