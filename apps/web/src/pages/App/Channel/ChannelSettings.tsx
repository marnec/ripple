import { RippleSpinner } from "@/components/RippleSpinner";
import {
  SettingsLayout,
  type SettingsSection,
} from "@/components/SettingsLayout";
import { Switch } from "@/components/ui/switch";
import { MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { ChannelRole } from "@ripple/shared/enums";
import { Bell, SlidersHorizontal, Trash2, Users } from "lucide-react";
import {
  CHAT_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  DEFAULT_CHANNEL_CHAT_PREFERENCES,
  type ChatNotificationCategory,
} from "@ripple/shared/notificationCategories";
import type { QueryParams } from "@ripple/shared/types/routes";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import { useViewer } from "../UserContext";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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
  const workspaceMembersWithRoles = useQuery(api.workspaceMembers.membersWithRoles, { workspaceId });
  const currentUser = useViewer();

  // The section list depends on loaded data (channel type + delete authority),
  // so it's computed after the loading guards below. We can't call
  // `useSettingsSection(sections)` here yet, so read/write the `?tab=` param
  // directly (hook runs unconditionally) and resolve `active` once sections
  // exist.
  const [searchParams, setSearchParams] = useSearchParams();
  const setActive = (value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", value);
        return next;
      },
      { replace: true },
    );

  if (
    channel === undefined ||
    channelMembers === undefined ||
    workspaceMembers === undefined ||
    workspaceMembersWithRoles === undefined ||
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
  const isAdmin = channel.type === "open"
    ? true
    : currentMembership?.role === ChannelRole.ADMIN;

  // Deletion authority must mirror channels.remove on the backend:
  // open channels → workspace admins; closed channels → channel admins.
  // (Without this, regular workspace members would see a Danger Zone in any
  // open channel and hit a server-side "Not authorized" error on click.)
  const workspaceRole = workspaceMembersWithRoles.find(
    (m) => m.userId === currentUser._id,
  )?.role;
  const canDelete = channel.type === "open"
    ? workspaceRole === "admin"
    : currentMembership?.role === ChannelRole.ADMIN;

  const channelMemberIds = new Set(channelMembers.map((m) => m.userId));
  const availableMembers = workspaceMembers.filter(
    (m) => !channelMemberIds.has(m._id),
  );

  const isDm = channel.type === "dm";

  const sections: SettingsSection[] = [
    ...(isDm
      ? []
      : [
          {
            value: "general",
            label: "General",
            icon: SlidersHorizontal,
            description: "Channel name and type.",
          } satisfies SettingsSection,
          {
            value: "members",
            label: "Members",
            icon: Users,
            description: "Manage who can participate in this channel.",
          } satisfies SettingsSection,
        ]),
    {
      value: "notifications",
      label: "Notifications",
      icon: Bell,
      description: "Control which chat notifications you receive for this channel.",
    },
    ...(canDelete && !isDm
      ? [
          {
            value: "danger",
            label: "Delete",
            icon: Trash2,
            title: "Delete channel",
            destructive: true,
          } satisfies SettingsSection,
        ]
      : []),
  ];

  // Mirror useSettingsSection's fallback: an unknown/missing `?tab=` (e.g. a
  // DM deep-linked to ?tab=general) resolves to the first available section.
  const requestedTab = searchParams.get("tab");
  const active =
    (requestedTab ? sections.find((s) => s.value === requestedTab) : undefined) ??
    sections[0];

  return (
    <>
      <MobileHeaderTitle name={channel.name} />
      <SettingsLayout
        eyebrow={isDm ? "Conversation" : "Channel"}
        sections={sections}
        active={active}
        onChange={setActive}
      >
        {active.value === "general" && !isDm && (
          <ChannelDetailsSection
            channelId={channelId}
            channelName={channel.name}
            channelType={channel.type}
            isAdmin={isAdmin}
          />
        )}

        {active.value === "members" && !isDm && (
          <ChannelMembersSection
            channelId={channelId}
            channelType={channel.type}
            isAdmin={isAdmin}
            currentUserId={currentUser._id}
            channelMembers={channelMembers}
            availableMembers={availableMembers}
          />
        )}

        {active.value === "notifications" && (
          <ChannelNotificationSettings channelId={channelId} />
        )}

        {active.value === "danger" && canDelete && !isDm && (
          <ChannelDangerZone channelId={channelId} workspaceId={workspaceId} />
        )}
      </SettingsLayout>
    </>
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
