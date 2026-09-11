import { useQuery } from "convex-helpers/react/cache";
import { AssistantAvatar } from "@/components/AssistantAvatar";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

type AssistantSuggestionOptions = {
  workspaceId: Id<"workspaces"> | undefined;
  editor: any;
};

/**
 * Returns a `getItems` callback for the chat composer's `@` menu that offers
 * the workspace assistant — one row, or none.
 *
 * The assistant is not a workspace member, so the member list never carries
 * it; it comes from `chatAssistant.get`, which is null while the feature is
 * off. That is the whole gate on the client: an assistant that would not
 * answer is not offered. The row inserts an ordinary `userMention`, the same
 * node a colleague's name becomes, because that is what `messages.send`
 * reads to know it was summoned.
 */
export function useAssistantSuggestion({ workspaceId, editor }: AssistantSuggestionOptions) {
  const assistant = useQuery(api.chatAssistant.get, workspaceId ? { workspaceId } : "skip");

  return async (query: string) => {
    if (!assistant) return [];
    if (!assistant.name.toLowerCase().includes(query.toLowerCase())) return [];
    return [
      {
        title: assistant.name,
        subtext: "Answers in this channel",
        onItemClick: () => {
          editor.insertInlineContent([
            { type: "userMention", props: { userId: assistant.botUserId } },
            " ",
          ]);
        },
        icon: <AssistantAvatar name={assistant.name} className="h-5 w-5" />,
        group: "Assistant",
      },
    ];
  };
}
