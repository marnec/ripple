import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ExternalAssignee {
  login: string;
  avatarUrl: string;
  url: string;
}

/** How many external avatars render before collapsing into a "+N" chip. */
const MAX_VISIBLE = 2;

/** GitHub mark — lucide dropped brand icons, so we inline the logo path. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

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
            <Avatar className={cn(avatarSize, "ring-1 ring-background")}>
              <AvatarImage src={a.avatarUrl} alt={`@${a.login}`} />
              <AvatarFallback className={fallbackText}>
                {a.login.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
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
