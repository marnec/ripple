import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { useState } from "react";
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

function deriveKeyFromName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
}

const formSchema = z.object({
  name: z.string().min(1, { message: "Project name is required" }),
  key: z.string().min(2, { message: "Key must be at least 2 characters" }).max(5),
  color: z.string().min(1, { message: "Color is required" }),
});

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
  const [keyManuallyEdited, setKeyManuallyEdited] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      key: "",
      color: "bg-blue-500",
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setKeyManuallyEdited(false);
    }
    onOpenChange(nextOpen);
  };

  const handleCreate = async (values: z.infer<typeof formSchema>) => {
    try {
      const projectId = await createProject({
        name: values.name,
        color: values.color,
        workspaceId,
        key: values.key || undefined,
      });
      toast.success("Project created", {
        description: `Successfully created project "${values.name}"`,
      });
      form.reset();
      onOpenChange(false);
      void navigate(`/workspaces/${workspaceId}/projects/${projectId}`);
    } catch (error) {
      toast.error("Error creating project", {
        description:
          error instanceof Error ? error.message : "Please try again later",
      });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange} direction="top">
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Create New Project</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Create a new project to organize tasks
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit(handleCreate)(e);
            }}
          >
            <ResponsiveDialogBody className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Enter project name"
                      onChange={(e) => {
                        field.onChange(e);
                        if (!keyManuallyEdited) {
                          form.setValue("key", deriveKeyFromName(e.target.value));
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="key"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Key</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="e.g., ENG"
                      maxLength={5}
                      className="font-mono uppercase w-32"
                      onChange={(e) => {
                        const value = e.target.value
                          .replace(/[^a-zA-Z0-9]/g, "")
                          .toUpperCase()
                          .slice(0, 5);
                        field.onChange(value);
                        setKeyManuallyEdited(true);
                      }}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Used as task ID prefix (e.g., {field.value || "ENG"}-1). Cannot be changed once tasks exist.
                  </p>
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
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button type="submit">Create Project</Button>
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
