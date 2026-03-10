import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { Plus } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

type CreateTaskInlineProps = {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
};

export function CreateTaskInline({ projectId, workspaceId }: CreateTaskInlineProps) {
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createTask = useMutation(api.tasks.create);
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setIsCreating(true);

    createTask({
      projectId,
      workspaceId,
      title: trimmedTitle,
    })
      .then(() => {
        // Clear input and refocus for rapid entry
        setTitle("");
        inputRef.current?.focus();
      })
      .catch((error) => {
        toast.error("Failed to create task", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      })
      .finally(() => {
        setIsCreating(false);
      });
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 py-2 px-px">
      <Plus className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <Input
        ref={inputRef}
        type="text"
        placeholder="Add a task... (press Enter)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={isCreating}
        className="border-dashed"
      />
    </form>
  );
}
