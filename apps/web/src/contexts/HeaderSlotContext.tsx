/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";

const HeaderSlotContext = createContext<HTMLDivElement | null>(null);
const HeaderTitleSlotContext = createContext<HTMLDivElement | null>(null);

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

export function useHeaderTitleSlotRef() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const callbackRef = (el: HTMLDivElement | null) => {
    setNode(el);
  };
  return [callbackRef, node] as const;
}

export { HeaderSlotContext, HeaderTitleSlotContext };

/**
 * Render children into the header slot (next to breadcrumb indicators).
 * No-ops if the slot isn't mounted.
 */
export function HeaderSlot({ children }: { children: React.ReactNode }) {
  const node = useContext(HeaderSlotContext);
  if (!node) return null;
  return createPortal(children, node);
}

/**
 * Render children into the header title slot (replaces the breadcrumb on
 * mobile when present). No-ops if the slot isn't mounted.
 */
export function HeaderTitleSlot({ children }: { children: React.ReactNode }) {
  const node = useContext(HeaderTitleSlotContext);
  if (!node) return null;
  return createPortal(children, node);
}

/**
 * Standard mobile header title for a resource page: an optional accent node
 * (e.g. color tag, icon) followed by the resource name with consistent
 * styling. Renders nothing when the title slot isn't mounted (desktop) or
 * when no name is provided yet.
 */
export function MobileHeaderTitle({
  name,
  accent,
}: {
  name: string | undefined;
  accent?: React.ReactNode;
}) {
  if (!name) return null;
  return (
    <HeaderTitleSlot>
      {accent}
      <span className="text-base font-semibold truncate ml-2">{name}</span>
    </HeaderTitleSlot>
  );
}
