import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useMutation, useQuery } from "convex/react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Minus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

export function TaskDetailPage() {
  const { workspaceId, projectId, taskId } = useParams<QueryParams>();

  if (!workspaceId || !projectId || !taskId) {
    return <SomethingWentWrong />;
  }

  return (
    <TaskDetailPageContent
      workspaceId={workspaceId}
      projectId={projectId}
      taskId={taskId}
    />
  );
}

function TaskDetailPageContent({
  workspaceId,
  projectId,
  taskId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  taskId: Id<"tasks">;
}) {
  const task = useQuery(api.tasks.get, { taskId });
  const statuses = useQuery(api.taskStatuses.listByWorkspace, { workspaceId });
  const members = useQuery(api.projectMembers.membersByProject, { projectId });
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Initialize BlockNote editor
  const editor = useCreateBlockNote({
    initialContent: task?.description
      ? JSON.parse(task.description)
      : undefined,
  });

  // Debounce timeout for description updates
  const descriptionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update title value when task loads
  useEffect(() => {
    if (task?.title && task.title !== titleValue) {
      setTitleValue(task.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.title]);

  if (task === undefined || statuses === undefined || members === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (task === null) {
    return <SomethingWentWrong />;
  }

  const handleTitleBlur = () => {
    if (titleValue.trim() && titleValue !== task.title) {
      void updateTask({ taskId, title: titleValue });
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      titleInputRef.current?.blur();
    }
  };

  const handleStatusChange = (statusId: Id<"taskStatuses">) => {
    void updateTask({ taskId, statusId });
  };

  const handlePriorityChange = (
    priority: "urgent" | "high" | "medium" | "low"
  ) => {
    void updateTask({ taskId, priority });
  };

  const handleAssigneeChange = (value: string) => {
    if (value === "unassigned") {
      void updateTask({ taskId, assigneeId: undefined });
    } else {
      void updateTask({ taskId, assigneeId: value as Id<"users"> });
    }
  };

  const handleAddLabel = () => {
    if (newLabel.trim()) {
      const updatedLabels = [...(task.labels || []), newLabel.trim()];
      void updateTask({ taskId, labels: updatedLabels });
      setNewLabel("");
    }
  };

  const handleRemoveLabel = (labelToRemove: string) => {
    const updatedLabels = (task.labels || []).filter(
      (label) => label !== labelToRemove
    );
    void updateTask({ taskId, labels: updatedLabels });
  };

  const handleDescriptionChange = () => {
    // Debounce description updates
    if (descriptionTimeoutRef.current) {
      clearTimeout(descriptionTimeoutRef.current);
    }

    descriptionTimeoutRef.current = setTimeout(() => {
      void updateTask({
        taskId,
        description: JSON.stringify(editor.document),
      });
    }, 500);
  };

  const handleDelete = () => {
    void removeTask({ taskId }).then(() => {
      setShowDeleteDialog(false);
      void navigate(`/workspaces/${workspaceId}/projects/${projectId}`);
    });
  };

  const handleBack = () => {
    void navigate(`/workspaces/${workspaceId}/projects/${projectId}`);
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case "urgent":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case "high":
        return <ArrowUp className="w-4 h-4 text-orange-500" />;
      case "medium":
        return <Minus className="w-4 h-4 text-yellow-500" />;
      case "low":
        return <ArrowDown className="w-4 h-4 text-gray-400" />;
      default:
        return <Minus className="w-4 h-4 text-gray-400" />;
    }
  };

  const getPriorityLabel = (priority: string) => {
    return priority.charAt(0).toUpperCase() + priority.slice(1);
  };

  return (
    <div className="container mx-auto py-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <Input
              ref={titleInputRef}
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              className="text-2xl font-bold border-none focus-visible:ring-0 px-0 h-auto"
              placeholder="Task title"
            />
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowDeleteDialog(true)}
          title="Delete task"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      <div className="space-y-8">
        {/* Properties Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Properties
          </h3>

          {/* Status */}
          <div className="grid grid-cols-4 gap-4 items-center">
            <Label className="text-sm">Status</Label>
            <div className="col-span-3">
              <Select value={task.statusId} onValueChange={handleStatusChange}>
                <SelectTrigger className="w-64">
                  <SelectValue>
                    {task.status && (
                      <div className="flex items-center gap-2">
                        <span
                          className={cn("w-2 h-2 rounded-full", task.status.color)}
                        />
                        <span>{task.status.name}</span>
                      </div>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((status) => (
                    <SelectItem key={status._id} value={status._id}>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn("w-2 h-2 rounded-full", status.color)}
                        />
                        <span>{status.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Priority */}
          <div className="grid grid-cols-4 gap-4 items-center">
            <Label className="text-sm">Priority</Label>
            <div className="col-span-3">
              <Select value={task.priority} onValueChange={handlePriorityChange}>
                <SelectTrigger className="w-64">
                  <SelectValue>
                    <div className="flex items-center gap-2">
                      {getPriorityIcon(task.priority)}
                      <span>{getPriorityLabel(task.priority)}</span>
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {["urgent", "high", "medium", "low"].map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      <div className="flex items-center gap-2">
                        {getPriorityIcon(priority)}
                        <span>{getPriorityLabel(priority)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Assignee */}
          <div className="grid grid-cols-4 gap-4 items-center">
            <Label className="text-sm">Assignee</Label>
            <div className="col-span-3">
              <Select
                value={task.assigneeId || "unassigned"}
                onValueChange={handleAssigneeChange}
              >
                <SelectTrigger className="w-64">
                  <SelectValue>
                    {task.assignee ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-xs">
                            {task.assignee.name?.slice(0, 2).toUpperCase() ??
                              "?"}
                          </AvatarFallback>
                        </Avatar>
                        <span>{task.assignee.name}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">
                    <span className="text-muted-foreground">Unassigned</span>
                  </SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-xs">
                            {member.name?.slice(0, 2).toUpperCase() ?? "?"}
                          </AvatarFallback>
                        </Avatar>
                        <span>{member.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Labels */}
          <div className="grid grid-cols-4 gap-4 items-start">
            <Label className="text-sm pt-2">Labels</Label>
            <div className="col-span-3 space-y-2">
              <div className="flex flex-wrap gap-1">
                {task.labels?.map((label) => (
                  <Badge
                    key={label}
                    variant="secondary"
                    className="flex items-center gap-1"
                  >
                    {label}
                    <button
                      onClick={() => handleRemoveLabel(label)}
                      className="hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddLabel();
                    }
                  }}
                  placeholder="Add label..."
                  className="h-8 text-sm w-64"
                />
                <Button onClick={handleAddLabel} size="sm" variant="secondary">
                  Add
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Description Section */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Description
          </h3>
          <div className="min-h-[300px] border rounded-md p-4">
            <BlockNoteView
              editor={editor}
              onChange={handleDescriptionChange}
              theme="light"
            />
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Task</DialogTitle>
            <DialogDescription>
              Delete this task? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
