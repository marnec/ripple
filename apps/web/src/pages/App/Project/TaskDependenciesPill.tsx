import { ArrowLeft, Ban, Link2, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@ripple/ui/components/button";
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatTaskId } from "@/lib/task-utils";
import { cn } from "@/lib/utils";
import { DependencyGroup } from "./TaskDependencies";
import { type DependencyType, useTaskDependencies } from "./useTaskDependencies";

// Same icon and colour per relation as the groups the dependencies are
// listed under, so the tab you pick is the group the task lands in.
const RELATIONS: Array<{ value: DependencyType; label: string; icon: ReactNode }> = [
  { value: "is_blocked_by", label: "Blocked by", icon: <Ban className="h-3 w-3 text-red-500" /> },
  { value: "blocks", label: "Blocks", icon: <Ban className="h-3 w-3 text-orange-500" /> },
  { value: "relates_to", label: "Related", icon: <Link2 className="h-3 w-3 text-muted-foreground" /> },
];

/**
 * Dependencies as one chip among the time chips — the phone's replacement for
 * the collapsible section. "+ Dependencies" when there are none. Otherwise
 * one count per group the sheet lists — blocked by, blocks, related — each
 * beside that group's own icon and colour, so the chip and the sheet can
 * never disagree. A group with nothing in it shows no count.
 *
 * Opens a bottom sheet on a phone and a popover elsewhere (the same split the
 * date chips make by hand: this is a small editor, not a menu). The sheet has
 * two views — the list, and "add" — rather than a popover stacked on a sheet.
 */
export function TaskDependenciesPill({
  taskId,
  workspaceId,
  className,
}: {
  taskId: Id<"tasks">;
  workspaceId: Id<"workspaces">;
  /** The chip's shape, from the row it sits in. */
  className: string;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const deps = useTaskDependencies(taskId);

  const groups = [
    { key: "blockedBy", count: deps.blockedBy.length, label: "blocked by", icon: <Ban className="h-3 w-3 text-red-500" /> },
    { key: "blocks", count: deps.blocks.length, label: "blocks", icon: <Ban className="h-3 w-3 text-orange-500" /> },
    { key: "relatesTo", count: deps.relatesTo.length, label: "related", icon: <Link2 className="h-3 w-3 text-muted-foreground" /> },
  ].filter((g) => g.count > 0);
  const label =
    deps.totalCount === 0
      ? "Add dependency"
      : `Dependencies: ${groups.map((g) => `${g.label} ${g.count}`).join(", ")}`;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setAdding(false);
  };

  const trigger = (
    <>
      {deps.totalCount === 0 ? (
        <>
          <Plus className="h-3 w-3" />
          Dependencies
        </>
      ) : (
        <>
          {groups.map((g) => (
            <span key={g.key} className="inline-flex items-center gap-1">
              {g.icon}
              {g.count}
            </span>
          ))}
        </>
      )}
    </>
  );
  const triggerClass = cn(className, deps.totalCount > 0 && "gap-2 text-foreground");

  const body = adding ? (
    <AddDependency
      workspaceId={workspaceId}
      existingTaskIds={deps.existingTaskIds}
      onBack={() => setAdding(false)}
      onAdd={async (target, type) => {
        await deps.add(target, type);
        setAdding(false);
      }}
    />
  ) : (
    <div className="space-y-3">
      {deps.totalCount === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">No dependencies</p>
      ) : (
        <>
          {deps.blockedBy.length > 0 && (
            <DependencyGroup
              label="Blocked by"
              icon={<Ban className="h-3 w-3 text-red-500" />}
              items={deps.blockedBy}
              onRemove={deps.remove}
            />
          )}
          {deps.blocks.length > 0 && (
            <DependencyGroup
              label="Blocks"
              icon={<Ban className="h-3 w-3 text-orange-500" />}
              items={deps.blocks}
              onRemove={deps.remove}
            />
          )}
          {deps.relatesTo.length > 0 && (
            <DependencyGroup
              label="Related to"
              icon={<Link2 className="h-3 w-3 text-muted-foreground" />}
              items={deps.relatesTo}
              onRemove={deps.remove}
            />
          )}
        </>
      )}
      <Button variant="ghost" size="sm" className="-ml-2 pointer-coarse:h-9" onClick={() => setAdding(true)}>
        <Plus className="h-3.5 w-3.5" />
        Add dependency
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerTrigger className={triggerClass} aria-label={label}>
          {trigger}
        </DrawerTrigger>
        <DrawerContent>
          <DrawerTitle className="px-4 pt-3 text-xs font-normal text-muted-foreground">
            Dependencies
          </DrawerTitle>
          <div className="min-h-0 overflow-y-auto p-4 pb-6">{body}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger className={triggerClass} aria-label={label}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        {body}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Pick the relation, then the task: the dependencies chip's second view, and
 * the Context section's "+ Dependency" popover on the full page. Server-side
 * search (`tasks.suggest`), completed tasks included so "blocked by the
 * finished migration" stays reachable — the same query the section's popover
 * uses.
 */
export function AddDependency({
  workspaceId,
  existingTaskIds,
  onBack,
  onAdd,
}: {
  workspaceId: Id<"workspaces">;
  existingTaskIds: Set<string>;
  onBack: () => void;
  onAdd: (target: Id<"tasks">, type: DependencyType) => Promise<void>;
}) {
  const [type, setType] = useState<DependencyType>("is_blocked_by");
  const [search, setSearch] = useState("");
  const suggestions = useQuery(api.tasks.suggest, {
    workspaceId,
    query: search,
    includeCompleted: true,
    limit: 20,
  });
  const available = (suggestions ?? []).filter((t) => !existingTaskIds.has(t._id));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to dependencies">
          <ArrowLeft />
        </Button>
        {/* Three relations, one tap each: a segmented row, not a select. */}
        <div role="radiogroup" aria-label="Relation" className="flex flex-1 gap-1 rounded-md bg-muted/40 p-0.5">
          {RELATIONS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={type === r.value}
              onClick={() => setType(r.value)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs transition-colors pointer-coarse:py-2",
                type === r.value
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.icon}
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search tasks…"
        aria-label="Search tasks"
        className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-foreground/25"
      />
      <ul className="max-h-64 space-y-0.5 overflow-y-auto">
        {suggestions !== undefined && available.length === 0 && (
          <li className="px-2 py-2 text-sm text-muted-foreground">No tasks found</li>
        )}
        {available.map((t) => (
          <SuggestionRow
            key={t._id}
            code={formatTaskId(t.projectKey, t.number)}
            onSelect={() => void onAdd(t._id, type)}
          >
            {t.title}
          </SuggestionRow>
        ))}
      </ul>
    </div>
  );
}

function SuggestionRow({
  code,
  onSelect,
  children,
}: {
  code: string | null | undefined;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 pointer-coarse:py-3"
      >
        {code && <span className="shrink-0 font-mono text-xs text-muted-foreground">{code}</span>}
        <span className="truncate">{children}</span>
      </button>
    </li>
  );
}
