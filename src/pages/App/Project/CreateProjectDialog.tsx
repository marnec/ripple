import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import * as z from "zod";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

const PROJECT_COLORS = [
  { name: "Blue", class: "bg-blue-500" },
  { name: "Green", class: "bg-green-500" },
  { name: "Yellow", class: "bg-yellow-500" },
  { name: "Red", class: "bg-red-500" },
  { name: "Purple", class: "bg-purple-500" },
  { name: "Pink", class: "bg-pink-500" },
  { name: "Orange", class: "bg-orange-500" },
  { name: "Teal", class: "bg-teal-500" },
];

const formSchema = z.object({
  name: z.string().min(1, { message: "Project name is required" }),
  color: z.string().min(1, { message: "Color is required" }),
});

function deriveProjectKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase() || "PRJ";
}

export function CreateProjectDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createProject = useMutation(api.projects.create);
  const navigate = useNavigate();
  const { toast } = useToast();
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      color: "bg-blue-500",
    },
  });

  useEffect(() => {
    if (open) {
      // Focus name input when dialog opens
      setTimeout(() => nameInputRef.current?.focus(), 0);
    }
  }, [open]);

  const handleCreate = async (values: z.infer<typeof formSchema>) => {
    try {
      const projectId = await createProject({
        ...values,
        workspaceId,
      });
      toast({
        title: "Project created",
        description: `Successfully created project "${values.name}"`,
      });
      form.reset();
      onOpenChange(false);
      // Navigate to new project (per CONTEXT.md: "User lands inside the new project after creation")
      void navigate(`/workspaces/${workspaceId}/projects/${projectId}`);
    } catch (error) {
      toast({
        title: "Error creating project",
        description:
          error instanceof Error ? error.message : "Please try again later",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>
            Create a new project to organize tasks
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit(handleCreate)(e);
            }}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      ref={nameInputRef}
                      placeholder="Enter project name"
                    />
                  </FormControl>
                  {field.value && (
                    <p className="text-xs text-muted-foreground">
                      Task IDs will use prefix <span className="font-mono font-medium">{deriveProjectKey(field.value)}</span> (e.g., {deriveProjectKey(field.value)}-1). You can change this later in project settings.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Color</FormLabel>
                  <FormControl>
                    <div className="flex flex-wrap gap-2">
                      {PROJECT_COLORS.map((color) => (
                        <button
                          key={color.class}
                          type="button"
                          onClick={() => field.onChange(color.class)}
                          className={`w-8 h-8 rounded-full ${color.class} ${
                            field.value === color.class
                              ? "ring-2 ring-offset-2 ring-primary"
                              : ""
                          }`}
                          title={color.name}
                        />
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit">Create Project</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
