import { getUserColor } from "@/lib/user-colors";
import { ActiveUsers } from "@/pages/App/Document/ActiveUsers";
import { ConnectionStatus } from "@/pages/App/Document/ConnectionStatus";
import type { RemoteUser } from "@/hooks/use-cursor-awareness";
import type { Id } from "@convex/_generated/dataModel";
import { SeedingDescriptionNotice } from "./SeedingDescriptionNotice";
import { TaskDescriptionSyncButton } from "./TaskDescriptionSyncButton";

type Props = {
  taskId: Id<"tasks">;
  /** A GitHub description seed is in flight — show the seeding notice. */
  awaitingSeed: boolean;
  /**
   * BlockNote editor instance, or null until it's created. Typed `unknown`
   * because the full generic lives in the host; the sync button only reads
   * `editor.document` / `editor.blocksToMarkdownLossy`.
   */
  editor: unknown;
  isConnected: boolean;
  remoteUsers: RemoteUser[];
  currentUser: { _id: Id<"users">; name?: string } | null | undefined;
};

/**
 * The right-aligned cluster in a task's Description header: the GitHub seeding
 * notice, the manual sync-to-GitHub button, the collaboration connection
 * status, and the live presence avatars. Shared verbatim between the
 * task-detail sheet and the full page so a new affordance lands in one place.
 */
export function TaskDescriptionToolbar({
  taskId,
  awaitingSeed,
  editor,
  isConnected,
  remoteUsers,
  currentUser,
}: Props) {
  return (
    <div className="flex items-center gap-2 min-h-8">
      {awaitingSeed && <SeedingDescriptionNotice />}
      {editor != null && (
        <TaskDescriptionSyncButton taskId={taskId} editor={editor} />
      )}
      <ConnectionStatus isConnected={isConnected} />
      {isConnected && (
        <ActiveUsers
          remoteUsers={remoteUsers}
          currentUser={
            currentUser
              ? { name: currentUser.name, color: getUserColor(currentUser._id) }
              : undefined
          }
        />
      )}
    </div>
  );
}
