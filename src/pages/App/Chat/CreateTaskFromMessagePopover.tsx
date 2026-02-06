import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { MessageWithAuthor } from "@shared/types/channel";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

interface CreateTaskFromMessagePopoverProps {
  message: MessageWithAuthor;
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement>;
  onTaskCreated: (taskId: Id<"tasks">, taskTitle: string) => void;
}

// Extract first non-empty line of message as title (max 80 chars)
function extractTitle(plainText: string): string {
  const firstLine = plainText.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
  return firstLine.length > 80 ? firstLine.substring(0, 77) + '...' : firstLine;
}

function CreateTaskFromMessagePopoverContent({
  message,
  channelId,
  workspaceId,
  onTaskCreated,
  onOpenChange,
}: Omit<CreateTaskFromMessagePopoverProps, 'open' | 'anchorRef'>) {
  const linkedProject = useQuery(api.projects.getByLinkedChannel, { channelId });
  const projects = useQuery(api.projects.listByUserMembership, { workspaceId });
  const createTask = useMutation(api.tasks.create);

  // Compute initial values once
  const initialTitle = useMemo(() => extractTitle(message.plainText), [message.plainText]);
  const initialProjectId = linkedProject?._id || null;

  const [taskTitle, setTaskTitle] = useState(initialTitle);
  const [selectedProjectId, setSelectedProjectId] = useState<Id<"projects"> | null>(initialProjectId);
  const [isCreating, setIsCreating] = useState(false);

  // In project chats, always use the linked project; otherwise use user selection
  const effectiveProjectId = linkedProject ? linkedProject._id : selectedProjectId;

  const handleCreate = () => {
    if (!effectiveProjectId || !taskTitle.trim()) return;

    setIsCreating(true);

    // Body is already BlockNote JSON
    const description = message.body;

    // Create task with message content as description
    void createTask({
      projectId: effectiveProjectId,
      title: taskTitle,
      description,
    })
      .then((taskId) => {
        toast({
          title: "Task created successfully",
        });
        onTaskCreated(taskId, taskTitle);
        onOpenChange(false);
      })
      .catch((error) => {
        toast({
          variant: "destructive",
          title: "Failed to create task",
          description: error instanceof Error ? error.message : "Unknown error",
        });
      })
      .finally(() => {
        setIsCreating(false);
      });
  };

  return (
    <PopoverContent
      className="w-80 p-4 space-y-3"
      side="right"
      align="start"
      onPointerDownOutside={(e) => e.preventDefault()}
      onInteractOutside={(e) => e.preventDefault()}
    >
      <div className="space-y-2">
        <Label htmlFor="task-title">Title</Label>
        <Input
          id="task-title"
          value={taskTitle}
          onChange={(e) => setTaskTitle(e.target.value)}
          placeholder="Task title..."
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleCreate();
            }
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-project">Project</Label>
        <Select
          value={effectiveProjectId || undefined}
          onValueChange={(value) => setSelectedProjectId(value as Id<"projects">)}
          disabled={!!linkedProject}
        >
          <SelectTrigger id="task-project">
            <SelectValue placeholder="Select project..." />
          </SelectTrigger>
          <SelectContent>
            {projects?.map((project) => (
              <SelectItem key={project._id} value={project._id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        onClick={handleCreate}
        disabled={!effectiveProjectId || !taskTitle.trim() || isCreating}
        className="w-full"
      >
        {isCreating ? "Creating..." : "Create Task"}
      </Button>
    </PopoverContent>
  );
}

export function CreateTaskFromMessagePopover({
  message,
  channelId,
  workspaceId,
  open,
  onOpenChange,
  anchorRef,
  onTaskCreated,
}: CreateTaskFromMessagePopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef} />
      {open && (
        <CreateTaskFromMessagePopoverContent
          message={message}
          channelId={channelId}
          workspaceId={workspaceId}
          onTaskCreated={onTaskCreated}
          onOpenChange={onOpenChange}
        />
      )}
    </Popover>
  );
}
