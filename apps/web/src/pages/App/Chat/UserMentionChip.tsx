import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { UserAvatar } from "@/components/UserAvatar";
import { useViewer } from "@/pages/App/UserContext";
import { cn } from "@/lib/utils";

interface UserMentionChipProps {
  userId: string;
  name: string;
  image?: string;
  /**
   * False inside the composer, where the chip sits in a contenteditable and a
   * click has to place the caret rather than navigate away mid-sentence.
   */
  interactive?: boolean;
}

/**
 * A person, named inline in a message.
 *
 * **Colour is reserved for the mention that names you.** Every mention used to
 * be the same hardcoded blue, which spent the message body's only accent on
 * information the reader mostly already has — they can see whose name it is —
 * and then collided with the sender's own bubble, which is itself a blue tint.
 * So an ordinary mention is now a neutral tint of `foreground`, the same
 * language the frozen range panel speaks, and it takes its contrast from
 * whichever bubble it lands in. A mention of *you* inverts to a filled chip,
 * because nothing else in a channel says a message is addressed to you.
 *
 * The chip also used to style a hover state it never acted on. It opens the DM
 * now, so the affordance is honest: `createDm` is get-or-create, which is what
 * makes one click the whole interaction whether or not the conversation exists.
 */
export function UserMentionChip({
  userId,
  name,
  image,
  interactive = true,
}: UserMentionChipProps) {
  const viewer = useViewer();
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const createDm = useMutation(api.channels.createDm);
  const [opening, setOpening] = useState(false);

  const isSelf = !!viewer && viewer._id === userId;
  // A DM with yourself is refused by the mutation, and there is nowhere to go
  // from your own name anyway.
  const clickable = interactive && !isSelf && !!workspaceId;

  const body = (
    <>
      <UserAvatar
        name={name}
        image={image}
        alt={name}
        className="h-4 w-4 text-[8px]"
        fallbackClassName={cn(
          "text-[8px] font-semibold",
          isSelf ? "bg-background/25 text-background" : "bg-foreground/15",
        )}
      />
      <span className="truncate">{name}</span>
    </>
  );

  const className = cn(
    "inline-flex max-w-48 items-center gap-1 rounded-full px-1.5 py-0.5 align-middle text-sm font-medium animate-fade-in",
    // The filled chip sets its own text colour because it has to; the neutral
    // one deliberately does not, so it inherits the bubble's foreground and
    // reads correctly in the tinted own-message bubble and the muted one alike.
    isSelf ? "bg-foreground text-background" : "bg-foreground/10",
    clickable &&
      "cursor-pointer transition-colors hover:bg-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  );

  if (!clickable) {
    return (
      <span className={className} title={name}>
        {body}
      </span>
    );
  }

  const openDm = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (opening) return;
    setOpening(true);
    try {
      // Get-or-create: there is nothing to branch on, we go wherever it points.
      const channelId = await createDm({
        workspaceId: workspaceId as Id<"workspaces">,
        otherUserId: userId as Id<"users">,
      });
      void navigate(`/workspaces/${workspaceId}/channels/${channelId}`);
    } catch {
      toast.error(`Couldn't open a conversation with ${name}`, {
        description: "They may no longer be a member of this workspace.",
      });
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      type="button"
      className={className}
      title={`Message ${name}`}
      aria-busy={opening || undefined}
      onClick={(e) => void openDm(e)}
    >
      {body}
    </button>
  );
}

/**
 * The space a chip will occupy while its name is still resolving.
 *
 * A tinted box rather than a pulsing skeleton, per the house rule: the layout
 * is reserved at the final dimensions and the chip fades in on top of it, so
 * the line never reflows and nothing flashes.
 */
export function UserMentionPlaceholder() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-5 w-24 rounded-full bg-foreground/5 align-middle"
    />
  );
}

/** A mention whose account no longer resolves. */
export function UnknownUserMention() {
  return (
    <span className="inline-flex items-center rounded-full bg-foreground/5 px-1.5 py-0.5 align-middle text-sm text-muted-foreground">
      unknown-user
    </span>
  );
}
