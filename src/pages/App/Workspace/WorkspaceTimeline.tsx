import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex-helpers/react/cache";
import { AnimatePresence, m } from "framer-motion";
import {
  ArrowRight,
  Calendar,
  CircleDot,
  Clock,
  FileText,
  Folder,
  Gauge,
  Hash,
  Link2,
  ListTodo,
  Minus,
  Pencil,
  PenTool,
  Plus,
  Shield,
  Table2,
  Tag,
  Trash2,
  Type,
  UserPlus,
  UserMinus,
  UserRound,
} from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useTheme } from "next-themes";
import { getNodeColor } from "./graphConstants";

type TimelineEntry = {
  _id: string;
  timestamp: number;
  action: string;
  resourceType?: string;
  resourceName?: string;
  actorName: string;
  actorImage?: string;
  oldValue?: string;
  newValue?: string;
  cascadeSummary?: string;
};

const RESOURCE_LABEL: Record<string, string> = {
  documents: "document",
  diagrams: "diagram",
  spreadsheets: "spreadsheet",
  channels: "channel",
  projects: "project",
  tasks: "task",
  workspaces: "workspace",
  cycles: "cycle",
  channelMembers: "member",
  workspaceInvites: "invite",
};

function getActionIcon(action: string) {
  const iconClass = "h-3 w-3";
  const verb = action.includes(".") ? action.split(".").pop()! : action;
  switch (verb) {
    case "created": return <Plus className={iconClass} />;
    case "deleted":
    case "cascade_deleted": return <Trash2 className={iconClass} />;
    case "renamed":
    case "title_change": return <Type className={iconClass} />;
    case "invited":
    case "accepted":
    case "member_added": return <UserPlus className={iconClass} />;
    case "member_removed": return <UserMinus className={iconClass} />;
    case "role_changed": return <Shield className={iconClass} />;
    case "status_change": return <CircleDot className={iconClass} />;
    case "priority_change": return <Gauge className={iconClass} />;
    case "assignee_change": return <UserRound className={iconClass} />;
    case "label_add":
    case "label_remove": return <Tag className={iconClass} />;
    case "due_date_change":
    case "start_date_change": return <Calendar className={iconClass} />;
    case "estimate_change": return <Clock className={iconClass} />;
    case "dependency_add":
    case "dependency_remove": return <Link2 className={iconClass} />;
    case "comment_edit": return <Pencil className={iconClass} />;
    case "comment_delete": return <Trash2 className={iconClass} />;
    default: return <Minus className={iconClass} />;
  }
}

// Map plural audit log resourceType → singular graph type for color lookup
const RESOURCE_TYPE_TO_GRAPH_TYPE: Record<string, string> = {
  documents: "document",
  diagrams: "diagram",
  spreadsheets: "spreadsheet",
  channels: "channel",
  projects: "project",
  tasks: "task",
};

function getResourceIcon(resourceType: string | undefined, isDark: boolean) {
  const iconClass = "h-3.5 w-3.5";
  const graphType = resourceType ? RESOURCE_TYPE_TO_GRAPH_TYPE[resourceType] : undefined;
  const color = graphType ? getNodeColor(graphType, isDark) : undefined;
  const style = color ? { color } : undefined;
  switch (resourceType) {
    case "documents": return <FileText className={iconClass} style={style} />;
    case "diagrams": return <PenTool className={iconClass} style={style} />;
    case "spreadsheets": return <Table2 className={iconClass} style={style} />;
    case "channels": return <Hash className={iconClass} style={style} />;
    case "projects": return <Folder className={iconClass} style={style} />;
    case "tasks": return <ListTodo className={iconClass} style={style} />;
    default: return null;
  }
}

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
    const counts = JSON.parse(raw) as Record<string, number>;
    const parts: string[] = [];
    for (const [table, count] of Object.entries(counts)) {
      if (count <= 0) continue;
      const label = CASCADE_TABLE_LABELS[table] ?? table;
      parts.push(`${count} ${label}${count !== 1 ? "s" : ""}`);
    }
    return parts.length > 0 ? parts.join(", ") : null;
  } catch {
    return null;
  }
}

function formatAction(entry: TimelineEntry): React.ReactNode {
  const { action, actorName, resourceType, resourceName, oldValue, newValue } = entry;
  const actor = <span className="font-medium">{actorName}</span>;
  const arrow = <ArrowRight className="inline h-3 w-3 mx-0.5" />;
  const label = resourceType ? RESOURCE_LABEL[resourceType] ?? resourceType : "";
  const name = resourceName ? <span className="font-medium">&ldquo;{resourceName}&rdquo;</span> : null;

  // Extract the verb from "resourceType.verb"
  const verb = action.includes(".") ? action.split(".").pop()! : action;

  // Helper for task field changes: "on <taskName>" suffix
  const onResource = name ? <> on {name}</> : null;

  switch (verb) {
    // Resource-level actions
    case "created":
      return <>{actor} created {label} {name ?? <span className="font-medium">{newValue}</span>}</>;
    case "deleted":
      return <>{actor} deleted {label} {name ?? <span className="font-medium">{oldValue}</span>}</>;
    case "renamed":
      return <>{actor} renamed {label} <span className="font-medium">{oldValue}</span> {arrow} <span className="font-medium">{newValue}</span></>;
    case "invited":
      return <>{actor} invited <span className="font-medium">{newValue}</span></>;
    case "accepted":
      return <>{actor} accepted an invite</>;
    case "member_added":
      return <>{actor} added a member{resourceName ? <> to {name}</> : null}</>;
    case "member_removed":
      return <>{actor} removed a member{resourceName ? <> from {name}</> : null}</>;
    case "role_changed":
      return <>{actor} changed role <span className="font-medium">{oldValue}</span> {arrow} <span className="font-medium">{newValue}</span>{resourceName ? <> in {name}</> : null}</>;
    // Task field-level actions
    case "title_change":
      return <>{actor} renamed task <span className="font-medium">{oldValue}</span> {arrow} <span className="font-medium">{newValue}</span></>;
    case "status_change":
      return <>{actor} changed status <span className="font-medium">{oldValue}</span> {arrow} <span className="font-medium">{newValue}</span>{onResource}</>;
    case "priority_change":
      return <>{actor} changed priority <span className="font-medium">{oldValue}</span> {arrow} <span className="font-medium">{newValue}</span>{onResource}</>;
    case "assignee_change":
      if (!oldValue && newValue) return <>{actor} assigned <span className="font-medium">{newValue}</span>{onResource}</>;
      if (oldValue && !newValue) return <>{actor} unassigned <span className="font-medium">{oldValue}</span>{onResource}</>;
      return <>{actor} reassigned <span className="font-medium">{oldValue}</span> {arrow} <span className="font-medium">{newValue}</span>{onResource}</>;
    case "label_add":
      return <>{actor} added label <span className="font-medium">{newValue}</span>{onResource}</>;
    case "label_remove":
      return <>{actor} removed label <span className="font-medium">{oldValue}</span>{onResource}</>;
    case "due_date_change":
      return newValue
        ? <>{actor} set due date to <span className="font-medium">{newValue}</span>{onResource}</>
        : <>{actor} removed due date{onResource}</>;
    case "start_date_change":
      return newValue
        ? <>{actor} set start date to <span className="font-medium">{newValue}</span>{onResource}</>
        : <>{actor} removed start date{onResource}</>;
    case "estimate_change":
      return newValue
        ? <>{actor} set estimate to <span className="font-medium">{newValue}h</span>{onResource}</>
        : <>{actor} removed estimate{onResource}</>;
    case "dependency_add":
      return <>{actor} added a dependency{onResource}</>;
    case "dependency_remove":
      return <>{actor} removed a dependency{onResource}</>;
    case "comment_edit":
      return <>{actor} edited a comment{onResource}</>;
    case "comment_delete":
      return <>{actor} deleted a comment{onResource}</>;
    case "cascade_deleted": {
      const summary = formatCascadeSummary(entry.cascadeSummary);
      return <>{actor} triggered cascade deletion{summary ? <span className="text-muted-foreground"> — {summary}</span> : null}</>;
    }
    default:
      return <>{actor} {verb.replace(/_/g, " ")}{onResource}</>;
  }
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

const PAGE_SIZE = 20;
const MAX_FETCH = 50;

// Map singular type (graph) → plural resourceType (audit log)
const SINGULAR_TO_RESOURCE_TYPE: Record<string, string> = {
  document: "documents",
  diagram: "diagrams",
  spreadsheet: "spreadsheets",
  channel: "channels",
  project: "projects",
  task: "tasks",
};

const ALL_RESOURCE_TYPES = Object.values(SINGULAR_TO_RESOURCE_TYPE);

const itemVariants = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto", transition: { duration: 0.2, ease: "easeOut" as const } },
  exit: { opacity: 0, height: 0, transition: { duration: 0.15, ease: "easeIn" as const } },
};

// Module-scoped cache to preserve entries across query arg changes (prevents flash)
const entryCache = new Map<string, TimelineEntry[]>();

export function WorkspaceTimeline({ workspaceId, hiddenTypes }: { workspaceId: Id<"workspaces">; hiddenTypes?: Set<string> }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [isVisible, setIsVisible] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute allowed resource types for server-side filtering
  const resourceTypes = hiddenTypes && hiddenTypes.size > 0
    ? ALL_RESOURCE_TYPES.filter((rt) => {
        const singular = Object.entries(SINGULAR_TO_RESOURCE_TYPE).find(([, v]) => v === rt)?.[0];
        return !singular || !hiddenTypes.has(singular);
      })
    : undefined;

  const queryResult = useQuery(
    api.workspaceTimeline.list,
    isVisible ? { workspaceId, limit: MAX_FETCH, resourceTypes } : "skip",
  ) as TimelineEntry[] | undefined;

  // Keep showing previous entries while new query loads (prevents flash)
  // Keep previous results visible while new query loads (prevents flash).
  // This is a module-scoped cache keyed by workspaceId — survives re-renders
  // without triggering cascading setState or reading refs during render.
  const allEntries = (() => {
    if (queryResult !== undefined) {
      entryCache.set(workspaceId, queryResult);
      return queryResult;
    }
    return entryCache.get(workspaceId) ?? [];
  })();

  const [visible, setVisible] = useState(PAGE_SIZE);

  if (allEntries.length === 0 && queryResult === undefined) {
    return <div ref={sentinelRef} />;
  }

  if (allEntries.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No recent activity
      </div>
    );
  }

  const entries = allEntries.slice(0, visible);
  const hasMore = visible < allEntries.length;

  return (
    <div ref={sentinelRef} className="relative">
      {entries.length > 1 && (
        <div className="absolute left-2.5 md:left-2.75 top-3 bottom-3 w-px bg-border" />
      )}
      <AnimatePresence initial={false} mode="popLayout">
        {entries.map((entry) => (
          <m.div
            key={entry._id}
            layout
            variants={itemVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="relative flex items-start gap-2 md:gap-2.5 py-1 md:py-1.5 overflow-hidden"
          >
            <div className="flex h-5 w-5 md:h-6 md:w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground z-10">
              {getActionIcon(entry.action)}
            </div>
            <div className="flex-1 min-w-0 text-xs text-muted-foreground leading-5 wrap-anywhere">
              {entry.resourceType && (
                <span className="inline-flex items-center mr-1 align-middle">{getResourceIcon(entry.resourceType, isDark)}</span>
              )}
              {formatAction(entry)}
            </div>
            <span className="text-[10px] text-muted-foreground/50 shrink-0 leading-5 tabular-nums">
              {formatDateTime(entry.timestamp)}
            </span>
          </m.div>
        ))}
      </AnimatePresence>
      {hasMore && (
        <button
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Show more
        </button>
      )}
    </div>
  );
}
