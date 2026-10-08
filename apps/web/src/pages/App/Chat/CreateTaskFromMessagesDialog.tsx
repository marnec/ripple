import { Button } from "@ripple/ui/components/button";
import { Input } from "@ripple/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ripple/ui/components/select";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SelectedMessage } from "./ChatContext";
import { taskTitleFromMessage } from "./messageUtils";

type Props = {
  workspaceId: Id<"workspaces">;
  /** Oldest first — the order the comments will take. */
  messages: SelectedMessage[];
  /** A private channel or a DM: copying the messages widens who can read them. */
  widensAudience: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

/**
 * "Create task" from the selected messages. The server copies them onto the
 * new task as its opening comments (`lib/messageCapture.ts`); this only names
 * the task and picks its project.
 */
export function CreateTaskFromMessagesDialog({
  workspaceId,
  messages,
  widensAudience,
  onOpenChange,
  onCreated,
}: Props) {
  const projects = useQuery(api.projects.list, { workspaceId });
  const createTask = useMutation(api.tasks.create);
  const navigate = useNavigate();

  const [title, setTitle] = useState(() => taskTitleFromMessage(messages[0]?.plainText ?? ""));
  const [pickedProjectId, setPickedProjectId] = useState<Id<"projects"> | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // With a single project there is nothing to choose.
  const projectId = pickedProjectId ?? (projects?.length === 1 ? projects[0]._id : null);
  const count = messages.length === 1 ? "The message" : `The ${messages.length} messages`;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !projectId) return;

    setIsCreating(true);
    createTask({
      projectId,
      workspaceId,
      title: trimmedTitle,
      fromMessageIds: messages.map((m) => m.id),
    })
      .then((taskId) => {
        onCreated();
        toast.success("Task created", {
          action: {
            label: "Open",
            onClick: () => void navigate(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`),
          },
        });
      })
      .catch((error) => {
        toast.error("Failed to create task", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      })
      .finally(() => setIsCreating(false));
  };

  return (
    <ResponsiveDialog open onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Create task</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              autoFocus
              placeholder="Task name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isCreating}
            />
            <Select
              value={projectId}
              onValueChange={(v) => { if (v) setPickedProjectId(v); }}
              items={(projects ?? []).map((p) => ({ value: p._id, label: p.name }))}
              disabled={isCreating || !projects}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Project…" />
              </SelectTrigger>
              <SelectContent>
                {projects?.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {count} will be copied into the task as team-only comments.
              {widensAudience && " Everyone in the workspace will be able to read them."}
            </p>
            <ResponsiveDialogFooter>
              <Button type="submit" disabled={isCreating || !title.trim() || !projectId}>
                Create
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
