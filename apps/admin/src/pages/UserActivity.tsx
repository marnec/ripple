import { ActivityRow } from "@/components/activity";
import { EmptyState, LoadingPane, SearchInput } from "@/components/console";
import { Button } from "@ripple/ui/components/button";
import { Card } from "@ripple/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ripple/ui/components/select";
import { Spinner } from "@/components/ui/spinner";
import { ALL, RESOURCE_LABEL, RESOURCE_TYPES } from "@/lib/activity";
import { fmtNum } from "@/lib/format";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useState } from "react";

const PAGE_SIZE = 50;
/** Mirrors `MAX_WINDOW` in `admin/activity.ts` — the panel stops asking there. */
const MAX_WINDOW = 500;

/**
 * The audit trail of one person — the Activity tab of the user detail page.
 *
 * The mirror image of `WorkspaceActivityPanel`: there the tenant is fixed and
 * the actor varies, here the actor is fixed and each row says which tenant it
 * happened in. Both narrowings are indexed server-side
 * (`by_actor_resourceType_timestamp`, `by_actor_scope_timestamp`), so filtering
 * costs a smaller scan rather than a bigger one.
 *
 * A tab rather than a section stacked on the detail page, because `TabsContent`
 * unmounts what isn't selected: a live subscription over an append-only audit
 * table is the console's heaviest read, and this way it only opens when someone
 * asks for it.
 */
export function UserActivityPanel({
  userId,
  workspaces,
}: {
  userId: Id<"users">;
  workspaces: { _id: Id<"workspaces">; name: string }[];
}) {
  const [resourceType, setResourceType] = useState<string>(ALL);
  const [workspaceId, setWorkspaceId] = useState<string>(ALL);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [q, setQ] = useState("");

  // Changing a filter starts a new window — keeping a 300-row limit across a
  // switch would silently re-read the whole trail under the new filter.
  const filterKey = `${resourceType}|${workspaceId}`;
  const [appliedFilter, setAppliedFilter] = useState(filterKey);
  if (filterKey !== appliedFilter) {
    setAppliedFilter(filterKey);
    setLimit(PAGE_SIZE);
  }

  const result = useQuery(api.admin.activity.listByUser, {
    userId,
    limit,
    workspaceId: workspaceId === ALL ? undefined : (workspaceId as Id<"workspaces">),
    resourceTypes: resourceType === ALL ? undefined : [resourceType],
  });

  // Hold the last result for this user+filter so "Load more" — which is a *new*
  // query, not a page appended to the old one — doesn't blank the list while
  // the wider window loads. Keyed, so a filter change shows a real load instead
  // of rows that no longer match it.
  const cacheKey = `${userId}|${filterKey}`;
  const [cached, setCached] = useState<{ key: string; data: typeof result } | null>(null);
  if (result !== undefined && (cached?.key !== cacheKey || cached.data !== result)) {
    setCached({ key: cacheKey, data: result });
  }
  const data = result ?? (cached?.key === cacheKey ? cached.data : undefined);
  const loadingMore = result === undefined && data !== undefined;

  const needle = q.trim().toLowerCase();
  const entries = data?.entries ?? [];
  // Client-side, so it only reaches the window already loaded — audit rows
  // carry no search index and the component exposes no text query. The count
  // line says so rather than letting an empty result read as "it never
  // happened".
  const visible = needle
    ? entries.filter((e) =>
        [e.action, e.resourceName, e.oldValue, e.newValue, e.resourceId, e.workspaceName].some(
          (field) => field?.toLowerCase().includes(needle),
        ),
      )
    : entries;

  if (data === undefined) return <LoadingPane className="min-h-40" />;

  const atCeiling = limit >= MAX_WINDOW;
  const filtered = resourceType !== ALL || workspaceId !== ALL;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {entries.length === 0
            ? "Nothing recorded yet."
            : `${needle ? `${fmtNum(visible.length)} of ` : ""}${fmtNum(entries.length)}${
                data.hasMore ? "+" : ""
              } most recent ${entries.length === 1 ? "event" : "events"}${
                needle ? " loaded" : ""
              }.`}
        </p>

        <div className="flex items-center gap-2">
          <SearchInput value={q} onValueChange={setQ} placeholder="Search action, resource…" />
          {/* Shown even for a single membership: it still narrows the feed to
              that tenant, dropping the platform-level rows that carry no scope
              and any rows from a workspace this person has since left. */}
          {workspaces.length > 0 && (
            <Select value={workspaceId} onValueChange={(v) => setWorkspaceId(v ?? ALL)}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue>
                  {(value: string) =>
                    value === ALL
                      ? "All workspaces"
                      : (workspaces.find((w) => w._id === value)?.name ?? "Workspace")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All workspaces</SelectItem>
                {workspaces.map((w) => (
                  <SelectItem key={w._id} value={w._id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={resourceType} onValueChange={(v) => setResourceType(v ?? ALL)}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue>
                {(value: string) => RESOURCE_LABEL[value] ?? "All activity"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All activity</SelectItem>
              {RESOURCE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {RESOURCE_LABEL[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="gap-0 py-0">
        {visible.length === 0 ? (
          needle ? (
            <EmptyState title="No matches">
              Nothing in the loaded window matches “{q}”. Load more to search further back.
            </EmptyState>
          ) : filtered ? (
            <EmptyState title="No matching activity">
              Nothing recorded under this filter.
            </EmptyState>
          ) : (
            <EmptyState title="No activity">
              This user hasn&apos;t done anything that leaves an audit trail yet.
            </EmptyState>
          )
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((entry) => (
              <ActivityRow key={entry._id} entry={entry} variant="user" />
            ))}
          </ul>
        )}

        {data.hasMore && (
          <div className="flex flex-col items-center gap-1 border-t border-border px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={loadingMore || atCeiling}
              onClick={() => setLimit((n) => Math.min(n + PAGE_SIZE, MAX_WINDOW))}
            >
              {loadingMore ? <Spinner className="size-4" /> : "Load more"}
            </Button>
            {/* The ceiling is real, so say so — a feed that just stops reads as
                the end of the trail. */}
            {atCeiling && (
              <p className="text-xs text-muted-foreground">
                Showing the {fmtNum(MAX_WINDOW)} most recent events. Older ones exist — narrow the
                filter to reach them.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
