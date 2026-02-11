import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RemoteUser } from "@/hooks/use-cursor-awareness";

interface ActiveUsersProps {
  remoteUsers: RemoteUser[];
  currentUser?: {
    name?: string;
    color: string;
  };
  max?: number;
  className?: string;
}

const getInitials = (name: string) => {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

const getUserStatus = (user: RemoteUser) => {
  if (user.isIdle) return "Idle";
  if (user.cursor) return "Editing";
  return "Viewing";
};

export function ActiveUsers({ remoteUsers, currentUser, max = 5, className }: ActiveUsersProps) {
  const visibleUsers = remoteUsers.slice(0, max);
  const remainingCount = remoteUsers.length - max;

  return (
    <TooltipProvider>
      <div className={cn("flex -space-x-2", className)}>
        {/* Current user - always first */}
        {currentUser && (
          <div className="relative group" style={{ zIndex: max + 1 }}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Avatar className="h-8 w-8 border-2 border-background">
                  <AvatarFallback
                    className="text-xs font-medium"
                    style={{ backgroundColor: currentUser.color, color: "#fff" }}
                  >
                    {currentUser.name ? getInitials(currentUser.name) : "ME"}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent>
                <div className="font-medium">{currentUser.name || "You"}</div>
                <div className="text-xs opacity-80">You (Editing)</div>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Remote users */}
        {visibleUsers.map((user, index) => (
          <div
            key={user.clientId}
            className="relative group"
            style={{ zIndex: max - index }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Avatar
                  className={cn(
                    "h-8 w-8 border-2 transition-transform group-hover:scale-110",
                    user.isIdle && "opacity-50"
                  )}
                  style={{
                    borderColor: user.color,
                  }}
                >
                  <AvatarFallback
                    className="text-xs font-medium"
                    style={{ backgroundColor: user.color, color: "#fff" }}
                  >
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent>
                <div className="font-medium">{user.name}</div>
                <div className="text-xs opacity-80">{getUserStatus(user)}</div>
              </TooltipContent>
            </Tooltip>
          </div>
        ))}

        {/* Overflow count */}
        {remainingCount > 0 && (
          <div className="relative group" style={{ zIndex: 0 }}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Avatar className="h-8 w-8 border-2 border-background">
                  <AvatarFallback className="text-xs font-medium bg-muted text-muted-foreground">
                    +{remainingCount}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent>
                <div className="font-medium">
                  {remainingCount} more user{remainingCount > 1 ? "s" : ""}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
