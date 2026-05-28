import { GithubMark } from "@/components/GithubMark";
import { GitlabMark } from "@/components/GitlabMark";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  /** "owner/repo" (GitHub) or "namespace/path" (GitLab) of the linked issue. */
  repoFullName: string | undefined;
  /** Linked external issue number. */
  issueNumber: number | undefined;
  /** The issue URL — when present the chip links out to the provider. */
  url: string | undefined;
  /** True once the upstream issue was deleted: the link is orphaned. */
  deleted?: boolean;
  /** Provider that owns the linked issue. Drives the icon + tooltip copy.
   *  Defaults to "github" for legacy refs missing the field. */
  provider?: string;
  /** Extra classes merged over the default `text-xs` chip (e.g. `text-sm` to
   *  match a larger task code on the full-page header). */
  className?: string;
};

const PROVIDER_LABEL: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
};

/**
 * Compact linked-issue chip for task surfaces (kanban card, sheet header,
 * detail page): a provider mark acting as a separator before the `#NN` issue
 * reference, linking out to the provider. Renders nothing for a Ripple-native
 * task (no external ref) so the header gap closes. When the upstream issue was
 * deleted the chip stays — the Ripple task is preserved — but drops its href
 * and dims with a strike.
 */
export function TaskGithubIssueRef({
  repoFullName,
  issueNumber,
  url,
  deleted,
  provider,
  className,
}: Props) {
  if (issueNumber === undefined) return null;

  const providerLabel = PROVIDER_LABEL[provider ?? "github"] ?? "GitHub";
  const full = repoFullName ? `${repoFullName}#${issueNumber}` : `#${issueNumber}`;
  const tooltip = deleted
    ? `${full} — deleted on ${providerLabel}`
    : `Open ${full} on ${providerLabel}`;

  // size-[1em] makes the mark track the chip's font size — the `className`
  // that sets text-xs/text-sm thus drives the icon too, no separate prop.
  const Mark = provider === "gitlab" ? GitlabMark : GithubMark;

  const content = (
    <>
      <Mark className="size-[1em] shrink-0 mb-1" />
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
