import { useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
 * now — but it asks first when there is no conversation yet. `createDm` is
 * get-or-create, so one click could have covered both cases; the reason it
 * doesn't is that the two cases are not the same act. Opening a conversation
 * you already have is private and reversible. Starting one is neither: the new
 * channel appears in the other person's sidebar the moment it exists, before a
 * word is written. `channels.findDmWith` is the read that tells the two apart,
 * and it runs on the click rather than on the render — a busy channel can hold
 * dozens of these chips and none of them may ever be clicked.
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
  const convex = useConvex();
  const createDm = useMutation(api.channels.createDm);
  const [opening, setOpening] = useState(false);
  // Three states in one, because the dialog has to outlive its own dismissal:
  // `null` is "never asked" and keeps it unmounted, which is what makes a chip
  // free until it is clicked; `false` is "asked and dismissed", still mounted
  // so it can animate out instead of vanishing mid-drawer on mobile.
  const [confirming, setConfirming] = useState<boolean | null>(null);

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

  // Still get-or-create at the point of navigation: between the check and this
  // call the other person may have started the same conversation from their
  // side, and `createDm` reuses it rather than racing a duplicate into being.
  // It also clears the caller's dismissal — reopening a conversation you had
  // closed is asking for it back.
  const goToConversation = async () => {
    setOpening(true);
    try {
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

  const openDm = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (opening) return;
    setOpening(true);
    try {
      // One-shot read, not a subscription: this question is asked once per
      // click and its answer stops mattering the moment we act on it.
      const existing = await convex.query(api.channels.findDmWith, {
        workspaceId: workspaceId as Id<"workspaces">,
        otherUserId: userId as Id<"users">,
      });
      if (existing) {
        await goToConversation();
        return;
      }
      setConfirming(true);
    } catch {
      toast.error(`Couldn't open a conversation with ${name}`, {
        description: "They may no longer be a member of this workspace.",
      });
    } finally {
      setOpening(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        title={`Message ${name}`}
        aria-busy={opening || undefined}
        onClick={(e) => void openDm(e)}
      >
        {body}
      </button>
      {confirming !== null && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          onConfirm={() => {
            setConfirming(false);
            void goToConversation();
          }}
          title={`Message ${name}?`}
          description={`You have no conversation with ${name} yet. Starting one puts it in both your sidebars.`}
          confirmLabel="Start conversation"
          confirmVariant="default"
        />
      )}
    </>
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
