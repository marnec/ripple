import { Eye, X } from "lucide-react";
import { useFollowMode } from "../contexts/FollowModeContext";
import { Button } from "./ui/button";

export function FollowModeIndicator() {
  const { isFollowing, followingUserName, stopFollowing } = useFollowMode();

  if (!isFollowing) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
      <Eye className="h-4 w-4 text-blue-500" />
      <span className="text-sm font-medium">
        Following {followingUserName}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={stopFollowing}
        title="Stop following"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
