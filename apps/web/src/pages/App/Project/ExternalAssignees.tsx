import { UserAvatar } from "@/components/UserAvatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { GithubMark } from "@/components/GithubMark";

export interface ExternalAssignee {
  login: string;
  avatarUrl: string;
  url: string;
}

/** How many external avatars render before collapsing into a "+N" chip. */
const MAX_VISIBLE = 2;

interface Props {
  /** GitHub assignees that didn't win Ripple's single internal slot. */
  assignees: ExternalAssignee[] | undefined;
  /**
   * Which side of the internal assignee this group sits on. The GitHub mark
   * always faces the internal assignee, so it doubles as the separator between
   * the two groups.
   *  - `"left"`  → `[avatars][mark]` (compact card / list row)
   *  - `"right"` → `[mark][avatars]` (task detail, right of the assignee select)
   */
  side: "left" | "right";
  /** Avatar size, matched to the adjacent internal assignee. */
  size?: "sm" | "default";
  className?: string;
}

/**
 * External (GitHub) assignees rendered as normal-looking avatars, separated
 * from the internal assignee by a GitHub mark. Renders nothing for tasks with
 * no external assignees, so Ripple-native rows pay no cost.
 */
export function ExternalAssigneeAvatars({
  assignees,
  side,
  size = "default",
  className,
}: Props) {
  if (!assignees || assignees.length === 0) return null;

  const visible = assignees.slice(0, MAX_VISIBLE);
  const overflow = assignees.slice(MAX_VISIBLE);
  const avatarSize = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const fallbackText = size === "sm" ? "text-[10px]" : "text-xs";

  const mark = (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex text-muted-foreground" />}
        aria-label="Assigned on GitHub"
      >
        <GithubMark className="h-3.5 w-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top">Assigned on GitHub</TooltipContent>
    </Tooltip>
  );

  const avatars = (
    <div className="flex items-center -space-x-1">
      {visible.map((a) => (
        <Tooltip key={a.login}>
          <TooltipTrigger
            render={
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Open @${a.login} on GitHub`}
                className="inline-flex"
                onClick={(e) => e.stopPropagation()}
              />
            }
          >
            <UserAvatar
              className={cn(avatarSize, "ring-1 ring-background")}
              name={a.login}
              image={a.avatarUrl}
              alt={`@${a.login}`}
              fallbackClassName={fallbackText}
            />
          </TooltipTrigger>
          <TooltipContent side="top">@{a.login}</TooltipContent>
        </Tooltip>
      ))}
      {overflow.length > 0 && (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <span
              className={cn(
                avatarSize,
                fallbackText,
                "inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-background font-medium",
              )}
            >
              +{overflow.length}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            {overflow.map((a) => `@${a.login}`).join(", ")}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  return (
    <TooltipProvider delay={120}>
      <div className={cn("flex items-center gap-1", className)}>
        {side === "left" ? (
          <>
            {avatars}
            {mark}
          </>
        ) : (
          <>
            {mark}
            {avatars}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
