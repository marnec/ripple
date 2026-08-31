import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useUserDisplayName } from "@/hooks/use-user-display-name";
import {
  UnknownUserMention,
  UserMentionChip,
  UserMentionPlaceholder,
} from "../UserMentionChip";

/**
 * The composer's own `@name`, drawn with the chip the sent message uses.
 *
 * Chat previously borrowed the task editor's spec, which renders a mention as
 * bold `@name` text. So the composer showed one thing and the channel showed
 * another: you typed a name in bold and it arrived as an avatar chip. Sharing
 * the chip closes that gap, and doing it from a chat-local spec — the pattern
 * the other chat inline contents already follow — leaves the task surfaces on
 * their own rendering.
 *
 * The prop schema is unchanged (`userId` alone), so bodies written by either
 * spec still round trip through the other.
 */
export const UserMention = createReactInlineContentSpec(
  {
    type: "userMention",
    propSchema: {
      userId: {
        default: "",
      },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { userId } = inlineContent.props;
      if (!userId) {
        return (
          <span contentEditable={false}>
            <UnknownUserMention />
          </span>
        );
      }
      return <UserMentionView userId={userId as Id<"users">} />;
    },
  },
);

const UserMentionView = ({ userId }: { userId: Id<"users"> }) => {
  const user = useQuery(api.users.get, { id: userId });
  // `users.get` withholds `email`, so a nameless account resolves its label
  // from the workspace member list — see `useUserDisplayName`.
  const displayName = useUserDisplayName(userId, user);

  return (
    <span contentEditable={false}>
      {user === undefined ? (
        <UserMentionPlaceholder />
      ) : user === null ? (
        <UnknownUserMention />
      ) : (
        // Inert in the editor: a click here belongs to the caret, not to
        // navigation out of a half-written message.
        <UserMentionChip
          userId={userId}
          name={displayName}
          image={user.image}
          interactive={false}
        />
      )}
    </span>
  );
};
