import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
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
    case "deleted": return <Trash2 className={iconClass} />;
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

function getResourceIcon(resourceType?: string) {
  const iconClass = "h-3 w-3";
  switch (resourceType) {
    case "documents": return <FileText className={iconClass} />;
    case "diagrams": return <PenTool className={iconClass} />;
    case "spreadsheets": return <Table2 className={iconClass} />;
    case "channels": return <Hash className={iconClass} />;
    case "projects": return <Folder className={iconClass} />;
    case "tasks": return <ListTodo className={iconClass} />;
    default: return null;
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
    default:
      return <>{actor} {verb.replace(/_/g, " ")}{onResource}</>;
  }
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

const PAGE_SIZE = 5;
const MAX_FETCH = 50;

export function WorkspaceTimeline({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
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

  const allEntries = useQuery(
    api.workspaceTimeline.list,
    isVisible ? { workspaceId, limit: MAX_FETCH } : "skip",
  ) as TimelineEntry[] | undefined;
  const [visible, setVisible] = useState(PAGE_SIZE);

  if (!allEntries) {
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
    <div className="relative">
      {entries.length > 1 && (
        <div className="absolute left-2.5 top-3 bottom-3 w-px bg-border" />
      )}
      <div className="space-y-0.5">
        {entries.map((entry) => (
          <div key={entry._id} className="relative flex items-start gap-2 py-1">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground z-10">
              {getActionIcon(entry.action)}
            </div>
            <div className="flex-1 min-w-0 text-xs text-muted-foreground leading-5">
              <span className="inline-flex items-center gap-1">
                {getResourceIcon(entry.resourceType)}
                {formatAction(entry)}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground/60 shrink-0 leading-5">
              {formatRelativeTime(entry.timestamp)}
            </span>
          </div>
        ))}
      </div>
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
