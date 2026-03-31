import { RippleSpinner } from "@/components/RippleSpinner";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { ChannelRole } from "@shared/enums";
import {
  CHAT_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  DEFAULT_CHANNEL_CHAT_PREFERENCES,
  type ChatNotificationCategory,
} from "@shared/notificationCategories";
import type { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import { useViewer } from "../UserContext";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ChannelDangerZone } from "./ChannelDangerZone";
import { ChannelDetailsSection } from "./ChannelDetailsSection";
import { ChannelMembersSection } from "./ChannelMembersSection";

function ChannelSettingsContent({
  workspaceId,
  channelId,
}: {
  workspaceId: Id<"workspaces">;
  channelId: Id<"channels">;
}) {
  const channel = useQuery(api.channels.get, { id: channelId });
  const channelMembers = useQuery(api.channelMembers.membersByChannel, { channelId });
  const workspaceMembers = useWorkspaceMembers();
  const currentUser = useViewer();

  if (
    channel === undefined ||
    channelMembers === undefined ||
    workspaceMembers === undefined ||
    currentUser === undefined
  ) {
    return (
      <div className="flex items-center justify-center h-full">
        <RippleSpinner />
      </div>
    );
  }

  if (channel === null) {
    return <ResourceDeleted resourceType="channel" />;
  }

  if (currentUser === null) {
    return <SomethingWentWrong />;
  }

  const currentMembership = channelMembers.find(
    (m) => m.userId === currentUser._id,
  );
  const isAdmin = channel.isPublic
    ? true
    : currentMembership?.role === ChannelRole.ADMIN;

  const channelMemberIds = new Set(channelMembers.map((m) => m.userId));
  const availableMembers = workspaceMembers.filter(
    (m) => !channelMemberIds.has(m._id),
  );

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl animate-fade-in">
      <h1 className="hidden md:block text-2xl font-bold mb-6">Channel Settings</h1>

      <ChannelDetailsSection
        channelId={channelId}
        channelName={channel.name}
        isPublic={channel.isPublic}
        isAdmin={isAdmin}
      />

      <Separator className="my-6" />

      <ChannelMembersSection
        channelId={channelId}
        isPublic={channel.isPublic}
        isAdmin={isAdmin}
        currentUserId={currentUser._id}
        channelMembers={channelMembers}
        availableMembers={availableMembers}
      />

      <Separator className="my-6" />

      <ChannelNotificationSettings channelId={channelId} />

      {isAdmin && (
        <>
          <Separator className="my-6" />
          <ChannelDangerZone
            channelId={channelId}
            workspaceId={workspaceId}
          />
        </>
      )}
    </div>
  );
}

function ChannelNotificationSettings({ channelId }: { channelId: Id<"channels"> }) {
  const chanNotifPrefs = useQuery(api.channelNotificationPreferences.get, { channelId });
  const savePrefs = useMutation(api.channelNotificationPreferences.save);

  const currentPrefs: Record<ChatNotificationCategory, boolean> = (() => {
    if (!chanNotifPrefs) return { ...DEFAULT_CHANNEL_CHAT_PREFERENCES };
    return Object.fromEntries(
      CHAT_NOTIFICATION_CATEGORIES.map((cat) => [cat, chanNotifPrefs[cat]]),
    ) as Record<ChatNotificationCategory, boolean>;
  })();

  const handleToggle = (category: ChatNotificationCategory, enabled: boolean) => {
    const updated = { ...currentPrefs, [category]: enabled, channelId };
    // Turning on "new channel messages" also enables "@mentions in chat"
    if (category === "chatChannelMessage" && enabled) {
      updated.chatMention = true;
    }
    void savePrefs(updated);
  };

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-4">Notifications</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Control which chat notifications you receive for this channel.
      </p>
      <div className="space-y-2">
        {CHAT_NOTIFICATION_CATEGORIES.map((category) => {
          const lockedOn = category === "chatMention" && currentPrefs.chatChannelMessage;
          return (
            <div
              key={category}
              className="flex items-center justify-between py-0.5"
            >
              <span className={`text-sm ${lockedOn ? "text-muted-foreground" : ""}`}>
                {NOTIFICATION_CATEGORY_LABELS[category]}
              </span>
              <Switch
                checked={currentPrefs[category]}
                disabled={lockedOn}
                onCheckedChange={(checked) => handleToggle(category, checked)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export const ChannelSettings = () => {
  const { workspaceId, channelId } = useParams<QueryParams>();

  if (!workspaceId || !channelId) return <SomethingWentWrong />;

  return (
    <ChannelSettingsContent
      workspaceId={workspaceId}
      channelId={channelId}
    />
  );
};
