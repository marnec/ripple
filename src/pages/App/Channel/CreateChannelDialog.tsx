import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { useToast } from "../../../components/ui/use-toast";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

const formSchema = z.object({
  name: z.string().min(1, { message: "Channel name is required" }),
  isPublic: z.boolean().default(true),
});

export function CreateChannelDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createChannel = useMutation(api.channels.create);
  const navigate = useNavigate()
  const { toast } = useToast();
  const channelNameInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    channelNameInput.current?.focus();
  }, [])

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      isPublic: true,
    },
  });


  const createNewChannel = async (values: z.infer<typeof formSchema>) => {
    try {
      const newChannelId = await createChannel({ ...values, workspaceId });
      toast({
        title: "Channel created",
        description: `Successfully created channel "#${values.name}"`,
      });
      form.reset();
      void navigate(`/workspaces/${workspaceId}/channels/${newChannelId}${values.isPublic ? '' : '/settings'}`)

      onOpenChange(false);
    } catch {
      toast({
        title: "Error creating channel",
        description: "Please try again later",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Channel</DialogTitle>
          <DialogDescription>
            Create a new channel in this workspace
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit(createNewChannel)(e);
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
              name="isPublic"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Public</FormLabel>
                    <FormDescription>
                      Anyone in the workspace can view and join this channel.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit">Create Channel</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
} 