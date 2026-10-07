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
 * With `onRename`, the title is the rename control: a tap anywhere from the
 * start of the name to the pencil opens `RenameSheet`. The pencil sits at
 * the far end, sized and spaced like the header's icon buttons, so it reads
 * as one more control in that row — a phone has no hover to reveal it. This is how a phone renames a resource — the page body no
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
          {/* `-mr-2` cancels the title area's right padding, so the pencil
              sits one `gap-2` from the next control like its siblings. */}
          <button
            type="button"
            onClick={() => setRenaming(true)}
            aria-label={`Rename ${resourceLabel}: ${name}`}
            className="-mr-2 ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1 truncate text-base font-semibold">{name}</span>
            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center">
              <Pencil className="size-4" />
            </span>
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
