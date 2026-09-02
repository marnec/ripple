import { UserAvatar } from "@/components/console";
import { Badge } from "@ripple/ui/components/badge";
import { Button } from "@ripple/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ripple/ui/components/tooltip";
import { navigate } from "@/hooks/useHashRoute";
import { fmtRelative, shortId } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CASCADE_TABLE_LABELS,
  RESOURCE_NOUN,
  SEVERITY_CLASS,
  type ActivityEntry,
} from "@/lib/activity";
import { ArrowRightIcon, BuildingIcon, PlugIcon, UserRoundIcon } from "lucide-react";

/**
 * One audit row, rendered the same way wherever the console shows the trail.
 *
 * Two feeds read the same entry shape — `admin.activity.list` (one tenant, many
 * actors) and `admin.activity.listByUser` (one actor, many tenants) — so the
 * row is parameterized on which of those two is constant rather than
 * duplicated. The `variant` drops the redundant half: a workspace feed already
 * knows its tenant, a user feed already knows its person.
 */
export function ActivityRow({
  entry,
  variant = "workspace",
}: {
  entry: ActivityEntry;
  variant?: "workspace" | "user";
}) {
  const byUser = variant === "user";

  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      {!byUser && (
        <UserAvatar
          name={entry.actorName}
          email={entry.actorEmail}
          image={entry.actorImage}
          size="sm"
          className="mt-0.5 shrink-0"
        />
      )}

      <div className="min-w-0 flex-1">
        {/* The user feed drops the subject — it is the same person on every
            row — which leaves the sentence starting on its verb. */}
        <div className={cn("text-sm wrap-anywhere", byUser && "first-letter:uppercase")}>
          {describe(entry, { subject: byUser })}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
          <span className={cn(entry.severity !== "info" && SEVERITY_CLASS[entry.severity])}>
            {entry.action}
          </span>
          {!byUser && entry.actorEmail && <span className="truncate">{entry.actorEmail}</span>}
          {byUser && entry.workspaceName && (
            <button
              type="button"
              className="flex items-center gap-1 truncate hover:text-foreground"
              onClick={() => navigate(`/workspaces/${entry.workspaceId}`)}
            >
              <BuildingIcon className="size-2.5 shrink-0" />
              {entry.workspaceName}
            </button>
          )}
          {entry.resourceId && <span title={entry.resourceId}>{shortId(entry.resourceId)}</span>}
          {entry.source === "integration" && (
            <Badge variant="secondary" className="h-4 gap-1 px-1 font-mono text-[10px]">
              <PlugIcon className="size-2.5" /> integration
            </Badge>
          )}
        </div>
      </div>

      {!byUser && entry.actorIsUser && entry.actorId && (
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
function describe(entry: ActivityEntry, opts?: { subject?: boolean }) {
  const { action, actorName, resourceType, resourceName, oldValue, newValue } = entry;
  const verb = action.includes(".") ? action.split(".").pop()! : action;
  const noun = resourceType ? (RESOURCE_NOUN[resourceType] ?? resourceType) : "";
  // Dropping the subject leaves a leading space, which HTML collapses away.
  const actor = opts?.subject ? null : <span className="font-medium">{actorName}</span>;
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
