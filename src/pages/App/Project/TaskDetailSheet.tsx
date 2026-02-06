import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import { useMutation, useQuery } from "convex/react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  FileText,

  Maximize2,
  Minus,
  PenTool,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { taskDescriptionSchema } from "./taskDescriptionSchema";

import { TaskComments } from "./TaskComments";

type TaskDetailSheetProps = {
  taskId: Id<"tasks"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
};

export function TaskDetailSheet({
  taskId,
  open,
  onOpenChange,
  workspaceId,
  projectId,
}: TaskDetailSheetProps) {
  const task = useQuery(api.tasks.get, taskId ? { taskId } : "skip");
  const statuses = useQuery(api.taskStatuses.listByWorkspace, { workspaceId });
  const members = useQuery(api.projectMembers.membersByProject, { projectId });
  const diagrams = useQuery(api.diagrams.list, { workspaceId });
  const documents = useQuery(api.documents.listByUserMembership, { workspaceId });
  const currentUser = useQuery(api.users.viewer);

  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();

  // Debounce timeout for description updates
  const descriptionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track which task's description has been loaded into the editor
  const loadedTaskIdRef = useRef<Id<"tasks"> | null>(null);
  const suppressOnChangeRef = useRef(false);

  // Initialize BlockNote editor (content loaded via useEffect below)
  const editor = useCreateBlockNote({ schema: taskDescriptionSchema });

  // Update title value when task loads (only update if task.title changes)
  useEffect(() => {
    if (task?.title && task.title !== titleValue) {
      setTitleValue(task.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.title]);

  // Load task description into editor when task changes
  useEffect(() => {
    if (!task || !taskId) return;
    if (loadedTaskIdRef.current === taskId) return;
    loadedTaskIdRef.current = taskId;

    suppressOnChangeRef.current = true;
    if (task.description) {
      const blocks = JSON.parse(task.description);
      editor.replaceBlocks(editor.document, blocks);
    } else {
      editor.replaceBlocks(editor.document, []);
    }
  }, [task, taskId, editor]);

  // Reset loaded state when sheet closes so re-opening reloads content
  useEffect(() => {
    if (!open) {
      loadedTaskIdRef.current = null;
      if (descriptionTimeoutRef.current) {
        clearTimeout(descriptionTimeoutRef.current);
      }
    }
  }, [open]);

  if (!taskId || !task || task === null) {
    return null;
  }

  if (task === undefined || statuses === undefined || members === undefined) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-200 sm:w-175 overflow-y-auto">
          <SheetTitle className="sr-only">Task Details</SheetTitle>
          <div className="flex items-center justify-center py-12">
            <LoadingSpinner />
          </div>
        </SheetContent>
      </Sheet>
    );
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
      void updateTask({ taskId, assigneeId: null });
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
    // Skip save when content was set programmatically (initial load)
    if (suppressOnChangeRef.current) {
      suppressOnChangeRef.current = false;
      return;
    }

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
      onOpenChange(false);
    });
  };

  const handleExpand = () => {
    void navigate(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`
    );
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
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-200 sm:w-175 overflow-y-auto">
          <SheetTitle className="sr-only">Task Details</SheetTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-12 top-4 rounded-sm opacity-70 hover:opacity-100 h-auto w-auto p-0"
            onClick={handleExpand}
            title="Expand to full page"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <SheetHeader>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => setShowDeleteDialog(true)}
                title="Delete task"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
              <Input
                ref={titleInputRef}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                className="text-lg font-semibold border-none focus-visible:ring-0 px-0 h-auto"
                placeholder="Task title"
              />
            </div>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Properties Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Properties
              </h3>

              {/* Status */}
              <div className="grid grid-cols-3 gap-4 items-center">
                <Label className="text-sm">Status</Label>
                <div className="col-span-2">
                  <Select
                    value={task.statusId}
                    onValueChange={handleStatusChange}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {task.status && (
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "w-2 h-2 rounded-full",
                                task.status.color
                              )}
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
                              className={cn(
                                "w-2 h-2 rounded-full",
                                status.color
                              )}
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
              <div className="grid grid-cols-3 gap-4 items-center">
                <Label className="text-sm">Priority</Label>
                <div className="col-span-2">
                  <Select value={task.priority} onValueChange={handlePriorityChange}>
                    <SelectTrigger>
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
              <div className="grid grid-cols-3 gap-4 items-center">
                <Label className="text-sm">Assignee</Label>
                <div className="col-span-2">
                  <Select
                    value={task.assigneeId || "unassigned"}
                    onValueChange={handleAssigneeChange}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {task.assignee ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="h-5 w-5">
                              {task.assignee.image && (
                                <AvatarImage src={task.assignee.image} alt={task.assignee.name ?? "Assignee"} />
                              )}
                              <AvatarFallback className="text-xs">
                                {task.assignee.name
                                  ?.slice(0, 2)
                                  .toUpperCase() ?? "?"}
                              </AvatarFallback>
                            </Avatar>
                            <span>{task.assignee.name}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">
                            Unassigned
                          </span>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">
                        <span className="text-muted-foreground">
                          Unassigned
                        </span>
                      </SelectItem>
                      {members.map((member) => (
                        <SelectItem key={member.userId} value={member.userId}>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-5 w-5">
                              {member.image && (
                                <AvatarImage src={member.image} alt={member.name ?? "Member"} />
                              )}
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
              <div className="grid grid-cols-3 gap-4 items-start">
                <Label className="text-sm pt-2">Labels</Label>
                <div className="col-span-2 space-y-2">
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
                      className="h-8 text-sm"
                    />
                    <Button
                      onClick={handleAddLabel}
                      size="sm"
                      variant="secondary"
                    >
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
              <div className="task-description-editor min-h-50 border rounded-md p-4">
                <BlockNoteView
                  editor={editor}
                  onChange={handleDescriptionChange}
                  theme={resolvedTheme === "dark" ? "dark" : "light"}
                  sideMenu={false}
                >
                  <SuggestionMenuController
                    triggerCharacter={"#"}
                    getItems={async (query) => {
                      const items: Array<{title: string; onItemClick: () => void; icon: React.JSX.Element; group: string}> = [];

                      // Documents
                      if (documents) {
                        documents
                          .filter(doc => doc.name.toLowerCase().includes(query.toLowerCase()))
                          .slice(0, 5)
                          .forEach(doc => {
                            items.push({
                              title: doc.name,
                              onItemClick: () => {
                                editor.insertInlineContent([
                                  { type: "documentLink", props: { documentId: doc._id } },
                                  " ",
                                ]);
                              },
                              icon: <FileText className="h-4 w-4" />,
                              group: "Documents",
                            });
                          });
                      }

                      // Diagrams
                      if (diagrams) {
                        diagrams
                          .filter(d => d.name.toLowerCase().includes(query.toLowerCase()))
                          .slice(0, 5)
                          .forEach(d => {
                            items.push({
                              title: d.name,
                              onItemClick: () => {
                                editor.insertInlineContent([
                                  { type: "diagramEmbed", props: { diagramId: d._id } },
                                  " ",
                                ]);
                              },
                              icon: <PenTool className="h-4 w-4" />,
                              group: "Diagrams",
                            });
                          });
                      }

                      return items;
                    }}
                  />
                  <SuggestionMenuController
                    triggerCharacter={"@"}
                    getItems={async (query) => {
                      if (!members) return [];
                      return members
                        .filter(m => m.name?.toLowerCase().includes(query.toLowerCase()))
                        .slice(0, 10)
                        .map(m => ({
                          title: m.name ?? "Unknown",
                          onItemClick: () => {
                            editor.insertInlineContent([
                              { type: "userMention", props: { userId: m.userId } },
                              " ",
                            ]);
                          },
                          icon: (
                            <Avatar className="h-5 w-5">
                              {m.image && <AvatarImage src={m.image} />}
                              <AvatarFallback className="text-xs">
                                {m.name?.slice(0, 2).toUpperCase() ?? "?"}
                              </AvatarFallback>
                            </Avatar>
                          ),
                          group: "Project members",
                        }));
                    }}
                  />
                </BlockNoteView>
              </div>
            </div>

            {/* Comments Section */}
            {currentUser && (
              <div className="space-y-2">
                <TaskComments taskId={taskId} currentUserId={currentUser._id} projectId={projectId} />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

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
    </>
  );
}
