import type { Awareness } from "y-protocols/awareness";
import { useCursorAwareness } from "@/hooks/use-cursor-awareness";
import { getUserColor } from "@/lib/user-colors";
import { ActiveUsers } from "@/pages/App/Document/ActiveUsers";

/**
 * Presence avatars for a surface whose peers are text cursors.
 *
 * A component rather than something `CollaborativeSurface` renders directly:
 * awareness only exists once the surface has opened the room, so the hook that
 * reads it cannot run in the caller's body. The diagram has its own version —
 * its peers are canvas pointers.
 */
export function SurfaceActiveUsers({
  awareness,
  viewer,
}: {
  awareness: Awareness;
  viewer: { _id: string; name?: string } | null | undefined;
}) {
  const { remoteUsers } = useCursorAwareness(awareness);

  return (
    <ActiveUsers
      remoteUsers={remoteUsers}
      currentUser={
        viewer ? { name: viewer.name, color: getUserColor(viewer._id) } : undefined
      }
    />
  );
}
