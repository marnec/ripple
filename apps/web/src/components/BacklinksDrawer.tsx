import { useQuery } from "convex-helpers/react/cache";
import { Link2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { getSourceLink, type Reference } from "@/components/embed-references";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

type BacklinksDrawerProps = {
  resourceId: string;
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EDGE_TYPE_LABELS: Record<string, string> = {
  embeds: "Embedded",
  blocks: "Blocks",
  relates_to: "Related",
  mentions: "Mentioned",
};

function BacklinksList({ backlinks }: { backlinks: Reference[] }) {
  if (backlinks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No references found
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {backlinks.map((ref) => {
        const Icon =
          RESOURCE_TYPE_ICONS[ref.sourceType] ?? RESOURCE_TYPE_ICONS.document;
        const edgeLabel = EDGE_TYPE_LABELS[ref.edgeType] ?? ref.edgeType;
        return (
          <li key={ref._id}>
            <Link
              to={getSourceLink(ref)}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
            >
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">{ref.sourceName}</span>
              <span className="ml-auto text-muted-foreground text-[11px] shrink-0">
                {edgeLabel}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function BacklinksDrawer({
  resourceId,
  workspaceId,
  open,
  onOpenChange,
}: BacklinksDrawerProps) {
  const backlinks = useQuery(
    api.edges.getBacklinks,
    open ? { targetId: resourceId, workspaceId } : "skip",
  );
  const isMobile = useIsMobile();

  const count = backlinks?.length ?? 0;
  const title = (
    <span className="flex items-center gap-2">
      Referenced in
      {count > 0 && (
        <Badge
          variant="secondary"
          className="h-5 px-1.5 text-[11px] font-mono tabular-nums"
        >
          {count}
        </Badge>
      )}
    </span>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto max-h-[60vh]">
            <BacklinksList backlinks={backlinks ?? []} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4 overflow-y-auto flex-1">
          <BacklinksList backlinks={backlinks ?? []} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Toolbar toggle for a resource's references, shared by the document, diagram
 * and spreadsheet headers. Disabled — not hidden — when nothing references the
 * resource, so the control keeps a stable position in every toolbar.
 */
export function BacklinksButton({
  resourceId,
  workspaceId,
  onOpenChange,
}: {
  resourceId: string;
  workspaceId: Id<"workspaces">;
  /** Notified on every toggle, for pages that mirror the state (e.g. spreadsheet cell highlights). */
  onOpenChange?: (open: boolean) => void;
}) {
  const backlinks = useQuery(api.edges.getBacklinks, {
    targetId: resourceId,
    workspaceId,
  });
  const [open, setOpen] = useState(false);
  const count = backlinks?.length ?? 0;
  const hasBacklinks = count > 0;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(!open)}
        disabled={!hasBacklinks}
        aria-pressed={open}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md p-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none",
          open
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
        title={
          !hasBacklinks
            ? "No references"
            : open
              ? "Hide references"
              : "Show references"
        }
      >
        <Link2 className="size-4" />
        {hasBacklinks && (
          <Badge
            variant="secondary"
            className="h-4 px-1 text-[10px] font-mono tabular-nums"
          >
            {count}
          </Badge>
        )}
      </button>
      <BacklinksDrawer
        resourceId={resourceId}
        workspaceId={workspaceId}
        open={open}
        onOpenChange={handleOpenChange}
      />
    </>
  );
}
