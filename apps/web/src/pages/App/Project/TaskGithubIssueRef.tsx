import { GithubMark } from "@/components/GithubMark";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  /** "owner/repo" of the linked issue, if known. */
  repoFullName: string | undefined;
  /** Linked GitHub issue number. */
  issueNumber: number | undefined;
  /** The issue URL — when present the chip links out to GitHub. */
  url: string | undefined;
  /** True once the upstream issue was deleted: the link is orphaned. */
  deleted?: boolean;
  /** Extra classes merged over the default `text-xs` chip (e.g. `text-sm` to
   *  match a larger task code on the full-page header). */
  className?: string;
};

/**
 * Compact linked-issue chip for the task-detail header: a GitHub mark acting as
 * a separator before the `#NN` issue reference, linking out to the issue on
 * GitHub. Renders nothing for a Ripple-native task (no external ref) so the
 * header gap closes. When the upstream issue was deleted the chip stays — the
 * Ripple task is preserved — but drops its href and dims with a strike.
 */
export function TaskGithubIssueRef({
  repoFullName,
  issueNumber,
  url,
  deleted,
  className,
}: Props) {
  if (issueNumber === undefined) return null;

  const full = repoFullName ? `${repoFullName}#${issueNumber}` : `#${issueNumber}`;
  const tooltip = deleted
    ? `${full} — deleted on GitHub`
    : `Open ${full} on GitHub`;

  const content = (
    <>
      {/* size-[1em] makes the mark track the chip's font size — the `className`
          that sets text-xs/text-sm thus drives the icon too, no separate prop. */}
      <GithubMark className="size-[1em] shrink-0 mb-1" />
      <span className={cn("font-mono", deleted && "line-through")}>
        #{issueNumber}
      </span>
    </>
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          deleted || !url ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground",
                className,
              )}
            />
          ) : (
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(
                "inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline",
                className,
              )}
            />
          )
        }
      >
        {content}
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
