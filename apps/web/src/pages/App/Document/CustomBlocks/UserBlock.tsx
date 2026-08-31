import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { UserAvatar } from "@/components/UserAvatar";
import { useUserDisplayName } from "@/hooks/use-user-display-name";

/**
 * An avatar-led pill is not padded evenly. The avatar is a circle sitting in
 * the pill's own rounded end, so it needs almost no room on the left, while the
 * text needs real space before the curve on the right — `p-1` on all four sides
 * left the label jammed against the edge. The height is set by the avatar plus
 * a hairline, not by matching that horizontal padding vertically, so the chip
 * sits on the line instead of pushing it open.
 */
const CHIP = "align-middle inline-flex min-w-0 max-w-64 items-center gap-1.5 py-0.5 pl-1 pr-2.5 rounded-full";

const UserView = ({ userId }: { userId: Id<"users"> }) => {
  const user = useQuery(api.users.get, { id: userId });
  // `users.get` withholds `email`, so a nameless account resolves its label
  // from the workspace member list — see `useUserDisplayName`.
  const displayName = useUserDisplayName(userId, user);

  // Reserved space at the chip's real height, not a pulsing skeleton, so the
  // line does not reflow when the name lands on top of it.
  if (!user) {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-6 w-24 rounded-full bg-muted align-middle"
      />
    );
  }

  return (
    <span className={`${CHIP} bg-muted animate-fade-in`}>
      <UserAvatar name={displayName} image={user.image} className="h-5 w-5 shrink-0" />
      {/* An account with no name falls back to its email, which is long. */}
      <span className="truncate font-medium" title={displayName}>
        {displayName}
      </span>
    </span>
  );
};

export const User = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      userId: {
        default: null as unknown as Id<"users">,
      },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent }) => {
      const { userId } = inlineContent.props;

      if (!userId) {
        return (
          // No avatar to hug the left edge here, so this one is padded evenly.
          <span className={`${CHIP} bg-destructive/20 pl-2.5`}>
            <span className="truncate font-medium">@Unknown User</span>
          </span>
        );
      }
      return <UserView userId={userId as Id<"users">} />;
    },
  },
);