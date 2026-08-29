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
} from "@ripple/ui/components/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@ripple/ui/components/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "../../../components/ui/responsive-dialog";
import { Input } from "@ripple/ui/components/input";
import { toast } from "sonner";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChannelVisibility } from "@ripple/shared/enums";
import {
  CHANNEL_VISIBILITIES,
  CHANNEL_VISIBILITY_DESCRIPTION,
  CHANNEL_VISIBILITY_LABEL,
} from "@/lib/channel-visibility";

const formSchema = z.object({
  name: z.string().trim().min(1, "Channel name is required"),
  visibility: z.enum([ChannelVisibility.PUBLIC, ChannelVisibility.PRIVATE]),
});

/**
 * Creating a **channel**: a name and a **visibility**, and nothing else.
 *
 * Starting a **direct message** is `CreateDmDialog`, deliberately a separate
 * component. The two shared nothing but this dialog, and paid for it by
 * changing shape as the member filled them in.
 */
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
  const navigate = useNavigate();
  const channelNameInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) channelNameInput.current?.focus();
  }, [open]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      visibility: ChannelVisibility.PUBLIC,
    },
  });

  const submit = async (values: z.infer<typeof formSchema>) => {
    try {
      const newChannelId = await createChannel({
        name: values.name,
        visibility: values.visibility,
        workspaceId,
      });
      onChannelCreated?.();
      form.reset();
      onOpenChange(false);
      // A public channel is ready to use; a private one is not until somebody
      // has been invited to it, so that lands on its settings instead — on the
      // Members tab, which is the thing it was sent there to do. General only
      // repeats the name and visibility just chosen in this dialog.
      void navigate(
        `/workspaces/${workspaceId}/channels/${newChannelId}${
          values.visibility === ChannelVisibility.PUBLIC
            ? ""
            : "/settings?tab=members"
        }`,
      );
    } catch {
      toast.error("Error creating channel", {
        description: "Please try again later",
      });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Create New Channel</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Create a new channel in this workspace
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

              <FormField
                control={form.control}
                name="visibility"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Visibility</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CHANNEL_VISIBILITIES.map((visibility) => (
                          <SelectItem key={visibility} value={visibility}>
                            {CHANNEL_VISIBILITY_LABEL[visibility]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {CHANNEL_VISIBILITY_DESCRIPTION[field.value]}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <ResponsiveDialogFooter>
                <Button type="submit">Create Channel</Button>
              </ResponsiveDialogFooter>
            </form>
          </Form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
