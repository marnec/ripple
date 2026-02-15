import { X } from "lucide-react";
import { useFollowMode } from "../contexts/FollowModeContext";

export function FollowModeIndicator() {
  const { isFollowing, followingUserName, followColor, stopFollowing } =
    useFollowMode();

  if (!isFollowing || !followColor) return null;

  return (
    <button
      onClick={stopFollowing}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white ${followColor.bg}`}
      title={`Following ${followingUserName} — click to stop (Esc)`}
    >
      Following
      <X className="h-3 w-3" />
    </button>
  );
}
