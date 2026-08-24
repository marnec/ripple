import {
  EmptyState,
  LoadingPane,
  PageHeader,
  SearchInput,
  UserAvatar,
} from "@/components/console";
import { Badge } from "@ripple/ui/components/badge";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ripple/ui/components/tooltip";
import { navigate } from "@/hooks/useHashRoute";
import { fmtNum, fmtRelative, shortId } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftIcon, ArrowRightIcon, PlugIcon, UserRoundIcon } from "lucide-react";
import { useState } from "react";

type Entry = FunctionReturnType<typeof api.admin.activity.list>["entries"][number];

const PAGE_SIZE = 50;
/** Mirrors `MAX_WINDOW` in `admin/activity.ts` — the page stops asking there. */
const MAX_WINDOW = 500;

/**
 * The audit trail of one tenant, `#/workspaces/<id>/activity`.
 *
 * Deliberately not the product's timeline: that one is prose for the people who
 * did the work, this one is evidence for the operator answering "what happened
 * to this workspace, and who did it". Every row therefore carries the raw
 * `resourceType.verb` and the resource id next to the sentence — when the
 * phrasing below has no case for a verb it degrades to the verb itself, and the
 * mono line is still the ground truth.
 */
export function WorkspaceActivityPage({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const [resourceType, setResourceType] = useState<string>(ALL);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [q, setQ] = useState("");

  // Changing the filter starts a new window — keeping a 300-row limit across a
  // switch would silently re-read the whole trail under the new filter.
  const [appliedFilter, setAppliedFilter] = useState(resourceType);
  if (resourceType !== appliedFilter) {
    setAppliedFilter(resourceType);
    setLimit(PAGE_SIZE);
  }

  const result = useQuery(api.admin.activity.list, {
    workspaceId,
    limit,
    resourceTypes: resourceType === ALL ? undefined : [resourceType],
  });

  // Hold the last result for this workspace+filter so "Load more" — which is a
  // *new* query, not a page appended to the old one — doesn't blank the list
  // while the wider window loads. Keyed, so a filter change shows a real load
  // instead of rows that no longer match it.
  const cacheKey = `${workspaceId}|${resourceType}`;
  const [cached, setCached] = useState<{ key: string; data: typeof result } | null>(null);
  if (result !== undefined && (cached?.key !== cacheKey || cached.data !== result)) {
    setCached({ key: cacheKey, data: result });
  }
  const data = result ?? (cached?.key === cacheKey ? cached.data : undefined);
  const loadingMore = result === undefined && data !== undefined;

  const needle = q.trim().toLowerCase();
  const entries = data?.entries ?? [];
  // Client-side, so it only reaches the window already loaded — audit rows
  // carry no search index and the component exposes no text query. The subtitle
  // says so rather than letting an empty result read as "it never happened".
  const visible = needle
    ? entries.filter((e) =>
        [e.actorName, e.actorEmail, e.action, e.resourceName, e.oldValue, e.newValue, e.resourceId]
          .some((field) => field?.toLowerCase().includes(needle)),
      )
    : entries;

  if (data === undefined) return <LoadingPane />;

  const atCeiling = limit >= MAX_WINDOW;

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => navigate(`/workspaces/${workspaceId}`)}
      >
        <ArrowLeftIcon /> {data.workspaceName ?? "Workspace"}
      </Button>

      <PageHeader
        title="Activity"
        subtitle={
          entries.length === 0
            ? "Nothing recorded yet."
            : `${needle ? `${fmtNum(visible.length)} of ` : ""}${fmtNum(entries.length)}${
                data.hasMore ? "+" : ""
              } most recent ${entries.length === 1 ? "event" : "events"}${
                needle ? " loaded" : ""
              }.`
        }
      >
        <div className="flex items-center gap-2">
          <SearchInput value={q} onValueChange={setQ} placeholder="Search actor, action…" />
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
      </PageHeader>

      <Card className="animate-rise gap-0 py-0" style={{ animationDelay: "60ms" }}>
        {visible.length === 0 ? (
          needle ? (
            <EmptyState title="No matches">
              Nothing in the loaded window matches “{q}”. Load more to search further back.
            </EmptyState>
          ) : resourceType !== ALL ? (
            <EmptyState title="No matching activity">
              No {RESOURCE_LABEL[resourceType]?.toLowerCase()} events in this workspace.
            </EmptyState>
          ) : (
            <EmptyState title="No activity">
              Nothing has been recorded for this workspace yet.
            </EmptyState>
          )
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((entry) => (
              <ActivityRow key={entry._id} entry={entry} />
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

function ActivityRow({ entry }: { entry: Entry }) {
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <UserAvatar
        name={entry.actorName}
        email={entry.actorEmail}
        image={entry.actorImage}
        size="sm"
        className="mt-0.5 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div className="text-sm wrap-anywhere">{describe(entry)}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
          <span className={cn(entry.severity !== "info" && SEVERITY_CLASS[entry.severity])}>
            {entry.action}
          </span>
          {entry.actorEmail && <span className="truncate">{entry.actorEmail}</span>}
          {entry.resourceId && <span title={entry.resourceId}>{shortId(entry.resourceId)}</span>}
          {entry.source === "integration" && (
            <Badge variant="secondary" className="h-4 gap-1 px-1 font-mono text-[10px]">
              <PlugIcon className="size-2.5" /> integration
            </Badge>
          )}
        </div>
      </div>

      {entry.actorIsUser && entry.actorId && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground"
                onClick={() => navigate(`/users/${entry.actorId}`)}
              >
                <UserRoundIcon />
              </Button>
            }
          />
          <TooltipContent>Open {entry.actorName}</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <span className="shrink-0 pt-0.5 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {fmtRelative(entry.timestamp)}
            </span>
          }
        />
        <TooltipContent>{fullTimestamp(entry.timestamp)}</TooltipContent>
      </Tooltip>
    </li>
  );
}

// ── Vocabulary ───────────────────────────────────────────────────────────
const ALL = "all";

/** The `ResourceType` union `auditLog.ts` writes — the only scopes that exist. */
const RESOURCE_TYPES = [
  "tasks",
  "documents",
  "diagrams",
  "spreadsheets",
  "channels",
  "projects",
  "workspaces",
  "cycles",
  "channelMembers",
  "workspaceInvites",
  "calendarEvents",
  "shares",
] as const;

const RESOURCE_LABEL: Record<string, string> = {
  [ALL]: "All activity",
  tasks: "Tasks",
  documents: "Documents",
  diagrams: "Diagrams",
  spreadsheets: "Spreadsheets",
  channels: "Channels",
  projects: "Projects",
  workspaces: "Workspace",
  cycles: "Cycles",
  channelMembers: "Channel members",
  workspaceInvites: "Invites",
  calendarEvents: "Calendar events",
  shares: "Share links",
};

/** Singular noun for the sentence, e.g. "renamed **document** “Spec”". */
const RESOURCE_NOUN: Record<string, string> = {
  tasks: "task",
  documents: "document",
  diagrams: "diagram",
  spreadsheets: "spreadsheet",
  channels: "channel",
  projects: "project",
  workspaces: "workspace",
  cycles: "cycle",
  channelMembers: "member",
  workspaceInvites: "invite",
  calendarEvents: "event",
  shares: "share link",
};

const SEVERITY_CLASS: Record<string, string> = {
  warning: "text-primary",
  error: "text-destructive",
  critical: "font-semibold text-destructive",
};

const CASCADE_TABLE_LABELS: Record<string, string> = {
  messages: "message",
  messageReactions: "reaction",
  channelMembers: "member",
  channelNotificationPreferences: "notification pref",
  callSessions: "call session",
  tasks: "task",
  taskComments: "comment",
  taskStatuses: "status",
  cycleTasks: "cycle task",
  cycles: "cycle",
  edges: "connection",
  nodes: "node",
  favorites: "favorite",
  recentActivity: "activity entry",
  documentBlockRefs: "block ref",
  spreadsheetCellRefs: "cell ref",
  projectNotificationPreferences: "notification pref",
};

function formatCascadeSummary(raw?: string): string | null {
  if (!raw) return null;
  try {
    const counts = JSON.parse(raw) as Record<string, unknown>;
    const parts: string[] = [];
    for (const [table, count] of Object.entries(counts)) {
      if (typeof count !== "number" || count <= 0) continue;
      const label = CASCADE_TABLE_LABELS[table] ?? table;
      parts.push(`${count} ${label}${count !== 1 ? "s" : ""}`);
    }
    return parts.length > 0 ? parts.join(", ") : null;
  } catch {
    return null;
  }
}

/**
 * One sentence per row.
 *
 * Only the verbs whose bare form would mislead get a case; everything else
 * falls through to "<actor> <verb with spaces> <noun> <name>", which stays
 * readable because the exact action is printed underneath either way. That is
 * the difference from the product's timeline, where the phrasing is the only
 * thing the reader gets and every verb has to be spelled out.
 */
function describe(entry: Entry) {
  const { action, actorName, resourceType, resourceName, oldValue, newValue } = entry;
  const verb = action.includes(".") ? action.split(".").pop()! : action;
  const noun = resourceType ? (RESOURCE_NOUN[resourceType] ?? resourceType) : "";
  const actor = <span className="font-medium">{actorName}</span>;
  const name = resourceName ? <Quoted>{resourceName}</Quoted> : null;
  const on = name ? <> on {name}</> : null;

  switch (verb) {
    case "created":
      return <>{actor} created {noun} {name ?? <Quoted>{newValue}</Quoted>}</>;
    case "deleted":
      return <>{actor} deleted {noun} {name ?? <Quoted>{oldValue}</Quoted>}</>;
    case "cascade_deleted": {
      const summary = formatCascadeSummary(entry.cascadeSummary);
      return (
        <>
          {actor} cascade-deleted {noun} {name}
          {summary && <span className="text-muted-foreground"> — {summary}</span>}
        </>
      );
    }
    case "renamed":
    case "title_change":
      return <>{actor} renamed {noun} <Change from={oldValue} to={newValue} /></>;
    case "invited":
      return <>{actor} invited <Quoted>{newValue}</Quoted></>;
    case "accepted":
      return <>{actor} accepted an invite</>;
    case "declined":
      return <>{actor} declined an invite</>;
    case "member_added":
      return <>{actor} added a member{name ? <> to {name}</> : null}</>;
    case "member_removed":
      return <>{actor} removed a member{name ? <> from {name}</> : null}</>;
    case "member_left":
      return <>{actor} left the workspace</>;
    case "role_changed":
      return <>{actor} changed a role <Change from={oldValue} to={newValue} />{name ? <> in {name}</> : null}</>;
    case "status_change":
      return <>{actor} moved status <Change from={oldValue} to={newValue} />{on}</>;
    case "priority_change":
      return <>{actor} changed priority <Change from={oldValue} to={newValue} />{on}</>;
    case "assignee_change":
      if (!oldValue && newValue) return <>{actor} assigned <Quoted>{newValue}</Quoted>{on}</>;
      if (oldValue && !newValue) return <>{actor} unassigned <Quoted>{oldValue}</Quoted>{on}</>;
      return <>{actor} reassigned <Change from={oldValue} to={newValue} />{on}</>;
    case "comment_create":
      return <>{actor} commented{on}</>;
    default:
      return <>{actor} {verb.replace(/_/g, " ")}{noun && <> {noun}</>}{name && <> {name}</>}</>;
  }
}

function Quoted({ children }: { children?: React.ReactNode }) {
  if (children === undefined || children === null || children === "") return null;
  return <span className="font-medium">“{children}”</span>;
}

function Change({ from, to }: { from?: string; to?: string }) {
  return (
    <>
      <span className="font-medium">{from || "—"}</span>
      <ArrowRightIcon className="mx-0.5 inline size-3 align-middle text-muted-foreground" />
      <span className="font-medium">{to || "—"}</span>
    </>
  );
}

const fullFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "medium",
});
const fullTimestamp = (ts: number) => fullFormat.format(ts);
