import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { GitBranch, Loader2 } from "lucide-react";
import { useState } from "react";
import { useEditorChange } from "@blocknote/react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isBlocksEmpty } from "@/lib/editor-utils";

type Props = {
  taskId: Id<"tasks">;
  /**
   * The BlockNote editor instance for the task description. Used to
   * (a) track emptiness reactively — the button hides when the description
   * is empty so the user never pushes a blank body to GitHub — and
   * (b) render the current document to markdown at push time. The Convex
   * runtime intentionally does NOT carry BlockNote/JSDOM (bundle-size
   * limit), so markdown rendering happens here on the client and is sent
   * as a mutation arg.
   *
   * Typed `unknown` because the editor's full generic lives in the parent;
   * we only access `editor.document` and `editor.blocksToMarkdownLossy`.
   */
  editor: unknown;
};

function formatRelative(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * "Sync description to GitHub" button + last-pushed label.
 *
 * Ripple is the source of truth for description content: there is no
 * reconciliation and no automatic background sync. Clicking the button
 * renders the current Yjs description to markdown server-side and PATCHes
 * the linked GitHub issue body.
 *
 * Rendered only when the task has a linked GitHub issue and a non-empty
 * description. Hidden when the task is not linked or there is nothing to
 * push (matches `core/description.isSyncDescriptionButtonVisible`).
 */
export function TaskDescriptionSyncButton({ taskId, editor }: Props) {
  const link = useQuery(api.integrations.core.taskLinks.getByTask, { taskId });
  const sync = useMutation(api.tasks.syncDescriptionToGitHub);
  const [isPushing, setIsPushing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  // Track description emptiness via the BlockNote change feed. Initial value
  // is captured on the first onChange — before that, hiding is the safe
  // default (a flicker is preferable to a fleeting push affordance on an
  // empty doc).
  useEditorChange((e) => {
    setIsEmpty(isBlocksEmpty(e.document));
  }, editor as never);

  if (!link) return null;
  if (isEmpty) return null;

  const lastSyncedAt = link.descriptionLastSyncedAt;

  const handleClick = () => {
    if (isPushing) return;
    setIsPushing(true);
    void (async () => {
      try {
        // Render the current document to markdown here; the mutation only
        // wants the rendered body. BlockNote's markdown export is lossy
        // for Ripple-only block types (Excalidraw etc.) — those drop to
        // text or vanish, which matches the GitHub destination's limits.
        const ed = editor as {
          document: unknown[];
          blocksToMarkdownLossy: (blocks?: unknown[]) => Promise<string>;
        };
        const markdown = await ed.blocksToMarkdownLossy(ed.document);
        await sync({ taskId, markdown });
      } finally {
        setIsPushing(false);
      }
    })();
  };

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground animate-fade-in">
      <TooltipProvider delay={120}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPushing}
                onClick={handleClick}
                aria-label="Sync description to GitHub"
                className="h-7 gap-1.5 px-2 text-xs"
              />
            }
          >
            {isPushing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <GitBranch className="h-3.5 w-3.5" aria-hidden />
            )}
            <span>Sync description to GitHub</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            Pushes the current Ripple description (rendered as markdown) to
            the linked GitHub issue body. Ripple is the source of truth —
            GitHub-side edits are not synced back.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {lastSyncedAt && !isPushing && (
        <span className="leading-none">
          Last synced {formatRelative(lastSyncedAt)}
        </span>
      )}
    </div>
  );
}
