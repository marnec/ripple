import { Button } from "@ripple/ui/components/button";
import { useEffect, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { useChatContext } from "./ChatContext";
import { CreateTaskFromMessagesDialog } from "./CreateTaskFromMessagesDialog";

/**
 * Stands in for the composer while messages are being picked for a task.
 * Escape leaves selection mode, as Cancel does.
 */
export function MessageSelectionBar({
  workspaceId,
  widensAudience,
}: {
  workspaceId: Id<"workspaces">;
  widensAudience: boolean;
}) {
  const { selection, clearSelection } = useChatContext();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (dialogOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen, clearSelection]);

  const messages = [...(selection?.values() ?? [])].sort((a, b) => a.sentAt - b.sentAt);

  return (
    <div className="flex shrink-0 items-center gap-2 border-t px-3 py-3 animate-fade-in">
      <span className="text-sm text-muted-foreground">
        {messages.length === 0
          ? "Select messages"
          : `${messages.length} message${messages.length === 1 ? "" : "s"} selected`}
      </span>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={clearSelection}>
        Cancel
      </Button>
      <Button size="sm" disabled={messages.length === 0} onClick={() => setDialogOpen(true)}>
        Create task
      </Button>
      {dialogOpen && (
        <CreateTaskFromMessagesDialog
          workspaceId={workspaceId}
          messages={messages}
          widensAudience={widensAudience}
          onOpenChange={setDialogOpen}
          onCreated={clearSelection}
        />
      )}
    </div>
  );
}
