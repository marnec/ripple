import { RippleSpinner } from "@/components/RippleSpinner";
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@ripple/ui/components/tabs";
import { Button } from "@ripple/ui/components/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScrollbarWidth } from "@/hooks/use-scrollbar-width";
import { HeaderSlot } from "@/contexts/HeaderSlotContext";
import { useShortcut } from "@/contexts/ShortcutsContext";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@convex/types/routes";
import { useQuery } from "convex-helpers/react/cache";
import { useMutation } from "convex/react";
import { LayoutList, Kanban, Plus, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { KanbanBoard } from "./KanbanBoard";
import { CreateTaskDialog } from "./CreateTaskDialog";
import { Tasks } from "./Tasks";
import { TaskToolbar, type TaskFilters, type TaskSort, type CompletionFilter } from "./TaskToolbar";
import { ImportTasksButton } from "./ImportTasksButton";
import { scopeCreateCycle, scopeCycleArg, type TaskScope } from "./taskScope";
import { SafeAreaSpacer } from "@/components/SafeAreaSpacer";

/**
 * The project's task views. `cycles` (the Tasks tab) shows the current
 * cycle, as a board or a list. `backlog` (the Backlog tab) is the list of
 * tasks in no cycle, where work is triaged and pulled into cycles. Other
 * cycles are browsed from the Cycles tab, not here.
 */
export function ProjectTasksPage({ mode = "cycles" }: { mode?: "cycles" | "backlog" }) {
  const { workspaceId, projectId } = useParams<QueryParams>();

  if (!workspaceId || !projectId) {
    return <SomethingWentWrong />;
  }

  return (
    <ProjectTasksContent
      key={mode}
      workspaceId={workspaceId}
      projectId={projectId}
      mode={mode}
    />
  );
}

export function ProjectBacklogPage() {
  return <ProjectTasksPage mode="backlog" />;
}

/**
 * Resolve the scope the page shows. `undefined` while loading; `null` when
 * the project has no open cycle to show.
 */
function useTaskScope(
  projectId: Id<"projects">,
  mode: "cycles" | "backlog",
): TaskScope | null | undefined {
  const cycles = useQuery(api.cycles.listByProject, mode === "cycles" ? { projectId } : "skip");
  if (mode === "backlog") return { kind: "backlog" };
  if (cycles === undefined) return undefined;
  const current = cycles.find((c) => c.isCurrent);
  return current ? { kind: "cycle", cycleId: current._id } : null;
}

function ProjectTasksContent({
  workspaceId,
  projectId,
  mode,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  mode: "cycles" | "backlog";
}) {
  const scope = useTaskScope(projectId, mode);
  const [listScrollRef, scrollbarWidth] = useScrollbarWidth<HTMLDivElement>();
  const isMobile = useIsMobile();
  const location = useLocation();
  const routeState = location.state as {
    initialCompletionFilter?: "uncompleted" | "completed" | "all";
    initialAssigneeIds?: string[];
  } | null;
  const rawInitial = routeState?.initialCompletionFilter;
  // The legacy "all" mode no longer exists — coerce any stale link/state to
  // "completed" since that's the more useful landing for someone clicking
  // through from a completed-task affordance (e.g. the kanban overflow pill).
  const initialCompletionFilter: CompletionFilter =
    rawInitial === "completed" || rawInitial === "all" ? "completed" : "uncompleted";
  // My Tasks' "all my tasks in <project>" link seeds the viewer here when its
  // own capped view overflowed.
  const initialAssigneeIds = routeState?.initialAssigneeIds ?? [];

  // Affordances that navigate here with a preset filter (the kanban overflow
  // pill, My Tasks' per-project link) want the list view — it's the surface
  // built for scanning many, and the only paginated one.
  const [view, setView] = useState<"list" | "board">(
    isMobile || initialCompletionFilter !== "uncompleted" || initialAssigneeIds.length > 0
      ? "list"
      : "board",
  );

  // Force list view on mobile — kanban doesn't work on small screens. The
  // backlog is a list by nature: it is ranked and triaged, not worked through
  // status columns.
  const effectiveView = isMobile || mode === "backlog" ? "list" : view;
  const [dialogOpen, setDialogOpen] = useState(false);
  const canSwitchView = !isMobile && mode === "cycles";
  const newTaskRef = useShortcut("create", () => setDialogOpen(true), { label: "New task" });
  const viewSwitchRef = useShortcut(
    "toggleView",
    () => setView(effectiveView === "board" ? "list" : "board"),
    { enabled: canSwitchView },
  );

  const [filters, setFilters] = useState<TaskFilters>({
    completionFilter: initialCompletionFilter,
    assigneeIds: initialAssigneeIds,
    priorities: [],
    tags: [],
  });
  const [sort, setSort] = useState<TaskSort>(null);
  const [sortBlocked, setSortBlocked] = useState(false);
  const sortBlockedTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const handleSortBlocked = () => {
    setSortBlocked(true);
    if (sortBlockedTimer.current) clearTimeout(sortBlockedTimer.current);
    sortBlockedTimer.current = setTimeout(() => setSortBlocked(false), 2500);
  };

  // Pre-fetch active tasks to gate the page-level loading indicator. The
  // active query is what the default list view needs; kanban / completed
  // views fire their own queries and have their own ready gates.

  const tasks = useQuery(
    api.tasks.listByProject,
    scope
      ? { projectId, completed: false, cycleId: scopeCycleArg(scope) }
      : "skip",
  );
  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const members = useWorkspaceMembers();
  const contentLoading = scope === undefined || (scope !== null && tasks === undefined) || statuses === undefined;

  if (isMobile && contentLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RippleSpinner size={32} />
      </div>
    );
  }

  if (scope === null) {
    return <NoOpenCycle workspaceId={workspaceId} projectId={projectId} />;
  }

  return (
    // Horizontal padding lives on each row of the page rather than on this
    // wrapper, so the list's scroll container spans the full width and its
    // scrollbar sits at the window edge — the same shape as every other list
    // page (scroll container outside, padding inside).
    <div className="flex-1 flex flex-col min-h-0 pt-4">
      <Tabs value={effectiveView} onValueChange={(v) => setView(v as "list" | "board")} className="flex-1 flex flex-col min-h-0">
        <div className="flex items-start justify-between mb-2 px-4">
          <div className="flex items-center gap-3">
            {canSwitchView && (
              <TabsList ref={viewSwitchRef}>
                <TabsTrigger value="board" className="flex items-center gap-2">
                  <Kanban className="h-4 w-4" />
                  Board
                </TabsTrigger>
                <TabsTrigger value="list" className="flex items-center gap-2">
                  <LayoutList className="h-4 w-4" />
                  List
                </TabsTrigger>
              </TabsList>
            )}
            {!isMobile && contentLoading && <RippleSpinner size={24} />}
          </div>
          {!isMobile && (
            <div className="flex items-center gap-2">
              {/* Imported tasks land in the backlog, so that is where importing lives. */}
              {mode === "backlog" && (
                <ImportTasksButton projectId={projectId} workspaceId={workspaceId} />
              )}
              <Button ref={newTaskRef} size="sm" onClick={() => setDialogOpen(true)}>
                <Plus  />
                New task
              </Button>
            </div>
          )}
        </div>

        {isMobile && (
          <HeaderSlot>
            <Button variant="ghost" size="icon" onClick={() => setDialogOpen(true)} aria-label="New task">
              <Plus className="size-4" />
            </Button>
          </HeaderSlot>
        )}

        {/* Shared toolbar — stable across views */}
        <div className="px-4">
          <TaskToolbar
            workspaceId={workspaceId}
            filters={filters}
            onFiltersChange={setFilters}
            sort={sort}
            onSortChange={setSort}
            members={members ?? []}
            sortBlocked={sortBlocked}
          />
        </div>

        {scope && (
          <>
            <TabsContent value="board" className="mt-0 flex-1 flex flex-col min-h-0 px-4 pb-4">
              <KanbanBoard projectId={projectId} workspaceId={workspaceId} filters={filters} sort={sort} scope={scope} onSortBlocked={handleSortBlocked} />
            </TabsContent>

            <TabsContent ref={listScrollRef} value="list" className="mt-0 overflow-auto animate-fade-in">
              {/* Right padding gives back what the scrollbar gutter takes, so
                  rows end flush with the toolbar above either way. */}
              <div
                className="pl-4 pb-4"
                style={{ paddingRight: `max(0px, calc(1rem - ${scrollbarWidth}px))` }}
              >
                <Tasks projectId={projectId} workspaceId={workspaceId} filters={filters} sort={sort} scope={scope} />
              </div>
              <SafeAreaSpacer />
            </TabsContent>
          </>
        )}
      </Tabs>

      <CreateTaskDialog
        projectId={projectId}
        workspaceId={workspaceId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cycleId={scope ? scopeCreateCycle(scope) : undefined}
      />
    </div>
  );
}

/** Every cycle of the project is closed: offer the next one. */
function NoOpenCycle({
  workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const createCycle = useMutation(api.cycles.create);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-16 text-center animate-fade-in">
      <RefreshCw className="h-10 w-10 text-muted-foreground/40 mb-4" />
      <h3 className="font-semibold mb-1">No open cycle</h3>
      <p className="text-sm text-muted-foreground max-w-xs mb-6">
        Every cycle of this project is closed. Start the next one, then pull work in from the{" "}
        <Link to="../backlog" relative="path" className="underline underline-offset-2 hover:text-foreground">
          backlog
        </Link>
        .
      </p>
      <Button
        size="sm"
        disabled={creating}
        onClick={() => {
          setCreating(true);
          void createCycle({ projectId, workspaceId }).finally(() => setCreating(false));
        }}
      >
        <Plus />
        Start a new cycle
      </Button>
    </div>
  );
}
