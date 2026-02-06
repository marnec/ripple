import { createReactInlineContentSpec } from "@blocknote/react";
import { cn } from "@/lib/utils";

// Lightweight editor-time render (just shows task title text, no live queries)
// The actual interactive chip is rendered post-send via TaskMentionChip
export const TaskMention = createReactInlineContentSpec(
  {
    type: "taskMention",
    propSchema: {
      taskId: {
        default: "" as unknown as string,
      },
      taskTitle: {
        default: "",
      },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { taskId, taskTitle } = inlineContent.props;

      if (!taskId) {
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-destructive/20 text-sm">
            #unknown-task
          </span>
        );
      }

      // In-editor preview: show task title as a styled chip
      return (
        <span
          data-task-id={taskId}
          data-content-type="task-mention"
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-sm font-medium cursor-default"
          )}
        >
          <span className="h-2 w-2 rounded-full bg-gray-400" />
          <span className="max-w-[200px] truncate">{taskTitle || "Task"}</span>
        </span>
      );
    },
  }
);
