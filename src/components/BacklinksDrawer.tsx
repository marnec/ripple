import { useQuery } from "convex-helpers/react/cache";
import { Link2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { Badge } from "@/components/ui/badge";
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

type Backlink = {
  _id: string;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  edgeType: string;
  workspaceId: string;
  projectId?: string;
};

const EDGE_TYPE_LABELS: Record<string, string> = {
  embeds: "Embedded",
  blocks: "Blocks",
  relates_to: "Related",
  mentions: "Mentioned",
};

function getSourceLink(ref: Backlink): string {
  if (ref.sourceType === "document") {
    return `/workspaces/${ref.workspaceId}/documents/${ref.sourceId}`;
  }
  if (ref.sourceType === "task" && ref.projectId) {
    return `/workspaces/${ref.workspaceId}/projects/${ref.projectId}/tasks/${ref.sourceId}`;
  }
  if (ref.sourceType === "diagram") {
    return `/workspaces/${ref.workspaceId}/diagrams/${ref.sourceId}`;
  }
  if (ref.sourceType === "spreadsheet") {
    return `/workspaces/${ref.workspaceId}/spreadsheets/${ref.sourceId}`;
  }
  return "#";
}

function BacklinksList({ backlinks }: { backlinks: Backlink[] }) {
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

/** Small trigger button for pages that don't have an existing references toggle. */
export function BacklinksDrawerTrigger({
  resourceId,
  workspaceId,
}: {
  resourceId: string;
  workspaceId: Id<"workspaces">;
}) {
  const backlinks = useQuery(api.edges.getBacklinks, {
    targetId: resourceId,
    workspaceId,
  });
  const [open, setOpen] = useState(false);

  if (!backlinks || backlinks.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        title="Show references"
      >
        <Link2 className="h-3.5 w-3.5" />
        <Badge
          variant="secondary"
          className="h-4 px-1 text-[10px] font-mono tabular-nums"
        >
          {backlinks.length}
        </Badge>
      </button>
      <BacklinksDrawer
        resourceId={resourceId}
        workspaceId={workspaceId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
