import { Badge } from "@ripple/ui/components/badge";
import { getSourceLink } from "@/components/embed-references";
import { useIsMobile } from "@/hooks/use-mobile";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { cn } from "@/lib/utils";
import { useQuery } from "convex-helpers/react/cache";
import { lazy, Suspense, useState } from "react";
import { Ban, Link2, Plus } from "lucide-react";
import { Button } from "@ripple/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LOCAL_GRAPH_CAPTION_HEIGHT } from "@/lib/local-graph";
import { groupTaskReferences } from "./taskReferences";
import { DependencyGroup } from "./TaskDependencies";
import { AddDependency } from "./TaskDependenciesPill";
import { useTaskDependencies } from "./useTaskDependencies";

// force-graph is a canvas + d3 bundle; only the full task page pays for it.
const LazyLocalGraph = lazy(() => import("@/components/LocalGraph"));

const GRAPH_WIDTH = 320;
const GRAPH_HEIGHT = 208;
const LIST_MAX_HEIGHT = 208;

/**
 * The task's **context**: its dependencies, then everything that points at it
 * — documents, channels, other tasks — as one grouped list, with the **local
 * graph** of the same neighbourhood to its right (which draws both kinds of
 * link already).
 *
 * Dependencies lead, and are the editable part: removable rows and a
 * "+ Dependency" button, since on this page they have no other home (the
 * time row leaves its dependencies chip out). The references below are
 * read-only — made by mentioning the task elsewhere. Private-channel
 * references the viewer cannot open are dropped server-side by both queries.
 *
 * Desktop only. On a phone the section would push the description down for
 * information most visits do not need, so it renders nothing; the property
 * pills carry a references chip that opens the backlinks drawer instead.
 */
export function TaskContext({
  taskId,
  workspaceId,
  className,
}: {
  taskId: Id<"tasks">;
  workspaceId: Id<"workspaces">;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const backlinks = useQuery(
    api.edges.getBacklinks,
    isMobile ? "skip" : { targetId: taskId, workspaceId },
  );
  const graph = useQuery(
    api.graph.getLocalGraph,
    isMobile ? "skip" : { resourceId: taskId, workspaceId },
  );

  const deps = useTaskDependencies(taskId);
  const [adding, setAdding] = useState(false);

  const groups = groupTaskReferences(backlinks?.references ?? []);
  const referenceCount = groups.reduce((n, g) => n + g.references.length, 0);
  const totalCount = referenceCount + deps.totalCount;
  const loaded = backlinks !== undefined && deps.loaded;
  const taskHref = (task: { _id: Id<"tasks">; projectId: Id<"projects"> }) =>
    `/workspaces/${workspaceId}/projects/${task.projectId}/tasks/${task._id}`;

  if (isMobile) return null;

  return (
    <div className={cn("flex gap-4", className)}>
      <div className="min-w-0 flex-1">
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Context</h3>
            {totalCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-mono tabular-nums">
                {totalCount}
              </Badge>
            )}
            <Popover open={adding} onOpenChange={setAdding}>
              <PopoverTrigger
                render={<Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" />}
              >
                <Plus />
                Dependency
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" align="end">
                <AddDependency
                  workspaceId={workspaceId}
                  existingTaskIds={deps.existingTaskIds}
                  onBack={() => setAdding(false)}
                  onAdd={async (target, type) => {
                    await deps.add(target, type);
                    setAdding(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>

          {loaded && totalCount === 0 && (
            <p className="text-xs text-muted-foreground animate-fade-in">
              Not referenced anywhere yet
            </p>
          )}

          {totalCount > 0 && (
            // `scroll-fade-y` (the shadcn utility the kanban board uses on its
            // x axis) fades whichever edge still has rows beyond it — the
            // cue that the list scrolls, with no listener or re-render.
            <div
              className="scroll-fade-y space-y-3 overflow-y-auto pr-3 animate-fade-in"
              style={{ maxHeight: LIST_MAX_HEIGHT }}
            >
              {deps.blockedBy.length > 0 && (
                <DependencyGroup
                  label="Blocked by"
                  icon={<Ban className="h-3 w-3 text-red-500" />}
                  items={deps.blockedBy}
                  onRemove={deps.remove}
                  hrefFor={taskHref}
                />
              )}
              {deps.blocks.length > 0 && (
                <DependencyGroup
                  label="Blocks"
                  icon={<Ban className="h-3 w-3 text-orange-500" />}
                  items={deps.blocks}
                  onRemove={deps.remove}
                  hrefFor={taskHref}
                />
              )}
              {deps.relatesTo.length > 0 && (
                <DependencyGroup
                  label="Related to"
                  icon={<Link2 className="h-3 w-3 text-muted-foreground" />}
                  items={deps.relatesTo}
                  onRemove={deps.remove}
                  hrefFor={taskHref}
                />
              )}
              {groups.map((group) => {
                const Icon = RESOURCE_TYPE_ICONS[group.sourceType] ?? RESOURCE_TYPE_ICONS.document;
                return (
                  <div key={group.sourceType} className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Icon className="h-3 w-3" />
                      {group.label}
                    </div>
                    {/* The link is only as wide as its name — a block link
                        made the empty rest of the row navigate too. The
                        indent is the row's, not the link's, for the same
                        reason. */}
                    {group.references.map((ref) => (
                      <div key={ref._id} className="pl-5">
                        <Link
                          to={getSourceLink(ref)}
                          className="inline-block max-w-full truncate align-top text-sm hover:underline"
                        >
                          {ref.sourceName}
                        </Link>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Always there, at final size: a task with no links yet is a lone
          dot, and the list beside it never reflows when the canvas (or its
          lazy chunk) arrives. */}
      <div className="shrink-0" style={{ width: GRAPH_WIDTH, height: GRAPH_HEIGHT + LOCAL_GRAPH_CAPTION_HEIGHT }}>
        {graph && (
          <Suspense fallback={null}>
            <LazyLocalGraph
              centerId={taskId}
              workspaceId={workspaceId}
              graph={graph}
              width={GRAPH_WIDTH}
              height={GRAPH_HEIGHT}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
