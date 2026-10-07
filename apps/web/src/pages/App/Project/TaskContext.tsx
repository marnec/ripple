import { Badge } from "@ripple/ui/components/badge";
import { getSourceLink } from "@/components/embed-references";
import { useIsMobile } from "@/hooks/use-mobile";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { cn } from "@/lib/utils";
import { useQuery } from "convex-helpers/react/cache";
import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { groupTaskReferences } from "./taskReferences";

// force-graph is a canvas + d3 bundle; only the full task page pays for it.
const LazyLocalGraph = lazy(() => import("@/components/LocalGraph"));

const GRAPH_WIDTH = 240;
// Spans title + list, so it is taller than the list alone may be.
const GRAPH_HEIGHT = 200;
const LIST_MAX_HEIGHT = 160;

/**
 * The task's **context**: everything that points at it — documents, channels,
 * other tasks — as a grouped list, with the **local graph** of the same
 * neighbourhood to its right. Read-only: these links are made by mentioning
 * the task elsewhere.
 *
 * Dependencies stay in their own section. Private-channel references the
 * viewer cannot open are dropped server-side by both queries.
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

  const groups = groupTaskReferences(backlinks?.references ?? []);
  const totalCount = groups.reduce((n, g) => n + g.references.length, 0);
  const loaded = backlinks !== undefined;
  const showGraph = totalCount > 0;

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
          </div>

          {loaded && totalCount === 0 && (
            <p className="text-xs text-muted-foreground animate-fade-in">
              Not referenced anywhere yet
            </p>
          )}

          {totalCount > 0 && (
            <div className="space-y-3 overflow-y-auto pr-3 animate-fade-in" style={{ maxHeight: LIST_MAX_HEIGHT }}>
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

      {showGraph && (
        // Reserved at final size so the title and list never reflow when the
        // canvas (or its lazy chunk) arrives.
        <div
          className="shrink-0 rounded-md border bg-muted/20 animate-fade-in"
          style={{ width: GRAPH_WIDTH, height: GRAPH_HEIGHT }}
        >
          {graph && (
            <Suspense fallback={null}>
              <LazyLocalGraph
                centerId={taskId}
                workspaceId={workspaceId}
                graph={graph}
                width={GRAPH_WIDTH - 2}
                height={GRAPH_HEIGHT - 2}
              />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}
