import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useForm, useWatch } from "react-hook-form";
import * as z from "zod";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useViewer } from "../UserContext";
import { Button } from "../../../components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "../../../components/ui/responsive-dialog";
import { Input } from "../../../components/ui/input";
import { toast } from "sonner";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

const formSchema = z
  .object({
    name: z.string(),
    type: z.enum(["open", "closed", "dm"]),
    otherUserId: z.string().optional(),
  })
  .refine(
    (v) => v.type === "dm" || v.name.trim().length > 0,
    { message: "Channel name is required", path: ["name"] },
  )
  .refine(
    (v) => v.type !== "dm" || (v.otherUserId && v.otherUserId.length > 0),
    { message: "Select a user to message", path: ["otherUserId"] },
  );

export function CreateChannelDialog({
  workspaceId,
  open,
  onOpenChange,
  onChannelCreated,
}: {
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChannelCreated?: () => void;
}) {
  const createChannel = useMutation(api.channels.create);
  const createDm = useMutation(api.channels.createDm);
  const currentUser = useViewer();
  const workspaceMembers = useQuery(api.workspaceMembers.membersWithRoles, { workspaceId });
  const navigate = useNavigate();
  const channelNameInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) channelNameInput.current?.focus();
  }, [open]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      type: "open",
      otherUserId: "",
    },
  });

  const selectedType = useWatch({ control: form.control, name: "type" });

  const submit = async (values: z.infer<typeof formSchema>) => {
    try {
      if (values.type === "dm") {
        const channelId = await createDm({
          workspaceId,
          otherUserId: values.otherUserId as Id<"users">,
        });
        onChannelCreated?.();
        form.reset();
        onOpenChange(false);
        void navigate(`/workspaces/${workspaceId}/channels/${channelId}`);
      } else {
        const newChannelId = await createChannel({
          name: values.name,
          type: values.type,
          workspaceId,
        });
        onChannelCreated?.();
        form.reset();
        onOpenChange(false);
        void navigate(
          `/workspaces/${workspaceId}/channels/${newChannelId}${values.type === "open" ? "" : "/settings"}`,
        );
      }
    } catch {
      toast.error("Error creating channel", {
        description: "Please try again later",
      });
    }
  };

  const availableUsers = workspaceMembers?.filter((m) => m.userId !== currentUser?._id) ?? [];

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {selectedType === "dm" ? "New Direct Message" : "Create New Channel"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {selectedType === "dm"
              ? "Start a 1-on-1 conversation with another workspace member"
              : "Create a new channel in this workspace"}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <Form {...form}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void form.handleSubmit(submit)(e);
              }}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="open">Open Channel</SelectItem>
                        <SelectItem value="closed">Closed Channel</SelectItem>
                        <SelectItem value="dm">Direct Message</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {field.value === "open" &&
                        "Anyone in the workspace can view and join this channel."}
                      {field.value === "closed" &&
                        "Only invited members can participate. All workspace members can see this channel exists."}
                      {field.value === "dm" &&
                        "A private 1-on-1 conversation."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {selectedType !== "dm" && (
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Channel Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          ref={channelNameInput}
                          placeholder="Enter channel name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {selectedType === "dm" && (
                <FormField
                  control={form.control}
                  name="otherUserId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>User</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a workspace member" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {availableUsers.map((u) => (
                            <SelectItem key={u.userId} value={u.userId}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <ResponsiveDialogFooter>
                <Button type="submit">
                  {selectedType === "dm" ? "Start Conversation" : "Create Channel"}
                </Button>
              </ResponsiveDialogFooter>
            </form>
          </Form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
