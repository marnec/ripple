import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getUserDisplayName } from "@shared/displayName";
import { useCallback } from "react";

type Member = {
  _id?: string;
  userId?: string;
  name?: string | null;
  image?: string;
};

type MemberSuggestionsOptions = {
  members: Member[] | undefined;
  editor: any;
  mentionType?: string;
  excludeUserId?: string;
  limit?: number;
  group?: string;
};

/**
 * Returns a `getItems` callback for BlockNote's `<SuggestionMenuController triggerCharacter="@">`.
 *
 * Handles the common pattern of filtering workspace/project members by name,
 * rendering an Avatar icon, and inserting a mention inline content on click.
 */
export function useMemberSuggestions({
  members,
  editor,
  mentionType = "userMention",
  excludeUserId,
  limit = 10,
  group = "Workspace members",
}: MemberSuggestionsOptions) {
  return useCallback(
    async (query: string) => {
      if (!members) return [];
      return members
        .filter((m) => {
          if (excludeUserId && (m._id === excludeUserId || m.userId === excludeUserId)) {
            return false;
          }
          return (m.name ?? "").toLowerCase().includes(query.toLowerCase());
        })
        .slice(0, limit)
        .map((m) => {
          const userId = m._id ?? m.userId ?? "";
          return {
            title: getUserDisplayName(m),
            onItemClick: () => {
              editor.insertInlineContent([
                { type: mentionType, props: { userId } },
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
            group,
          };
        });
    },
    [members, editor, mentionType, excludeUserId, limit, group],
  );
}
