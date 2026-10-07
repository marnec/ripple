/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil } from "lucide-react";
import { RenameSheet } from "@/components/RenameSheet";

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
 *
 * With `onRename`, the title is the rename control: a tap opens
 * `RenameSheet`. A small pencil marks it, since a phone has no hover to
 * reveal one. This is how a phone renames a resource — the page body no
 * longer repeats the title in an editable field of its own.
 */
export function MobileHeaderTitle({
  name,
  accent,
  onRename,
  resourceLabel = "item",
}: {
  name: string | undefined;
  accent?: React.ReactNode;
  onRename?: (name: string) => Promise<unknown> | void;
  /** Names the rename sheet: "Rename task". */
  resourceLabel?: string;
}) {
  const [renaming, setRenaming] = useState(false);
  if (!name) return null;
  return (
    <HeaderTitleSlot>
      {accent}
      {onRename ? (
        <>
          <button
            type="button"
            onClick={() => setRenaming(true)}
            aria-label={`Rename ${resourceLabel}: ${name}`}
            className="ml-2 flex min-w-0 items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate text-base font-semibold">{name}</span>
            <Pencil aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
          <RenameSheet
            open={renaming}
            onOpenChange={setRenaming}
            value={name}
            onRename={onRename}
            resourceLabel={resourceLabel}
          />
        </>
      ) : (
        <span className="text-base font-semibold truncate ml-2">{name}</span>
      )}
    </HeaderTitleSlot>
  );
}
