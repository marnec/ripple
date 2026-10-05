import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useQuery } from "convex-helpers/react/cache";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { CircleDot, Flag, Inbox, RefreshCw, Tag as TagIcon, Trash2, User, X, Minus, Plus } from "lucide-react";
import { Button } from "@ripple/ui/components/button";
import { Input } from "@ripple/ui/components/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/UserAvatar";
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import { cn } from "@/lib/utils";
import { PRIORITIES, getPriorityIcon } from "@/lib/task-utils";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { TaskDeleteDialog } from "./TaskDeleteDialog";

type BulkOp = FunctionArgs<typeof api.taskBulk.apply>["op"];

type SelectedTask = {
  _id: Id<"tasks">;
  tags?: string[];
  externalRefs?: unknown[];
  externalRefFrozen?: unknown;
};

type TaskBulkActionBarProps = {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
  selected: SelectedTask[];
  /** The cycle the list is showing, or null for the backlog / all cycles. */
  currentCycleId: Id<"cycles"> | null;
  visibleCount: number;
  onSelectAll: () => void;
  onClear: () => void;
};

/** Mirrors `BULK_MAX_TASKS` in convex/taskBulk.ts. */
const BULK_MAX_TASKS = 500;

const OP_VERB: Record<BulkOp["kind"], string> = {
  delete: "Deleting",
  status: "Moving",
  priority: "Updating",
  assignee: "Reassigning",
  addTag: "Tagging",
  removeTag: "Untagging",
  moveToCycle: "Moving",
};

const triggerClass =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-accent cursor-pointer transition-colors";

/**
 * Floating bar over the list view while tasks are selected. Every action hands
 * the ids to `taskBulk.apply`, which runs the change as a background drain:
 * the rows update (or disappear) live as each batch commits, so the bar just
 * clears the selection and lets the list show the progress.
 */
export function TaskBulkActionBar({
  projectId,
  workspaceId,
  selected,
  currentCycleId,
  visibleCount,
  onSelectAll,
  onClear,
}: TaskBulkActionBarProps) {
  const applyBulk = useMutation(api.taskBulk.apply);
  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const members = useWorkspaceMembers() ?? [];
  const workspaceTags = useQuery(api.tags.listWorkspaceTags, { workspaceId }) ?? [];
  const cycles = useQuery(api.cycles.listByProject, { projectId });
  const cycleTargets = (cycles ?? []).filter(
    (c) => c.status === "open" && c._id !== currentCycleId,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");

  const count = selected.length;
  const tooMany = count > BULK_MAX_TASKS;
  const noun = count === 1 ? "task" : "tasks";

  const run = (op: BulkOp) => {
    const taskIds = selected.map((t) => t._id);
    onClear();
    void applyBulk({ projectId, taskIds, op }).then(
      () => toast(`${OP_VERB[op.kind]} ${taskIds.length} ${taskIds.length === 1 ? "task" : "tasks"}…`),
      (error: unknown) =>
        toast.error(getErrorMessage(error, "Bulk action failed")),
    );
  };

  // Tags present on at least one selected task — the removable set.
  const presentTags = [...new Set(selected.flatMap((t) => t.tags ?? []))].sort();
  const query = tagQuery.trim().toLowerCase();
  const addable = workspaceTags.filter((t) => !query || t.includes(query));
  const canCreate = query.length > 0 && !workspaceTags.includes(query);
  const removable = presentTags.filter((t) => !query || t.includes(query));

  const addTag = (tag: string) => {
    setTagOpen(false);
    setTagQuery("");
    run({ kind: "addTag", tag });
  };
  const removeTag = (tag: string) => {
    setTagOpen(false);
    setTagQuery("");
    run({ kind: "removeTag", tag });
  };

  const anyGithubLinked = selected.some(
    (t) => (t.externalRefs?.length ?? 0) > 0 && !t.externalRefFrozen,
  );

  return (
    <div className="sticky bottom-4 z-10 mt-3 flex justify-center pointer-events-none animate-fade-in">
      <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border bg-popover px-2 py-1.5 shadow-lg">
        <span className="px-1.5 text-xs font-medium tabular-nums">
          {count} selected
        </span>
        {count < visibleCount && (
          <button type="button" className={cn(triggerClass, "text-muted-foreground")} onClick={onSelectAll}>
            Select all {visibleCount}
          </button>
        )}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        {tooMany ? (
          <span className="px-1.5 text-xs text-muted-foreground">
            Select at most {BULK_MAX_TASKS} tasks
          </span>
        ) : (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger render={<button type="button" className={triggerClass} />}>
                <CircleDot className="size-3.5" />
                Status
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" side="top">
                {(statuses ?? [])
                  .filter((s) => !s.isTriage)
                  .map((s) => (
                    <DropdownMenuItem
                      key={s._id}
                      onClick={() => run({ kind: "status", statusId: s._id })}
                      className="flex items-center gap-2"
                    >
                      <span className={cn("size-2 rounded-full", s.color)} />
                      {s.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger render={<button type="button" className={triggerClass} />}>
                <Flag className="size-3.5" />
                Priority
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" side="top">
                {PRIORITIES.map((p) => (
                  <DropdownMenuItem
                    key={p.value}
                    onClick={() => run({ kind: "priority", priority: p.value })}
                    className="flex items-center gap-2"
                  >
                    {getPriorityIcon(p.value)}
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger render={<button type="button" className={triggerClass} />}>
                <User className="size-3.5" />
                Assignee
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" side="top" className="max-h-72 overflow-y-auto">
                <DropdownMenuItem onClick={() => run({ kind: "assignee", assigneeId: null })}>
                  Unassigned
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {members.map((m) => (
                  <DropdownMenuItem
                    key={m._id}
                    onClick={() => run({ kind: "assignee", assigneeId: m._id })}
                    className="flex items-center gap-2"
                  >
                    <UserAvatar className="size-5" name={m.name} image={m.image} fallbackClassName="text-[10px]" />
                    {m.name ?? "Unknown"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger render={<button type="button" className={triggerClass} />}>
                <RefreshCw className="size-3.5" />
                Cycle
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" side="top" className="max-h-72 overflow-y-auto">
                {cycleTargets.map((c) => (
                  <DropdownMenuItem
                    key={c._id}
                    onClick={() => run({ kind: "moveToCycle", cycleId: c._id })}
                    className="flex items-center gap-2"
                  >
                    <RefreshCw className="size-3.5 text-muted-foreground" />
                    {c.name}
                    {c.isCurrent && <span className="ml-auto text-[11px] text-muted-foreground">current</span>}
                  </DropdownMenuItem>
                ))}
                {cycleTargets.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  onClick={() => run({ kind: "moveToCycle", cycleId: null })}
                  className="flex items-center gap-2"
                >
                  <Inbox className="size-3.5 text-muted-foreground" />
                  Backlog
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Popover
              open={tagOpen}
              onOpenChange={(open) => {
                setTagOpen(open);
                if (!open) setTagQuery("");
              }}
            >
              <PopoverTrigger render={<button type="button" className={triggerClass} />}>
                <TagIcon className="size-3.5" />
                Tags
              </PopoverTrigger>
              <PopoverContent side="top" className="w-60 p-1">
                <Input
                  autoFocus
                  value={tagQuery}
                  onChange={(e) => setTagQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && query) addTag(query);
                  }}
                  placeholder="Add or remove a tag…"
                  className="mb-1 h-8 text-xs"
                />
                <div className="max-h-64 overflow-y-auto">
                  {canCreate && (
                    <TagOption icon={<Plus className="size-3.5" />} onClick={() => addTag(query)}>
                      Add “{query}”
                    </TagOption>
                  )}
                  {removable.length > 0 && (
                    <>
                      <p className="px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">Remove</p>
                      {removable.map((t) => (
                        <TagOption key={`rm-${t}`} icon={<Minus className="size-3.5" />} onClick={() => removeTag(t)}>
                          {t}
                        </TagOption>
                      ))}
                    </>
                  )}
                  {addable.length > 0 && (
                    <>
                      <p className="px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">Add</p>
                      {addable.map((t) => (
                        <TagOption key={`add-${t}`} icon={<Plus className="size-3.5" />} onClick={() => addTag(t)}>
                          {t}
                        </TagOption>
                      ))}
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <button
              type="button"
              className={cn(triggerClass, "text-destructive hover:bg-destructive/10")}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          </>
        )}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        <Button variant="ghost" size="icon" className="size-6" onClick={onClear} aria-label="Clear selection">
          <X className="size-3.5" />
        </Button>
      </div>

      <TaskDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        count={count}
        isGithubLinked={anyGithubLinked}
        onConfirm={(closeGithubIssues) => {
          setDeleteOpen(false);
          run({ kind: "delete", closeGithubIssues });
        }}
      />
      <span className="sr-only" aria-live="polite">{`${count} ${noun} selected`}</span>
    </div>
  );
}

function TagOption({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent cursor-pointer"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}
